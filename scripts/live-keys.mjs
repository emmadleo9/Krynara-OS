/**
 * Read live pages from the debug chrome and interactively sign in where needed.
 * Usage: node live-keys.mjs <mode>  — modes: gmail | nvidia | google | mapbox | openweather | elevenlabs | status
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';
const require2 = createRequire('c:/Users/User/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/');
const { chromium } = require2('patchright');

const mode = process.argv[2] ?? 'status';
const STORE = path.join(STORAGE_ROOT, 'config', 'harvested-keys.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const live = context.pages().find((p) => !p.isClosed() && !p.url().startsWith('chrome-error') && !p.url().startsWith('devtools'));
let page = live ?? (await context.newPage());

async function goto(url, { wait = 6000 } = {}) {
  console.log('→', url);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
  catch (error) { console.log('  nav warn:', String(error).split('\n')[0]); }
  await sleep(wait);
}
const emails = () => page.evaluate(() => [...new Set((document.body?.innerText || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])]).catch(() => []);
const load = () => existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const save = (patch) => { const data = { ...load(), ...patch }; mkdirSync(path.join(STORAGE_ROOT, 'config'), { recursive: true }); writeFileSync(STORE, JSON.stringify(data, null, 2)); };

if (mode === 'status') {
  console.log('page:', page.url());
  console.log('emails on page:', await emails());
  console.log('stored:', Object.keys(load()));
} else if (mode === 'gmail') {
  await goto('https://mail.google.com/mail/u/0/');
  console.log('emails:', await emails());
} else if (mode === 'nvidia') {
  await goto('https://build.nvidia.com/explore');
  const found = await emails();
  console.log('nvidia emails:', found.slice(0, 5));
  const keys = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
    return [...set];
  });
  console.log('nvapi keys visible:', keys.length);
  if (keys.length) { save({ nvidiaApiKey: keys[0], nvidiaLoggedIn: found.some((e) => e.includes('emmadsafdar79')) }); console.log('SAVED'); }
  else console.log('NO KEY ON PAGE — user may need to click Generate Personal Key, then run: nvidia-grab');
} else if (mode === 'nvidia-grab') {
  const keys = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch { }
    return [...set];
  });
  if (keys.length) { save({ nvidiaApiKey: keys[0] }); console.log('NVIDIA KEY SAVED:', keys[0].slice(0, 14) + '…'); }
  else console.log('still nothing — is the key revealed on screen?');
} else if (mode === 'google') {
  await goto('https://aistudio.google.com/app/apikey');
  const keys = await page.evaluate(() => [...new Set((document.body?.innerText || '').match(/AIza[A-Za-z0-9_\-]{30,}/g) ?? [])]);
  if (keys.length) { save({ googleAiKey: keys[0] }); console.log('GOOGLE KEY SAVED:', keys[0].slice(0, 10) + '…'); }
  else console.log('no AIza key visible — may need to click "Create API key"');
} else if (mode === 'mapbox') {
  await goto('https://account.mapbox.com/access-tokens/');
  const keys = await page.evaluate(() => [...new Set(document.documentElement.innerHTML.match(/pk\.eyJ[A-Za-z0-9_\-\.]{40,}/g) ?? [])]);
  if (keys.length) { save({ mapboxToken: keys[0] }); console.log('MAPBOX SAVED:', keys[0].slice(0, 14) + '…'); }
  else console.log('no pk.eyJ token visible');
} else if (mode === 'openweather') {
  await goto('https://home.openweathermap.org/api_keys');
  const keys = await page.evaluate(() => [...new Set((document.body?.innerText || '').match(/\b[0-9a-f]{32}\b/g) ?? [])]);
  if (keys.length) { save({ openWeatherKey: keys[0] }); console.log('OPENWEATHER SAVED:', keys[0].slice(0, 8) + '…'); }
  else console.log('no 32-hex key visible — may need Generate');
} else if (mode === 'elevenlabs') {
  // sign-in page currently — report so user knows to log in inside this very window
  await goto('https://elevenlabs.io/app/settings/api-keys');
  const keys = await page.evaluate(() => [...new Set(document.documentElement.innerHTML.match(/\bsk_[A-Za-z0-9]{20,}\b/g) ?? [])]);
  const signedIn = !(page.url().includes('sign-in'));
  console.log('signed in:', signedIn, 'url:', page.url().slice(0, 70));
  if (keys.length) { save({ elevenLabsKey: keys[0] }); console.log('ELEVENLABS SAVED'); }
}
console.log('stored keys now:', Object.keys(load()).join(', ') || '(none)');
await browser.close();
process.exit(0);
