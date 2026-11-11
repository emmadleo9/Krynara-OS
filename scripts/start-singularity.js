import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayDir = path.join(root, 'gateway');
const consoleDir = path.join(root, 'console');
const runtimeDir = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Krynara-OS', 'runtime')
  : path.join(os.homedir(), '.krynara-os', 'runtime');
const gatewayRequire = createRequire(path.join(gatewayDir, 'package.json'));
const gatewayEntry = path.join(gatewayDir, 'index.js');
const dotenv = gatewayRequire('dotenv');
for (const envFile of [
  path.join(consoleDir, '.env.local'),
  path.join(root, '.env.local'),
  path.join(root, '.env'),
  path.join(gatewayDir, '.env.local'),
  path.join(gatewayDir, '.env'),
]) {
  if (!fs.existsSync(envFile)) continue;
  const result = dotenv.config({ path: envFile });
  if (result.error) throw result.error;
}

const gatewayPort = Number(process.env.GATEWAY_PORT || process.env.KRYNARA_PORT || 2785);
const consolePort = Number(process.env.CONSOLE_PORT || 5173);
const gatewayHealthUrl = `http://127.0.0.1:${gatewayPort}/api/health`;
const consoleHealthUrl = `http://127.0.0.1:${consolePort}/api/health`;
const ollamaBaseUrl = process.env.KRYNARA_OLLAMA_URL || 'http://127.0.0.1:11434';
const ollamaHealthUrl = new URL('/api/tags', ollamaBaseUrl).toString();
const children = new Set();
let stopping = false;
let coordinatorLock;
const coordinatorLockFile = path.join(runtimeDir, 'master-start-v04.lock');
const coordinatorPidFile = path.join(runtimeDir, 'singularity.pid');
const providerSecretEnvKeys = [
  'NV_API_KEY',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'VITE_NVIDIA_API_KEY',
  'VITE_NVIDIA_NIM_API_KEY',
  'GROQ_API_KEY',
  'VITE_GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_KEY',
  'VITE_OPENROUTER_API_KEY',
  'TAVILY_API_KEY',
  'VITE_TAVILY_API_KEY',
];

fs.mkdirSync(runtimeDir, { recursive: true });

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(1000, () => settle(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function assertPortsFreeOrOwnedByUs() {
  const checks = [
    { port: gatewayPort, name: 'gateway', healthUrl: gatewayHealthUrl },
    { port: consolePort, name: 'console', healthUrl: consoleHealthUrl },
  ];
  for (const { port, name, healthUrl } of checks) {
    if (!(await isPortInUse(port))) continue;
    // Port busy, but if OUR healthy stack is already serving it, reuse it.
    if (await getHealth(healthUrl)) continue;
    console.error(`Port ${consolePort} / ${gatewayPort} already in use. Run: taskkill /F /IM node.exe`);
    throw Object.assign(new Error(`Port ${port} already in use by another process.`), { handled: true });
  }
}

function isProcessRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readPidFile(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function acquireCoordinatorLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      coordinatorLock = fs.openSync(coordinatorLockFile, 'wx');
      fs.writeSync(coordinatorLock, String(process.pid));
      fs.writeFileSync(coordinatorPidFile, String(process.pid), 'utf8');
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = readPidFile(coordinatorLockFile);
      if (isProcessRunning(owner)) {
        throw new Error(`Another KRYNARA master launcher is already running (PID ${owner}).`);
      }
      if (Date.now() - fs.statSync(coordinatorLockFile).mtimeMs < 5000) {
        throw new Error('Another KRYNARA master launcher is acquiring the startup lock. Retry in a few seconds.');
      }
      fs.unlinkSync(coordinatorLockFile);
    }
  }
  throw new Error('Could not acquire the KRYNARA startup lock. Retry after checking the runtime folder.');
}

function releaseCoordinatorLock() {
  removePidFile(coordinatorPidFile, process.pid);
  if (coordinatorLock !== undefined) {
    fs.closeSync(coordinatorLock);
    coordinatorLock = undefined;
  }
  if (readPidFile(coordinatorLockFile) === process.pid) {
    fs.unlinkSync(coordinatorLockFile);
  }
}

process.on('exit', releaseCoordinatorLock);

function assertPort(port, name) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port; received ${port}.`);
  }
}

async function getHealth(url, requiredPath) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const data = await response.json();
    if (data.status !== 'ok' && data.status !== 'online') return false;
    if (!requiredPath) return true;
    const probe = await fetch(new URL(requiredPath, url), { signal: AbortSignal.timeout(1000) });
    if (!probe.ok) return false;
    const probeData = await probe.json();
    return typeof probeData.status === 'string';
  } catch {
    return false;
  }
}

async function waitForHealth(url, label, child, requiredPath) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await getHealth(url, requiredPath)) return;
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`${label} exited with code ${child.exitCode} before becoming ready.`);
    }
    if (child?.signalCode) {
      throw new Error(`${label} exited from signal ${child.signalCode} before becoming ready.`);
    }
    await delay(250);
  }
  throw new Error(`${label} did not become healthy at ${url} within 20 seconds.`);
}

async function waitForEndpoint(url, label, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { }
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`${label} exited with code ${child.exitCode} before becoming ready.`);
    }
    if (child?.signalCode) {
      throw new Error(`${label} exited from signal ${child.signalCode} before becoming ready.`);
    }
    await delay(500);
  }
  throw new Error(`${label} did not become healthy at ${url} within ${timeoutMs / 1000} seconds.`);
}

async function startOllamaWhenAvailable() {
  try {
    const response = await fetch(ollamaHealthUrl, { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      console.log(`[Krynara-OS] Local AI service is already available at ${new URL(ollamaHealthUrl).origin}.`);
      return;
    }
  } catch { }

  const ollamaUrl = new URL(ollamaBaseUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(ollamaUrl.hostname)) {
    console.warn(`[Krynara-OS] Optional Ollama service is unavailable at ${ollamaUrl.origin}; continuing without local AI.`);
    return;
  }

  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    execFileSync(locator, ['ollama'], { stdio: 'ignore' });
  } catch {
    console.warn('[Krynara-OS] Ollama is not installed or not on PATH; continuing without local AI.');
    return;
  }

  const host = `${ollamaUrl.hostname}:${ollamaUrl.port || '11434'}`;
  const ollama = startChild('Ollama', 'ollama', ['serve'], root, { ...process.env, OLLAMA_HOST: host });
  console.log('[Krynara-OS] Starting Ollama local AI service...');
  await waitForEndpoint(ollamaHealthUrl, 'Ollama local AI service', ollama, 60_000);
  console.log(`[Krynara-OS] Local AI service is ready at ${ollamaUrl.origin}.`);
}

function stopChildren() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

function removePidFile(pidFile, pid) {
  if (!pidFile || !pid) return;
  try {
    if (Number(fs.readFileSync(pidFile, 'utf8')) === pid) fs.unlinkSync(pidFile);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`[Krynara-OS] Could not clear ${pidFile}: ${error.message}`);
  }
}

function startChild(label, executable, args, cwd, env = process.env) {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  let pidFile;
  if (child.pid) {
    try {
      fs.mkdirSync(runtimeDir, { recursive: true });
      pidFile = path.join(runtimeDir, `${label.toLowerCase()}.pid`);
      fs.writeFileSync(pidFile, String(child.pid), 'utf8');
    } catch (error) {
      child.kill();
      throw new Error(`Could not record the ${label} process for STOP-KRYNARA: ${error.message}`);
    }
  }
  child.once('error', (error) => {
    removePidFile(pidFile, child.pid);
    console.error(`[Krynara-OS] Could not start ${label}: ${error.message}`);
    process.exitCode = 1;
    stopChildren();
  });
  child.once('exit', (code, signal) => {
    removePidFile(pidFile, child.pid);
    children.delete(child);
    if (stopping) return;
    console.error(`[Krynara-OS] ${label} exited${signal ? ` from signal ${signal}` : ` with code ${code}`}.`);
    process.exitCode = code ?? 1;
    stopChildren();
  });
  return child;
}

async function main() {
  assertPort(gatewayPort, 'GATEWAY_PORT');
  assertPort(consolePort, 'CONSOLE_PORT');
  if (gatewayPort === consolePort) throw new Error('GATEWAY_PORT and CONSOLE_PORT must be different.');

  await assertPortsFreeOrOwnedByUs();

  const existingCoordinator = readPidFile(coordinatorPidFile);
  if (existingCoordinator !== process.pid && isProcessRunning(existingCoordinator)) {
    if (await getHealth(gatewayHealthUrl, '/api/whatsapp/status')
      && await getHealth(consoleHealthUrl)) {
      console.log(`[Krynara-OS] KRYNARA is already running (launcher PID ${existingCoordinator}).`);
      console.log(`[Krynara-OS] Console: http://localhost:${consolePort} | Gateway: http://127.0.0.1:${gatewayPort}`);
      return;
    }
    throw new Error(`Launcher PID ${existingCoordinator} exists but the full KRYNARA stack is not healthy. Use STOP-KRYNARA.bat before restarting.`);
  }

  acquireCoordinatorLock();

  await startOllamaWhenAvailable();

  let gateway;
  if (!(await getHealth(gatewayHealthUrl, '/api/whatsapp/status'))) {
    if (await getHealth(gatewayHealthUrl)) {
      throw new Error(`Port ${gatewayPort} is serving a different gateway. Stop it and restart KRYNARA so WhatsApp can use the local API.`);
    }
    gateway = startChild(
      'Gateway',
      process.execPath,
      [gatewayEntry],
      gatewayDir,
      { ...process.env, GATEWAY_PORT: String(gatewayPort), KRYNARA_PORT: String(gatewayPort), PORT: String(gatewayPort) },
    );
    await waitForHealth(gatewayHealthUrl, 'KRYNARA local gateway', gateway, '/api/whatsapp/status');
  }

  if (!(await getHealth(consoleHealthUrl))) {
    const viteEntry = path.join(consoleDir, 'node_modules', 'vite', 'bin', 'vite.js');
    const consoleEnv = {
      ...process.env,
      GATEWAY_PORT: String(gatewayPort),
      KRYNARA_PORT: String(gatewayPort),
      CONSOLE_PORT: String(consolePort),
      NODE_ENV: 'development',
    };
    for (const key of providerSecretEnvKeys) delete consoleEnv[key];
    const consoleServer = startChild(
      'Console',
      process.execPath,
      [viteEntry, '--host', '0.0.0.0', '--port', String(consolePort), '--strictPort'],
      consoleDir,
      consoleEnv,
    );
    await waitForHealth(consoleHealthUrl, 'Console proxy', consoleServer);
  }

  console.log('[Krynara-OS] Krynara-OS v0.4 startup complete.');
  console.log(`[Krynara-OS] Console: http://localhost:${consolePort}`);
  console.log(`[Krynara-OS] Local gateway: http://127.0.0.1:${gatewayPort} (proxied via /api)`);
  console.log('[Krynara-OS] WhatsApp, World View feeds, and AI routes are ready through the local gateway.');

  process.once('SIGINT', () => {
    process.exitCode = 130;
    stopChildren();
  });
  process.once('SIGTERM', stopChildren);
}

main().catch((error) => {
  console.error(`[Krynara-OS] Startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  stopChildren();
});
