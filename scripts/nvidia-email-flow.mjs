/** Type the locked email into NVIDIA's sign-in modal, click Next, follow through to NGC/google SSO. */
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

if (!page.url().includes('modal=signin')) {
  const login = page.locator('button:has-text("Login")').first();
  await login.click({ timeout: 5000 }).catch(() => { });
  await sleep(4000);
}
const email = page.locator('#email').first();
await email.fill('emmadsafdar79@gmail.com', { timeout: 5000 }).catch((e) => console.log('fill:', e.message?.slice(0, 50)));
await page.locator('button:has-text("Next")').first().click({ timeout: 5000 }).catch(() => { });
console.log('submitted email — following redirects');
await sleep(10000);
console.log('at:', page.url().slice(0, 110));

// If google chooser appears, pick our account chip
const chip = page.locator('[data-identifier*="emmadsafdar79"]').first();
for (let attempt = 0; attempt < 4; attempt++) {
  if (await chip.count().catch(() => 0)) {
    await chip.click({ timeout: 4000 }).catch(() => { });
    console.log('picked emmadsafdar79 in google chooser');
    await sleep(9000);
  }
  // "Continue" on confirmation screens
  const cont = page.locator('button:has-text("Continue")').first();
  if (await cont.count().catch(() => 0)) { await cont.click({ timeout: 4000 }).catch(() => { }); await sleep(7000); }
  if (page.url().includes('build.nvidia.com') && !page.url().includes('signin')) break;
}
console.log('final url:', page.url().slice(0, 110));

// Log in state + hunt for the key
await sleep(6000);
const loggedIn = !(await page.locator('#email').count().catch(() => 0));
save({ nvidiaLoggedIn: loggedIn });
const keys = await page.evaluate(() => {
  const text = document.body?.innerText || '';
  const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
  try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
  return [...set];
}).catch(() => []);
if (keys.length) { save({ nvidiaApiKey: keys[0] }); console.log('NVIDIA KEY SAVED:', keys[0].slice(0, 14) + '…'); }
else console.log('no key surfaced yet');
console.log('stored:', Object.keys(load()).join(', '));
await browser.close();
process.exit(0);
