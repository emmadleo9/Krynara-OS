/** Click the SSO "Next" button and let Chrome profile session complete the sign-in. */
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
const page = context.pages().find((p) => p.url().includes('build.nvidia.com')) ?? context.pages()[0];
console.log('at:', page.url());

// Click Next in the sign-in modal
const next = page.locator('button:has-text("Next")').first();
if (await next.count().catch(() => 0)) {
  await next.click({ timeout: 4000 }).catch(() => { });
  console.log('clicked Next — waiting for NVIDIA SSO redirect');
  await sleep(12000);
}
console.log('url now:', page.url());
const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400)).catch(() => '');
console.log(text.slice(0, 300));

// If we landed on accounts.google.com or login page, report for user
if (page.url().includes('accounts.google') || page.url().includes('login')) {
  console.log('>>> SSO PAGE OPEN IN REAL CHROME WINDOW — choose the account, then run this script again');
}
const keys = await page.evaluate(() => {
  const text = document.body?.innerText || '';
  const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
  try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
  return [...set];
}).catch(() => []);
if (keys.length) { save({ nvidiaApiKey: keys[0] }); console.log('KEY SAVED:', keys[0].slice(0, 14) + '…'); }
await browser.close();
process.exit(0);
