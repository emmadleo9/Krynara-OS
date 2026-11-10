/** Navigate tab[0] to Gmail and NVIDIA in the real Chrome, then deep-scan both. */
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
const tab = context.pages()[0];

async function harvest(page, label) {
  await sleep(4000);
  const data = await page.evaluate(() => {
    const grab = () => {
      const text = document.body?.innerText || '';
      return {
        emails: [...new Set(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])].slice(0, 6),
        nvapi: [...new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? [])],
        aiza: [...new Set(text.match(/AIza[A-Za-z0-9_\-]{30,}/g) ?? [])],
        pk: [...new Set(document.documentElement.innerHTML.match(/pk\.eyJ[A-Za-z0-9_\-\.]{40,}/g) ?? [])],
        hex32: [...new Set(text.match(/\b[0-9a-f]{32}\b/g) ?? [])],
        sk: [...new Set(text.match(/\bsk_[A-Za-z0-9]{20,}\b/g) ?? [])],
      };
    };
    const results = grab();
    // include iframes (google account chips live there)
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const inner = frame.contentDocument?.body?.innerText || '';
        for (const m of inner.match(/[a-z0-9._%+-]+@gmail\.com/gi) ?? []) results.emails.push(m);
      } catch { }
    }
    return results;
  }).catch(() => null);
  console.log(`\n[${label}] ${page.url().slice(0, 70)}`);
  if (!data) { console.log('  (eval failed)'); return; }
  if (data.emails.length) console.log('  emails:', [...new Set(data.emails)].join(', ').slice(0, 110));
  const patch = {};
  if (data.nvapi.length) { patch.nvidiaApiKey = data.nvapi[0]; console.log('  NVIDIA KEY:', data.nvapi[0].slice(0, 14) + '…'); }
  if (data.aiza.length) { patch.googleAiKey = data.aiza[0]; console.log('  GOOGLE KEY:', data.aiza[0].slice(0, 10) + '…'); }
  if (data.pk.length) { patch.mapboxToken = data.pk[0]; console.log('  MAPBOX:', data.pk[0].slice(0, 14) + '…'); }
  if (data.hex32.length) { patch.openWeatherKey = data.hex32[0]; console.log('  OPENWEATHER:', data.hex32[0].slice(0, 8) + '…'); }
  if (data.sk.length) { patch.elevenLabsKey = data.sk[0]; console.log('  ELEVENLABS FOUND'); }
  if (Object.keys(patch).length) save(patch);
}

// Gmail lock check — bounce to mail.google.com directly (redirect suggests profile needs sign-in)
let landed = '';
try { await tab.goto('https://mail.google.com/mail/u/0/', { waitUntil: 'load', timeout: 30000 }); landed = tab.url(); } catch (e) { landed = tab.url(); }
await sleep(12000);
console.log('gmail landed at:', landed.slice(0, 90));
if (!landed.includes('mail.google.com/mail')) {
  console.log('>>> PROFILE 16 NOT SIGNED INTO GOOGLE — a Google sign-in chooser should now be visible in the real Chrome window. Pick emmadsafdar79@gmail.com there.');
  await tab.goto('https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/mail/u/0/', { timeout: 25000 }).catch(() => {});
  await sleep(10000);
  console.log('now at:', tab.url().slice(0, 90));
}
const patch = {};
const title = await tab.title().catch(() => '');
console.log('gmail title:', title);
await harvest(tab, 'gmail');
const emails = await tab.evaluate(() => {
  const grab = (doc) => {
    const out = [];
    const text = doc.body?.innerText || '';
    out.push(...(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []));
    for (const frame of doc.querySelectorAll('iframe')) {
      try { out.push(...((frame.contentDocument?.body?.innerText || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])); } catch { }
    }
    return out;
  };
  return [...new Set(grab(document))].slice(0, 8);
}).catch(() => []);
console.log('gmail all-frame emails:', emails);
patch.gmailLock = emails.some((e) => e.toLowerCase() === 'emmadsafdar79@gmail.com');
patch.nvidiaLoggedIn = patch.nvidiaLoggedIn || emails.some((e) => e.includes('emmadsafdar79'));

// NVIDIA
await tab.goto('https://build.nvidia.com/explore', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
await sleep(9000);
await harvest(tab, 'nvidia');
save(patch);
console.log('\nSTORED:', Object.keys(load()).join(', '));
console.log('gmailLock:', load().gmailLock, '| nvidiaLoggedIn:', load().nvidiaLoggedIn);
await browser.close();
process.exit(0);
