/** Grab NVIDIA key from the tab you just signed into. Scans page text, localStorage, session storage, and meta tags. */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';
const require2 = createRequire('c:/Users/User/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/');
const { chromium } = require2('patchright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STORE = path.join(STORAGE_ROOT, 'config', 'harvested-keys.json');
const load = () => existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const save = (patch) => { mkdirSync(path.join(STORAGE_ROOT, 'config'), { recursive: true }); writeFileSync(STORE, JSON.stringify({ ...load(), ...patch }, null, 2)); };

const browser = await chromium.connectOverCDP('http://127.0.0.1:51344');
const context = browser.contexts()[0];
console.log('=== ALL LIVE TABS ===');
for (const [index, page] of context.pages().entries()) {
  console.log(`[${index}] ${page.url().slice(0, 100)}`);
}

// find any nvidia tab across ALL contexts (the signed-in window may be its own context)
let page = null;
for (const ctx of browser.contexts()) {
  for (const p of ctx.pages()) {
    console.log('ctx tab:', p.url().slice(0, 100));
    if (p.url().includes('nvidia.com')) page = p;
  }
}
if (!page) { console.log('NO NVIDIA TAB OPEN — is build.nvidia.com visible in the other Chrome window?'); process.exit(0); }
console.log('\nattached:', page.url().slice(0, 100));

const scan = await page.evaluate(() => {
  const results = { emails: [], nvapi: [], bodySample: '' };
  const text = document.body?.innerText || '';
  results.bodySample = text.slice(0, 600);
  results.emails = [...new Set(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])].slice(0, 6);
  results.nvapi = [...new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? [])];
  // scan all storages + cookies via JS
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const v = localStorage.getItem(localStorage.key(i)) ?? '';
      for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) results.nvapi.push(m);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const v = sessionStorage.getItem(sessionStorage.key(i)) ?? '';
      for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) results.nvapi.push(m);
    }
  } catch { }
  return results;
}).catch((error) => ({ error: String(error).slice(0, 100) }));

if (scan.emails?.length) console.log('emails visible:', scan.emails.join(', ').slice(0, 100));
if (scan.bodySample) console.log('--- page text sample ---');
if (scan.bodySample) console.log(scan.bodySample);

if (scan.nvapi?.length) {
  const key = [...new Set(scan.nvapi)][0];
  save({ nvidiaApiKey: key, nvidiaLoggedIn: true });
  console.log('\n✅ NVIDIA KEY CAPTURED:', key.slice(0, 16) + '…');
  console.log('SAVED to', path.join(STORAGE_ROOT, 'config', 'harvested-keys.json'));
} else {
  console.log('\nno nvapi- key in DOM/storage yet.');
  console.log('If you see a masked key (nvapi-…) click the COPY button next to it — the full value may land on the clipboard; I can read the clipboard next.');
}
await browser.close();
process.exit(0);
