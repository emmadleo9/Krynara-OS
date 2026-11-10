import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';

const candidates = [
  'meta/llama-3.3-70b-instruct',
  'meta-llama/llama-4-maverick',
  'google/gemini-2.0-flash-001',
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o-mini',
  'qwen/qwen-2.5-72b-instruct',
];
const nvidiaCandidates = [
  'google/gemma-3-4b-it',
  'ibm/granite-3.0-3b-a800m-instruct',
  'nvidia/mistral-nemo-minitron-8b-8k-instruct',
];

// shorter sweep, only Likely-subscribed -> Preserve this logic
const envFiles = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), '.env.local'),
  path.join(process.cwd(), 'gateway', '.env.local'),
  path.join(process.cwd(), 'console', '.env.local'),
];
const keyFiles = [
  path.join(STORAGE_ROOT, 'config', 'keys.json'),
  path.join(STORAGE_ROOT, 'config', 'harvested-keys.json'),
];
const openRouterNames = ['OPENROUTER_KEY', 'OPENROUTER_API_KEY', 'openrouterKey', 'openrouterApiKey'];
const nvidiaNames = ['NV_API_KEY', 'NVIDIA_NIM_API_KEY', 'VITE_NVIDIA_NIM_API_KEY', 'NVIDIA_API_KEY', 'nvidiaApiKey'];

function readJson(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn(`Could not read local key file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map(([, name, value]) => [name, value.replace(/^(['"])(.*)\1$/, '$2')]),
    );
  } catch (error) {
    console.warn(`Could not read local env file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

const localValues = [...envFiles.map(readEnvFile), ...keyFiles.map(readJson)];
function findKey(names) {
  for (const name of names) {
    if (process.env[name]?.trim()) return process.env[name].trim();
  }
  for (const values of localValues) {
    for (const name of names) {
      if (typeof values[name] === 'string' && values[name].trim()) return values[name].trim();
    }
  }
  return '';
}

const openRouterKey = findKey(openRouterNames);
const nvidiaKey = findKey(nvidiaNames);

const light = process.argv.includes('--light');

// light mode: test only NVIDIA key, skip OpenRouter entirely
const provider = light ? (nvidiaKey ? 'nvidia' : '') : openRouterKey ? 'openrouter' : nvidiaKey ? 'nvidia' : '';
const key = provider === 'nvidia' ? nvidiaKey : openRouterKey;
const selectedCandidates = provider === 'nvidia' ? nvidiaCandidates : candidates;

if (!key) {
  console.error('No OpenRouter or NVIDIA API key found in process environment or local key files.');
  process.exitCode = 1;
} else {
  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://integrate.api.nvidia.com/v1/chat/completions';
  const results = [];

  for (const model of selectedCandidates) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Say NOVA ONLINE.' }],
          max_tokens: 20,
          stream: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const responseData = await response.json().catch(() => ({}));
      const providerMessage = [
        responseData.detail,
        responseData.error?.message,
        responseData.message,
        responseData.title,
      ].find((message) => typeof message === 'string') ?? '';
      if (response.status === 404 && /function.{0,100}not found for account/i.test(providerMessage)) {
        console.log(`PROVIDER UNAVAILABLE: ${model} (account inference route not found)`);
        results.push({ model, status: 'PROVIDER UNAVAILABLE', detail: 'account inference route not found' });
        continue;
      }

      if ([404, 410, 484].includes(response.status)) {
        console.log(`SKIP EOL: ${model}`);
        results.push({ model, status: 'EOL SKIPPED', detail: `${response.status}` });
        continue;
      }

      if (!response.ok) {
        results.push({ model, status: 'FAILED', detail: `HTTP ${response.status}` });
        continue;
      }

      const reply = responseData.choices?.[0]?.message?.content;
      if (typeof reply !== 'string' || !reply.trim()) {
        results.push({ model, status: 'FAILED', detail: 'empty response' });
        continue;
      }
      results.push({ model, status: 'ALIVE', detail: reply.trim().slice(0, 40) });
    } catch (error) {
      results.push({
        model,
        status: 'FAILED',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`Provider: ${provider}`);
  console.log('Model | Result');
  for (const { model, status, detail } of results) {
    console.log(`${model} | ${status}${detail ? ` (${detail})` : ''}`);
  }
  if (results.some(({ status }) => status === 'FAILED')) process.exitCode = 1;
  if (!results.some(({ status }) => status === 'ALIVE')) console.log('No candidates passed the probe.');

  // write keys-status.json for Copilot
  const aliveModels = results.filter(({ status }) => status === 'ALIVE').map(({ model }) => model);
  const dead = results.filter(({ status }) => status !== 'ALIVE').map(({ model, status, detail }) => ({ model, status, detail }));
  const statusJson = {
    aliveModels,
    dead,
    nvidiaKeyWorks: !!nvidiaKey && aliveModels.length > 0,
    testedAt: new Date().toISOString(),
  };
  try {
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile('console/src/lib/keys-status.json', JSON.stringify(statusJson, null, 2)),
    );
  } catch (e) {
    console.warn(`Could not write keys-status.json: ${e}`);
  }
}
