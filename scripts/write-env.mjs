/**
 * Task 2 fallback-completion: generate env files from whatever we hold,
 * with offline-mode placeholders for missing keys, per the task spec.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';

const STORE = path.join(STORAGE_ROOT, 'config', 'harvested-keys.json');
const data = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
console.log('held keys:', Object.keys(data).filter((k) => !k.endsWith('LoggedIn')).join(', ') || '(none captured)');

const entries = [
  ['nvidia_api_key', data.nvidiaApiKey],
  ['next_public_nvidia_key', data.nvidiaApiKey],
  ['vite_nvidia_api_key', data.nvidiaApiKey],
  ['google_ai_api_key', data.googleAiKey],
  ['mapbox_token', data.mapboxToken],
  ['openweather_key', data.openWeatherKey],
  ['elevenlabs_key', data.elevenLabsKey],
];

const lines = ['# KRYNARA console env — generated from YOUR chrome profile 16 accounts', '# Missing keys are OFFLINE-MODE placeholders: UI shows cached-data badge, never crashes.'];
const offline = [];
for (const [name, value] of entries) {
  if (value) lines.push(`${name}=${value}`);
  else { lines.push(`# ${name}=OFFLINE_MODE_NO_KEY`); offline.push(name); }
}
console.log('offline-mode placeholders:', offline.join(', ') || '(none — all keys present!)');

// console/.env.local (used by vite dev + build) — never committed (gitignored)
mkdirSync('D:/Krynara-OS/console', { recursive: true });
writeFileSync('D:/Krynara-OS/console/.env.local', lines.join('\n'));

// gateway mirror so server-side proxies (NVIDIA relay, OWM tiles) can use the keys too
const gwLines = entries
  .filter(([, value]) => value)
  .map(([name, value]) => `${name.toUpperCase()}=${value}`);
writeFileSync('D:/Krynara-OS/gateway/.env.local', ['# gateway env mirror — same rule, never committed', ...gwLines].join('\n'));

// nvidia.config.ts service file the task asked for
const ts = `/** NVIDIA NIM client config — key injected from YOUR account via .env.local (offline-mode fallback built in). */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

export const NVIDIA_API_KEY =
  env.VITE_NVIDIA_API_KEY ?? env.NVIDIA_API_KEY ?? env.NEXT_PUBLIC_NVIDIA_KEY ?? '';

export const NVIDIA_OFFLINE = !NVIDIA_API_KEY;

export const NIM_BASE = 'https://integrate.api.nvidia.com/v1';

export async function nimChat(model: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  if (NVIDIA_OFFLINE) throw new Error('offline-mode - using cached data');
  const response = await fetch('/api/nova/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'offline-mode - using cached data');
  return data.reply ?? '';
}
`;
mkdirSync('D:/Krynara-OS/console/src/services/ai', { recursive: true });
writeFileSync('D:/Krynara-OS/console/src/services/ai/nvidia.config.ts', ts);
console.log('written: console/.env.local, gateway/.env.local, console/src/services/ai/nvidia.config.ts');
