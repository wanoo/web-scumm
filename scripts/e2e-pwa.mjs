#!/usr/bin/env node
// Smoke-test the production PWA: registration, the whole game cached for offline play (`GameDef.offline`), one online
// reload, then an offline navigation with every file of the warm-up plan found in the cache.
// The built app must already be served (normally with `npm run preview`). `--nearby`: the game caches only nearby
// rooms, skip the plan check. `--budget=<ms>`: how long the full warm-up may take (default 120000).
// Exit codes: 0 proved, 1 failed, 3 skipped (the browser cannot navigate offline under automation: WebKit); the CI's
// WebKit job passes `--allow-skip` to turn 3 into 0 with an explicit "skipped" line, never into a proof.
import { chromium, firefox, webkit } from 'playwright';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const name = process.env.E2E_BROWSER ?? 'chromium';
const nearby = process.argv.includes('--nearby');
const allowSkip = process.argv.includes('--allow-skip');
const budget = Number(process.argv.find((a) => a.startsWith('--budget='))?.slice('--budget='.length) ?? 120000);
const browserType = { chromium, firefox, webkit }[name];
if (!browserType) throw new Error(`unknown E2E_BROWSER ${name}`);

const browser = await browserType.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  const supported = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!supported) throw new Error('service workers are not supported by this browser context');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The whole game warmed (App.offlineReady) and the status must say `complete`: a skip or a failure is not "ready".
  let urls = null;
  if (!nearby) {
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
    const status = await page.evaluate(
      (ms) =>
        Promise.race([
          window.__game.offlineReady,
          new Promise((_, rej) => setTimeout(() => rej(new Error(`offline warm-up took more than ${ms} ms`)), ms)),
        ]),
      budget,
    );
    if (status.state !== 'complete')
      throw new Error(
        `offline warm-up ended "${status.state}" (${status.done}/${status.total} files${status.reason ? `, ${status.reason}` : ''}${status.failed.length ? `; failed: ${status.failed.slice(0, 5).join(', ')}` : ''})`,
      );
    urls = await page.evaluate(() => window.__game.offlineUrls());
    console.log(`pwa: ${name} warm-up complete, ${status.done}/${status.total} files`);
  }
  await page.reload({ waitUntil: 'networkidle' });
  // The precache must exist before going offline: that is what serves the shell without the network.
  const cacheNames = await page.evaluate(() => caches.keys());
  if (!cacheNames.some((n) => n.startsWith('workbox-precache')))
    throw new Error(`no workbox precache after install (caches: ${cacheNames.join(', ') || 'none'})`);
  await context.setOffline(true);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    // Playwright's WebKit cannot navigate while its context is offline ("WebKit encountered an internal error"),
    // even with the worker ready and the caches filled. That is a skip, not a proof: exit 3 unless the caller
    // accepts it (`--allow-skip`); the offline navigation is proven on Chromium.
    if (name === 'webkit' && /internal error/i.test(String(e))) {
      console.log(
        `pwa: SKIPPED on ${name}: installed, warm-up complete, precache present (${cacheNames.length} caches), but offline navigation is not automatable on this engine${allowSkip ? ' (accepted by --allow-skip)' : ''}`,
      );
      await context.setOffline(false).catch(() => {});
      await browser.close();
      process.exit(allowSkip ? 0 : 3);
    }
    throw e;
  }
  await page.locator('#app').waitFor({ state: 'attached' });
  const title = await page.title();
  if (urls) {
    // Every file of the plan, from the cache, offline: images, effects, voices, music, videos.
    const missing = await page.evaluate(async (list) => {
      const out = [];
      for (const u of list) if (!(await caches.match(u))) out.push(u);
      return out;
    }, urls);
    if (missing.length)
      throw new Error(
        `offline: ${missing.length}/${urls.length} file(s) of the plan are not in the cache: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
      );
    // A room the player never visited renders from the cache.
    const decor = await page.evaluate(async () => {
      const app = window.__game,
        g = app.game;
      const room = g.rooms.find((r) => r.id !== g.start.room) ?? g.rooms[0];
      const im = new Image();
      im.src = app.bank.img(room.decor);
      await new Promise((r) => {
        im.onload = im.onerror = r;
      });
      return { room: room.id, width: im.naturalWidth };
    });
    if (!decor.width)
      throw new Error(`offline: the decor of room "${decor.room}" (never visited) did not render from the cache`);
    console.log(
      `pwa: ${name} installed, opened offline (${title}), ${urls.length} files of the plan in the cache, room "${decor.room}" never visited rendered from it`,
    );
  } else console.log(`pwa: ${name} installed and opened offline (${title})`);
} finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
}
if (errors.length) {
  console.error(errors.map((e) => `browser: ${e}`).join('\n'));
  process.exit(1);
}
