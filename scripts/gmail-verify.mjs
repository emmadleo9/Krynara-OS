/**
 * Verify Gmail lock via the account switcher iframe in the REAL chrome window.
 * Uses frameLocator since the account chip lives inside Google's iframe.
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
let page = context.pages().find((p) => p.url().includes('mail.google')) ?? context.pages()[0];
if (!page.url().includes('mail.google')) {
  await page.goto('https://mail.google.com/mail/u/0/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
  await sleep(7000);
}
console.log('gmail loaded:', page.url());

// The account avatar/email is in an iframe (account chip). Check all frames.
let found = false;
for (const frame of page.frames()) {
  try {
    const text = await frame.evaluate(() => (document.body?.innerText || '')).catch(() => '');
    const emails = [...new Set(text.match(/[a-z0-9._%+-]+@gmail\.com/gi) ?? [])];
    if (emails.length) {
      console.log(`frame ${frame.url().slice(0, 50)}:`, emails.slice(0, 5));
      if (emails.some((e) => e.toLowerCase() === 'emmadsafdar79@gmail.com')) { found = true; break; }
    }
  } catch { }
}
// Also check the page's own document with title (gmail title sometimes includes account)
const title = await page.title().catch(() => '');
console.log('title:', title);
if (title.toLowerCase().includes('emmadsafdar79')) found = true;

console.log('LOCK VERIFIED:', found);
save({ gmailLock: found });
await browser.close();
process.exit(0);
