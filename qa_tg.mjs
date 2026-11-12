// Social Hub / Telegram live QA — drives the real console at :5173 through
// the gateway (:2785) to the TDLib bridge (:2787).
// Run: node qa_tg.mjs
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE || 'http://localhost:5173';

export default async function run(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  for (const t of ['SOCIAL HUB', 'Telegram']) {
    const el = page.getByText(t, { exact: false }).first();
    await el.click({ timeout: 8000 }).catch(() => { });
    await page.waitForTimeout(1500);
  }
  await page.waitForFunction(
    () => document.querySelectorAll('.chat-list-item').length > 0 || document.querySelector('.social-local-note'),
    null,
    { timeout: 60000 }
  ).catch(() => { });
  return {
    href: page.url(),
    chatItems: await page.evaluate(() => document.querySelectorAll('.chat-list-item').length),
    note: await page.evaluate(() => document.querySelector('.social-local-note')?.innerText || null),
    bubbles: await page.evaluate(() => document.querySelectorAll('.chat-bubble').length),
    firstChat: await page.evaluate(() => document.querySelector('.chat-list-title')?.innerText || null),
  };
}

// Direct execution: launch a browser and run the checks above.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('qa_tg.mjs')) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  try {
    const result = await run(page);
    console.log('QA RESULT:', JSON.stringify(result, null, 2));
    if (logs.length) console.log('PAGE ERRORS:', logs.slice(0, 5));
    process.exitCode = result.chatItems > 0 ? 0 : 1;
  } catch (err) {
    console.error('QA FAILED:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
