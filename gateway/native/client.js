'use strict';

/**
 * Krynara native sidecar client.
 *
 * The Node gateway stays the source of truth. This module only offers an
 * optional fast path: if the Rust binary at gateway/native is present and
 * healthy, CPU-heavy transforms (GDELT CSV parsing, GTFS-RT decoding, system
 * telemetry) are delegated to it. If anything at all goes wrong — binary
 * missing, not built, slow, crashed, malformed reply — the caller falls back to
 * the original JavaScript implementation, so behaviour is never worse than
 * today.
 *
 * Disable entirely with KRYNARA_NATIVE=0.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NATIVE_DIR = __dirname;
const TARGET_DIR = path.join(NATIVE_DIR, 'target', 'release');
const BINARY_NAME = process.platform === 'win32' ? 'krynara-native.exe' : 'krynara-native';
const BINARY_PATH = path.join(TARGET_DIR, BINARY_NAME);
const PORT = Number(process.env.KRYNARA_NATIVE_PORT || 2790);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const ENABLED = process.env.KRYNARA_NATIVE !== '0' && process.env.KRYNARA_NATIVE !== 'false';
const HEALTH_TIMEOUT_MS = 800;
const DEFAULT_TIMEOUT_MS = 5000;

let child = null;
let starting = false;
let available = false;

function isEnabled() {
  return ENABLED;
}

/** True once a health probe has succeeded at least once this process. */
function isAvailable() {
  return available;
}

async function probe(timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
    const body = await response.json().catch(() => null);
    return Boolean(response.ok && body && body.ok === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Spawn the sidecar if the binary exists and nothing is serving the port. */
function start() {
  if (!ENABLED || child || starting) return;
  starting = true;
  void (async () => {
    try {
      // Already healthy (started by the launcher or a previous boot)? Use it.
      if (await probe()) {
        available = true;
        console.log(`[native] sidecar already healthy at ${BASE_URL}.`);
        return;
      }
      if (!fs.existsSync(BINARY_PATH)) {
        console.log(`[native] binary not built at ${BINARY_PATH}; using JavaScript paths.`);
        return;
      }
      child = spawn(BINARY_PATH, [], {
        cwd: NATIVE_DIR,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, KRYNARA_NATIVE_PORT: String(PORT) },
      });
      child.stdout.on('data', (chunk) => process.stdout.write(`[krynara-native] ${chunk}`));
      child.stderr.on('data', (chunk) => process.stderr.write(`[krynara-native] ${chunk}`));
      child.on('exit', (code) => {
        child = null;
        available = false;
        console.warn(`[native] sidecar exited (${code}); falling back to JavaScript paths.`);
      });
      child.on('error', (error) => {
        child = null;
        available = false;
        console.warn(`[native] sidecar failed to start: ${error && error.message ? error.message : error}`);
      });
      console.log(`[native] sidecar starting on ${BASE_URL}`);
    } catch (error) {
      console.warn(`[native] sidecar start failed: ${error && error.message ? error.message : error}`);
    } finally {
      setTimeout(() => { starting = false; }, 1500);
    }
  })();
}

/**
 * Calls a sidecar endpoint. Resolves with parsed JSON, or rejects so the caller
 * can fall back. Never throws synchronously.
 */
async function call(pathname, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!ENABLED) throw new Error('native disabled');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const hasBody = body !== undefined && body !== null;
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method: hasBody ? 'POST' : 'GET',
      headers: hasBody ? { 'Content-Type': 'application/octet-stream' } : undefined,
      body: hasBody ? body : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`native ${pathname} returned HTTP ${response.status}`);
    const parsed = await response.json();
    if (parsed && parsed.error) throw new Error(`native ${pathname}: ${parsed.error}`);
    available = true;
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget health refresh, safe to call on boot. */
async function refresh() {
  if (!ENABLED) return false;
  available = await probe();
  return available;
}

module.exports = { start, call, probe, refresh, isEnabled, isAvailable, BASE_URL, BINARY_PATH };