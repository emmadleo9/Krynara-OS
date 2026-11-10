/**
 * Drive the LIVE debug-chrome tab directly via its websocket target
 * (page.url() hangs on pending nav, but CDP targets list works).
 */
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
console.log('total pages:', context.pages().length);
for (const p of context.pages()) console.log('  page:', p.url().slice(0, 80));

// NVIDIA NIM tab exists — attach to it
let page = context.pages().find((p) => p.url().includes('build.nvidia.com'));
if (!page) { console.log('no nvidia tab'); process.exit(0); }
console.log('attached:', page.url());

// Navigate it to the API keys settings page
try { await page.goto('https://build.nvidia.com/settings/api-keys', { timeout: 20000 }); } catch { }
await sleep(4000);
const accept = page.locator('button:has-text("Accept All")').first();
if (await accept.count().catch(() => 0)) { await accept.click({ timeout: 3000 }).catch(() => { }); await sleep(2000); }
const loginBtn = page.locator('button:has-text("Login"), a:has-text("Login"), button:has-text("Sign In")').first();
if (await loginBtn.count().catch(() => 0)) { console.log('LOGIN REQUIRED — completing SSO with the Chrome profile session'); await loginBtn.click({ timeout: 4000 }).catch(() => { }); await sleep(10000); }
console.log('now at:', page.url());

const body = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1500)).catch((e) => `eval err ${e.message?.slice(0, 60)}`);
console.log('---- page text ----');
console.log(body);

const keys = await page.evaluate(() => {
  const text = document.body?.innerText || '';
  const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
  try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
  return [...set];
}).catch(() => []);
if (keys.length) { save({ nvidiaApiKey: keys[0] }); console.log('KEY SAVED:', keys[0].slice(0, 14) + '…'); }
else console.log('no nvapi- key visible yet');
await browser.close();
process.exit(0);
