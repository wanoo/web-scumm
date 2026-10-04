#!/usr/bin/env node
// Smoke-test the production PWA: registration, the whole game cached for offline play (`GameDef.offline`), one online
// reload, then an offline navigation and the assets of a room never visited served from the cache.
// The built app must already be served (normally with `npm run preview`). `--nearby`: the game caches only nearby
// rooms, skip the room check. `--budget=<ms>`: how long the full warm-up may take (default 120000).
import { chromium, firefox, webkit } from 'playwright';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const name = process.env.E2E_BROWSER ?? 'chromium';
const nearby = process.argv.includes('--nearby');
const budget = Number(process.argv.find((a) => a.startsWith('--budget='))?.slice('--budget='.length) ?? 120000);
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
  // The whole game warmed (App.offlineReady), then a room the player never visited must come from the cache.
  let probe = null;
  if (!nearby) {
    await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
    await page.evaluate((ms) => Promise.race([window.__game.offlineReady, new Promise((_, rej) => setTimeout(() => rej(new Error(`offline warm-up took more than ${ms} ms`)), ms))]), budget);
    probe = await page.evaluate(() => {
      const app = window.__game, g = app.game;
      const room = g.rooms.find((r) => r.id !== g.start.room) ?? g.rooms[0];
      const sfx = Object.values(g.audio?.sfx ?? {})[0];
      return { room: room.id, decor: app.bank.img(room.decor), sfx: sfx ? app.bank.sfx(sfx) : null };
    });
  }
  await page.reload({ waitUntil: 'networkidle' });
  // The precache must exist before going offline: that is what serves the shell without the network.
  const cacheNames = await page.evaluate(() => caches.keys());
  if (!cacheNames.some((n) => n.startsWith('workbox-precache'))) throw new Error(`no workbox precache after install (caches: ${cacheNames.join(', ') || 'none'})`);
  await context.setOffline(true);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    // Playwright's WebKit cannot navigate while its context is offline ("WebKit encountered an internal error"),
    // even with the worker ready and the caches filled. Report what was verified instead of a false failure; the
    // offline navigation itself is proven on Chromium.
    if (name === 'webkit' && /internal error/i.test(String(e))) {
      console.log(`pwa: ${name} installed, precache present (${cacheNames.length} caches); offline navigation is not automatable on this engine`);
      // The aborted offline navigation leaves resource-load errors behind: they are the symptom, not a finding.
      if (errors.length) console.log(errors.map((x) => `pwa: (ignored on ${name}) ${x}`).join('\n'));
      await context.setOffline(false).catch(() => {});
      await browser.close();
      process.exit(0);
    }
    throw e;
  }
  await page.locator('#app').waitFor({ state: 'attached' });
  const title = await page.title();
  if (probe) {
    const cached = await page.evaluate(async (p) => ({ decor: !!(await caches.match(p.decor, { ignoreSearch: false })), sfx: p.sfx ? !!(await caches.match(p.sfx)) : true }), probe);
    if (!cached.decor || !cached.sfx) throw new Error(`offline: room "${probe.room}" is not in the cache (decor ${cached.decor}, sfx ${cached.sfx})`);
    console.log(`pwa: ${name} installed, opened offline (${title}), room "${probe.room}" never visited served from the cache`);
  } else console.log(`pwa: ${name} installed and opened offline (${title})`);
} finally {
  await context.setOffline(false).catch(() => {});
  await browser.close();
}
if (errors.length) {
  console.error(errors.map((e) => `browser: ${e}`).join('\n'));
  process.exit(1);
}
