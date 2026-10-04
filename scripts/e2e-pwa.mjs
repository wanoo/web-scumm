#!/usr/bin/env node
// Smoke-test the production PWA shell: registration, one online reload, then an offline navigation.
// The built app must already be served (normally with `npm run preview`).
import { chromium, firefox, webkit } from 'playwright';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const name = process.env.E2E_BROWSER ?? 'chromium';
const browserType = { chromium, firefox, webkit }[name];
if (!browserType) throw new Error(`unknown E2E_BROWSER ${name}`);

const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  const supported = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!supported) throw new Error('service workers are not supported by this browser context');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#app').waitFor({ state: 'attached' });
  const title = await page.title();
  console.log(`pwa: ${name} installed and opened offline (${title})`);
} finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
}
if (errors.length) {
  console.error(errors.map((e) => `browser: ${e}`).join('\n'));
  process.exit(1);
}
