/** Direct CDP scan of live chrome: all tabs, their URLs and any visible emails/keys. */
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
console.log('=== LIVE TABS ===');
const pages = context.pages();
console.log('count:', pages.length);
const scan = { emails: [], keys: new Set() };
for (const [index, page] of pages.entries()) {
  const url = page.url();
  console.log(`\n[${index}] ${url.slice(0, 90)}`);
  const title = await page.title().catch(() => '');
  console.log(`    title: ${title.slice(0, 70)}`);
  if (/accounts\.google|nvidia|aistudio|mapbox|openweathermap|elevenlabs|mail\.google/.test(url)) {
    const data = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return {
        emails: [...new Set(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])].slice(0, 6),
        nvapi: [...new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? [])],
        aiza: [...new Set(text.match(/AIza[A-Za-z0-9_\-]{30,}/g) ?? [])],
        pk: [...new Set((document.documentElement.innerHTML.match(/pk\.eyJ[A-Za-z0-9_\-\.]{40,}/g) ?? []))],
        hex32: [...new Set(text.match(/\b[0-9a-f]{32}\b/g) ?? [])],
        sk: [...new Set(text.match(/\bsk_[A-Za-z0-9]{20,}\b/g) ?? [])],
      };
    }).catch(() => null);
    if (data) {
      if (data.emails.length) console.log('    emails:', data.emails.join(', ').slice(0, 100));
      for (const key of ['nvapi', 'aiza', 'pk', 'hex32', 'sk']) {
        if (data[key]?.length) {
          console.log(`    ${key} FOUND x${data[key].length}: ${data[key][0].slice(0, 16)}…`);
          scan.keys.add(JSON.stringify({ kind: key, value: data[key][0] }));
        }
      }
      for (const email of data.emails) if (!scan.emails.includes(email.toLowerCase())) scan.emails.push(email.toLowerCase());
    }
  }
}
const patch = {};
for (const item of scan.keys) {
  const { kind, value } = JSON.parse(item);
  if (kind === 'nvapi') patch.nvidiaApiKey = value;
  if (kind === 'aiza') patch.googleAiKey = value;
  if (kind === 'pk') patch.mapboxToken = value;
  if (kind === 'hex32') patch.openWeatherKey = value;
  if (kind === 'sk') patch.elevenLabsKey = value;
}
patch.gmailLock = scan.emails.includes('emmadsafdar79@gmail.com');
patch.nvidiaLoggedIn = scan.emails.some((e) => e.includes('emmadsafdar79'));
save(patch);
console.log('\n=== EMAILS SEEN ===', scan.emails.join(', ') || '(none)');
console.log('=== KEYS CAPTURED ===', Object.keys(patch).filter((k) => k.includes('Key') || k.includes('Token')).join(', ') || '(none)');
console.log('saved →', STORE);
await browser.close();
process.exit(0);
