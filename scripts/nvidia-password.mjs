/** Enter NVIDIA account password from the user's local credential store and finish SSO. */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';
const require2 = createRequire('c:/Users/User/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/');
const { chromium } = require2('patchright');

const STORE = path.join(STORAGE_ROOT, 'config', 'harvested-keys.json');
const CREDS = path.join(STORAGE_ROOT, 'config', 'credentials.json');
const load = () => existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const save = (patch) => { mkdirSync(path.join(STORAGE_ROOT, 'config'), { recursive: true }); writeFileSync(STORE, JSON.stringify({ ...load(), ...patch }, null, 2)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// password source: env var NVIDIA_PASSWORD first, else credentials.json { nvidiaPassword }
let password = process.env.NVIDIA_PASSWORD ?? '';
if (!password && existsSync(CREDS)) {
  try { password = JSON.parse(readFileSync(CREDS, 'utf8')).nvidiaPassword ?? ''; } catch { }
}
if (!password) {
  console.log('NO PASSWORD SOURCE. Create', path.join(STORAGE_ROOT, 'config', 'credentials.json'), ':');
  console.log('  { "nvidiaPassword": "your-nvidia-password" }');
  console.log('or set env NVIDIA_PASSWORD. Then rerun this script. (File stays on Disk D, gitignored.)');
  process.exit(1);
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().includes('nvidia.com')) ?? context.pages()[0];
console.log('at:', page.url().slice(0, 90));

const passField = page.locator('input[type=password]').first();
await passField.fill(password, { timeout: 8000 });
await page.locator('button[type=submit], button:has-text("Login"), button:has-text("Sign In")').first().click({ timeout: 6000 }).catch(() => { });
await sleep(12000);
console.log('after password:', page.url().slice(0, 90));

// handle possible MFA/verify screens by reporting
const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400)).catch(() => '');
console.log(text.slice(0, 300));

// If back on build.nvidia.com, go get the key
if (page.url().includes('build.nvidia.com')) {
  await page.goto('https://build.nvidia.com/settings/api-keys', { timeout: 20000 }).catch(() => { });
  await sleep(8000);
  const gen = page.locator('button:has-text("Generate Personal Key"), button:has-text("Generate API Key"), button:has-text("Generate Key")').first();
  if (await gen.count().catch(() => 0)) {
    await gen.click({ timeout: 6000 }).catch(() => { });
    await sleep(12000);
  }
  const keys = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
    return [...set];
  }).catch(() => []);
  if (keys.length) { save({ nvidiaApiKey: keys[0], nvidiaLoggedIn: true }); console.log('NVIDIA KEY CAPTURED:', keys[0].slice(0, 14) + '…'); }
  else console.log('no key visible — check window');
} else {
  console.log('MFA or captcha may be showing — finish it in the visible Chrome window, then run nvidia-watch.mjs');
}
console.log('stored:', Object.keys(load()).join(', '));
await browser.close();
process.exit(0);
