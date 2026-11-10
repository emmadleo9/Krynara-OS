/**
 * Connect patchright DIRECTLY to the user's real Chrome profile 16 via its
 * DevTools port, verify the Gmail lock (emmadsafdar79@gmail.com), then walk the
 * NVIDIA / AI Studio / Mapbox / OpenWeather / ElevenLabs dashboards and harvest
 * API keys from the DOM / local storage.
 *
 * Usage: node extract-keys.mjs --port <debugPort>
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';
const require2 = createRequire('c:/Users/User/.vscode/extensions/danielsanmedium.dscodegpt-3.24.81/standalone/');
const { chromium } = require2('patchright');

const portIdx = process.argv.indexOf('--port');
const port = Number(portIdx >= 0 ? process.argv[portIdx + 1] : 9222);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP(base);
const context = browser.contexts()[0];
let page = context.pages().find((p) => !p.isClosed() && !p.url().startsWith('chrome-error')) ?? context.pages()[0] ?? (await context.newPage());
console.log('using page:', page.url().slice(0, 60));

async function goto(url, { wait = 5000 } = {}) {
  console.log('→', url);
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
  catch (error) { console.log('  nav warn:', String(error).split('\n')[0]); }
  await sleep(wait);
}

async function findEmail() {
  return page.evaluate(() => {
    const text = document.body?.innerText || '';
    return [...new Set(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])].slice(0, 12);
  }).catch(() => []);
}

const results = {};

// Gmail lock — but note: /u/N indexes only matter inside gmail itself
await goto('https://mail.google.com/mail/u/0/', { wait: 7000 });
let emails = await findEmail();
console.log('gmail u0:', emails);
let locked = emails.some((e) => e.toLowerCase() === 'emmadsafdar79@gmail.com');
for (const u of ['1', '2', '3']) {
  if (locked) break;
  await goto(`https://mail.google.com/mail/u/${u}/`, { wait: 5000 });
  emails = await findEmail();
  console.log(`gmail u${u}:`, emails);
  locked = emails.some((e) => e.toLowerCase() === 'emmadsafdar79@gmail.com');
}
// Gmail often hides the email behind an iframe — try accounts.google.com as fallback proof of profile identity
if (!locked) {
  await goto('https://accounts.google.com/b/0/ManageAccount', { wait: 5000 });
  emails = await findEmail();
  console.log('accounts.google:', emails);
  locked = emails.some((e) => e.toLowerCase().includes('emmadsafdar79'));
}
console.log('LOCK VERIFIED:', locked);
results.gmailLock = locked;

// NVIDIA
await goto('https://build.nvidia.com/explore', { wait: 7000 });
emails = await findEmail();
console.log('nvidia emails:', emails);
results.nvidiaLoggedIn = emails.some((e) => e.includes('emmadsafdar79'));
for (const url of ['https://build.nvidia.com/settings/api-keys', 'https://build.nvidia.com/api-keys']) {
  await goto(url, { wait: 5000 });
  let keys = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const set = new Set(text.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
    try { for (let i = 0; i < localStorage.length; i++) { const v = localStorage.getItem(localStorage.key(i)) ?? ''; for (const m of v.match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []) set.add(m); } } catch {}
    return [...set];
  });
  if (!keys.length) {
    const reveal = page.locator('button:has-text("Generate"), button:has-text("Reveal"), [data-testid*="reveal"], [data-testid*="generate"]').first();
    if (await reveal.count().catch(() => 0)) {
      await reveal.click({ timeout: 4000 }).catch(() => {});
      await sleep(2500);
      keys = await page.evaluate(() => (document.body?.innerText || '').match(/nvapi-[A-Za-z0-9_\-]{20,}/g) ?? []);
    }
  }
  if (keys.length) { results.nvidiaApiKey = keys[0]; console.log('NVIDIA KEY FOUND:', keys[0].slice(0, 16) + '…'); break; }
}
if (!results.nvidiaApiKey) console.log('nvidia: key not surfaced');

// Google AI Studio
await goto('https://aistudio.google.com/app/apikey', { wait: 7000 });
const gKeys = await page.evaluate(() => [...new Set((document.body?.innerText || '').match(/AIza[A-Za-z0-9_\-]{30,}/g) ?? [])]);
if (gKeys.length) { results.googleAiKey = gKeys[0]; console.log('GOOGLE AI KEY:', gKeys[0].slice(0, 12) + '…'); }

// Mapbox
await goto('https://account.mapbox.com/access-tokens/', { wait: 7000 });
const mbKeys = await page.evaluate(() => {
  const html = document.documentElement.innerHTML;
  return [...new Set((html.match(/pk\.eyJ[A-Za-z0-9_\-\.]{40,}/g) ?? []))];
});
if (mbKeys.length) { results.mapboxToken = mbKeys[0]; console.log('MAPBOX TOKEN:', mbKeys[0].slice(0, 14) + '…'); }

// OpenWeather
await goto('https://home.openweathermap.org/api_keys', { wait: 7000 });
const owKeys = await page.evaluate(() => [...new Set((document.body?.innerText || '').match(/\b[0-9a-f]{32}\b/g) ?? [])]);
if (owKeys.length) { results.openWeatherKey = owKeys[0]; console.log('OPENWEATHER KEY:', owKeys[0].slice(0, 8) + '…'); }

// ElevenLabs
await goto('https://elevenlabs.io/app/settings/api-keys', { wait: 7000 });
const elKeys = await page.evaluate(() => [...new Set((document.documentElement.innerHTML + document.body?.innerText).match(/\b(?:sk_)[A-Za-z0-9]{20,}\b/g) ?? [])]);
if (elKeys.length) { results.elevenLabsKey = elKeys[0]; console.log('ELEVENLABS KEY FOUND'); }

console.log('\n===== SUMMARY (keys truncated) =====');
const safe = JSON.parse(JSON.stringify(results));
if (safe.nvidiaApiKey) safe.nvidiaApiKey = safe.nvidiaApiKey.slice(0, 12) + '…';
if (safe.googleAiKey) safe.googleAiKey = safe.googleAiKey.slice(0, 10) + '…';
if (safe.mapboxToken) safe.mapboxToken = safe.mapboxToken.slice(0, 12) + '…';
if (safe.openWeatherKey) safe.openWeatherKey = safe.openWeatherKey.slice(0, 8) + '…';
if (safe.elevenLabsKey) safe.elevenLabsKey = safe.elevenLabsKey.slice(0, 8) + '…';
console.log(JSON.stringify(safe, null, 1));

mkdirSync(path.join(STORAGE_ROOT, 'config'), { recursive: true });
writeFileSync(path.join(STORAGE_ROOT, 'config', 'harvested-keys.json'), JSON.stringify(results, null, 2));
console.log('FULL KEYS →', path.join(STORAGE_ROOT, 'config', 'harvested-keys.json'));
await browser.close();
process.exit(0);
