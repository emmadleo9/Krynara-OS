/** Loop: wait for the user's SSO in the live Chrome window, poll for nvapi key up to 3 minutes. */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';
const require2 = createRequire('c:/Users/User/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/');
const { chromium } = require2('patchright');

const STORE = path.join(STORAGE_ROOT, 'config', 'harvested-keys.json');
const load = () => existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const save = (patch) => { mkdirSync(path.join(STORAGE_ROOT, 'config'), { recursive: true }); writeFileSync(STORE, JSON.stringify({ ...load(), ...patch }, null, 2)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
console.log('>>> WATCHING the real Chrome window — complete NVIDIA sign-in there if prompted (choose your account) <<<');
console.log('polling for nvapi- key for up to 180s…');

const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  const page = context.pages().find((p) => p.url().includes('build.nvidia.com'));
  if (!page) { await sleep(4000); continue; }
  const keys = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
    return [...set];
  }).catch(() => []);
  if (keys.length) {
    save({ nvidiaApiKey: keys[0], nvidiaLoggedIn: true });
    console.log('NVIDIA KEY CAPTURED:', keys[0].slice(0, 14) + '…');
    break;
  }
  const modal = page.url().includes('modal=signin');
  process.stdout.write(`\r[${new Date().toLocaleTimeString()}] ${modal ? 'waiting for sign-in…' : 'on ' + page.url().slice(8, 50)}   `);
  await sleep(5000);
}
console.log('\ndone. stored:', Object.keys(load()).join(', '));
await browser.close();
process.exit(0);
