/** Complete NVIDIA + Google sign-ins in the live Chrome window using profile sessions, then grab keys. */
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

// 1. NVIDIA: click Login → SSO modal → "Next"/Google → completes if Chrome has the google session
console.log('--- NVIDIA sign-in flow ---');
try { await page.goto('https://build.nvidia.com/explore', { timeout: 20000 }); } catch { }
await sleep(5000);
const login = page.locator('button:has-text("Login"), a:has-text("Login")').first();
if (await login.count().catch(() => 0)) {
  await login.click({ timeout: 5000 }).catch(() => { });
  await sleep(6000);
  console.log('at:', page.url().slice(0, 90));
  // NGC sign-in offers SSO options; click "NVIDIA Account" then email+continue if fields exist
  for (const label of ['NVIDIA Account', 'Continue with Google', 'Next']) {
    const btn = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 4000 }).catch(() => { });
      console.log('clicked:', label);
      await sleep(7000);
      console.log('at:', page.url().slice(0, 90));
      if (page.url().includes('accounts.google')) break;
    }
  }
  // If google chooser visible, click the account chip matching emmadsafdar79
  const chip = page.locator('[data-identifier*="emmadsafdar79"]').first();
  if (await chip.count().catch(() => 0)) {
    await chip.click({ timeout: 4000 }).catch(() => { });
    console.log('picked emmadsafdar79 chip');
    await sleep(9000);
  }
}
console.log('nvidia url now:', page.url().slice(0, 90));
save({ nvidiaLoggedIn: page.url().includes('build.nvidia.com') && !(await page.locator('button:has-text("Login")').count().catch(() => 0)) });

// wait for possible key on page
await sleep(6000);
const keys = await page.evaluate(() => {
  const text = document.body?.innerText || '';
  const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
  try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
  return [...set];
}).catch(() => []);
if (keys.length) { save({ nvidiaApiKey: keys[0] }); console.log('NVIDIA KEY SAVED:', keys[0].slice(0, 14) + '…'); }
else console.log('no nvapi key yet — may need Generate Key click on build.nvidia.com/settings');

console.log('stored:', Object.keys(load()).join(', '));
await browser.close();
process.exit(0);
