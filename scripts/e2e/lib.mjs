// Generic Playwright harness for a web-scumm game, shared by scripts/e2e.mjs and any games/<id>/e2e.mjs.
// A phone-sized, touch-enabled Chromium drives the real browser build through window.__game (see src/main.ts):
// every helper below ends up as a real tap, the same way a finger would act on a phone, never a synthetic
// state write. Screenshots land in E2E_OUT (default /tmp/e2e, cleared at the start of each run).
//
// launch(url, opts) -> harness:
//   page, errors                  the Playwright page, and console/page errors collected so far
//   screenshot(name)              numbered PNG into E2E_OUT
//   tapXY(x, y) / tapScene(x, y)  a raw tap, or a tap given in the scene's logical 640 x 400 coordinates
//   drag(points, stepMs?)         a finger drag through logical scene points (build points with `line`)
//   line(a, z, n)                 n + 1 points from a to z, for drag()
//   pointOn(id)                   a scene point where a tap really lands on `id` (its box center can be hidden)
//   tapTarget(id)                 taps pointOn(id) in the scene
//   verb(label)                   taps the verb button with this visible label
//   itemSlot(id) / item(id)       locates the bag slot for an item id (paging through the bag if needed) / taps it
//   inInventory(id) / target(id)  true if the item is in the bag; taps it there, else taps it in the scene
//   state()                       { busy, speech, text, choices, map } snapshot of the engine/UI
//   waitIdle(opts?)               advances speech, skips a minigame's `.mg-skip`, stops at a choice or idle
//   openMap()                     taps the map tool and waits for the map overlay
//   say(text)                     taps a `.choice` containing this text (a talk topic, or a map place)
//   skip()                        taps the minigame's `.mg-skip` button if present; true if it did
//   act(action)                   drives { verb, a, b? } straight through window.__game.engine.act, no tapping
//   play(steps)                   plays [{ verb, a, b? }, …] (verb ids, see src/engine/core/engine.ts Action) by tapping
//   walkthrough(steps)            replays session entries (`npm run solve -- --json` steps, an exported session) by tapping
//   close()                       closes the browser
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';

const VIEWPORT = { width: 844, height: 390 };
// Logical scene coordinates (640 x 400): the same system as the placement editor (docs/en/TOOLS.md).
const LOGICAL = { width: 640, height: 400 };

export async function launch(url, opts = {}) {
  const out = opts.out ?? process.env.E2E_OUT ?? '/tmp/e2e';
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (f.endsWith('.png')) rmSync(`${out}/${f}`);

  const browserName = opts.browser ?? process.env.E2E_BROWSER ?? 'chromium';
  const browserType = { chromium, firefox, webkit }[browserName];
  if (!browserType) throw new Error(`unknown E2E browser "${browserName}" (expected chromium, webkit or firefox)`);
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  // E2E_CPU=4 slows the page's CPU like a shared CI runner (Chromium only), to reproduce timing failures locally.
  if (cdp && process.env.E2E_CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.E2E_CPU) });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const dest = new URL(url);
  // ?dev&at=<checkpoint> : dev-server only (ignored in a production build, see docs/en/TOOLS.md), skips the title screen.
  if (opts.dev !== false) dest.searchParams.set('dev', '');
  if (opts.at) dest.searchParams.set('at', opts.at);
  await page.goto(dest.toString());
  await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  // The ?dev debug layer (hotspot boxes, labels, an SVG laid directly over .scene) defaults to visible: hide it
  // so screenshots show the real art, unless the caller wants it (opts.overlay: true), e.g. to debug a hit test.
  if (opts.dev !== false && opts.overlay !== true) {
    await page.waitForSelector('.scene > svg', { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { const svg = document.querySelector('.scene > svg'); if (svg) svg.style.display = 'none'; });
  }

  let shotN = 0;
  async function screenshot(name) {
    return page.screenshot({ path: `${out}/${String(++shotN).padStart(3, '0')}-${name}.png` });
  }

  // ------------------------------------------------------------------ taps and drags

  async function tapXY(x, y) { await page.touchscreen.tap(x, y); }
  async function sceneRect() { return page.locator('.scene').boundingBox(); }
  async function tapScene(x, y) {
    // Wide rooms: logical coordinates are world coordinates; the scene shows them shifted by the camera.
    x -= await page.evaluate(() => window.__game?.view?.cam ?? 0);
    const r = await sceneRect();
    if (!r) throw new Error('tapScene: .scene is not visible');
    await tapXY(r.x + (x / LOGICAL.width) * r.width, r.y + (y / LOGICAL.height) * r.height);
  }

  /** A finger drag through touch events in Chromium, with pointer-event fallback on the other browser engines. */
  async function drag(points, stepMs = 16) {
    const r = await sceneRect();
    const toPx = ([x, y]) => [r.x + (x / LOGICAL.width) * r.width, r.y + (y / LOGICAL.height) * r.height];
    const first = toPx(points[0]);
    if (cdp) {
      const send = (type, [x, y]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      await send('touchStart', first);
      for (const p of points.slice(1)) { await send('touchMove', toPx(p)); await page.waitForTimeout(stepMs); }
      await send('touchEnd', toPx(points[points.length - 1]));
    } else {
      await page.mouse.move(first[0], first[1]); await page.mouse.down();
      for (const p of points.slice(1)) { const [x, y] = toPx(p); await page.mouse.move(x, y); await page.waitForTimeout(stepMs); }
      await page.mouse.up();
    }
  }
  const line = (a, z, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((z[0] - a[0]) * i) / n, a[1] + ((z[1] - a[1]) * i) / n]);

  /** A scene point where a tap really lands on `id` (its box center can be hidden by someone standing on it). */
  async function pointOn(id) {
    return page.evaluate((id) => {
      const v = window.__game.view; const box = v.box(id);
      if (!box) return null;
      const [x, y, w, h] = box;
      const tries = [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.5, 0.15], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5]];
      for (const [kx, ky] of tries) { const q = [x + w * kx, y + h * ky]; if (v.hit(q) === id) return q; }
      return [x + w / 2, y + h / 2];
    }, id);
  }
  async function tapTarget(id) {
    const q = await pointOn(id);
    if (!q) throw new Error(`tapTarget: no box for ${id}`);
    await tapScene(q[0], q[1]);
  }

  // ------------------------------------------------------------------ verbs, the bag

  async function verb(label) {
    for (let k = 0; k < 50; k++) {
      await page.locator('.verb', { hasText: label }).tap();
      const ok = await page.evaluate((l) => window.__game.game.verbs.find((v) => v.id === window.__game.verb)?.label === l, label);
      if (ok) return;
      await page.waitForTimeout(150);
    }
    throw new Error(`verb: refused "${label}"`);
  }

  let verbsCache = null;
  async function verbs() {
    if (!verbsCache) verbsCache = await page.evaluate(() => window.__game.game.verbs.map((v) => ({ id: v.id, label: v.label, join: v.join || '→' })));
    return verbsCache;
  }
  async function verbById(id) {
    const vb = (await verbs()).find((v) => v.id === id);
    if (!vb) throw new Error(`verbById: unknown verb "${id}"`);
    await verb(vb.label);
  }

  async function itemSlot(id) {
    const name = await page.evaluate((id) => window.__game.engine.game.items[id]?.name ?? id, id);
    const sel = `.slot[aria-label="${name.replace(/"/g, '\\"')}"]`;
    for (let k = 0; k < 8; k++) {
      if (await page.locator(sel).count()) return page.locator(sel).first();
      // next bag page, then back to the top
      const nav = page.locator('.invnav button');
      const down = nav.nth(1), up = nav.nth(0);
      if (k < 4 && (await down.count()) && !(await down.isDisabled())) await down.tap();
      else if ((await up.count()) && !(await up.isDisabled())) await up.tap();
      await page.waitForTimeout(60);
    }
    throw new Error(`itemSlot: not in the bag: ${id}`);
  }
  async function item(id) { await (await itemSlot(id)).tap(); }
  const inInventory = (id) => page.evaluate((id) => window.__game.engine.state.inventory.includes(id), id);
  async function target(id) { if (await inInventory(id)) await item(id); else await tapTarget(id); }

  // ------------------------------------------------------------------ waiting for the engine

  /** What the engine was doing when a step failed: busy, speech, choices, overlays, the side column's state, the
   * last journal lines and the busy counter — printed by scripts/e2e.mjs so a CI log explains a timed-out tap. */
  async function diagnose() {
    return page.evaluate(() => {
      const e = window.__game?.engine;
      return {
        busy: !!e?.busy, busyCount: e?.busyCount, room: e?.state?.room,
        sideOff: !!document.querySelector('.side.off'), choosing: !!document.querySelector('.side .choices .choice'),
        overlays: [...document.querySelectorAll('.overlay')].map((o) => o.className),
        speech: document.querySelector('.scene > .speech, .scene > .narr')?.textContent?.slice(0, 80) ?? null,
        trace: (e?.trace ?? []).slice(-6),
      };
    }).catch((err) => ({ error: String(err) }));
  }

  async function state() {
    return page.evaluate(() => {
      const speechEl = document.querySelector('.scene > .speech, .scene > .narr');
      return {
        busy: !!window.__game.engine.busy,
        speech: !!speechEl,
        text: speechEl?.textContent ?? '',
        choices: document.querySelectorAll('.side .choices .choice').length,
        map: !!document.querySelector('.overlay.mapview'),
      };
    });
  }

  async function skip() {
    const b = page.locator('.overlay .mg-skip');
    if (!(await b.count())) return false;
    // The overlay may be mid-transition (a minigame just won, its card fading): tap without waiting for the button
    // to be stable, and treat one detached in the meantime as already gone (CI runners hit that race every time).
    try { await b.first().tap({ force: true, timeout: 3000 }); return true; } catch { return false; }
  }

  /** A one-button overlay card (e.g. an incoming phone call's "pick up"): a single `.bigbtn` in a non-map
   * overlay, as opposed to the 2-button ending card or the map's region-zoom button next to its place list. */
  async function confirmCard() {
    const overlays = page.locator('.overlay:not(.mapview)');
    for (let i = 0; i < (await overlays.count()); i++) {
      const b = overlays.nth(i).locator('.bigbtn');
      if ((await b.count()) === 1) { await b.first().tap(); return true; }
    }
    return false;
  }

  /** After a talk topic is picked, the conversation's lines also echo into a `.transcript` read-along panel
   * in the side column, which hides the verb buttons until tapped away. It self-closes ~120ms after the last
   * line if nothing else is pending, but that races the next step here: close it explicitly instead. */
  async function dismissTranscript() {
    const t = page.locator('.side .transcript');
    if (await t.count()) { await t.first().tap().catch(() => {}); return true; }
    return false;
  }

  /** Advances speech by tapping the scene, skips a minigame if it offers `.mg-skip`, answers a one-button
   * overlay card, closes a conversation's leftover transcript, and returns once the engine is idle or a
   * choice (talk topic, map place, menu…) needs the caller. */
  async function waitIdle({ max = 10000, interval = 80 } = {}) {
    for (let waited = 0; waited < max; waited += interval) {
      const s = await state();
      if (s.speech) { await tapScene(320, 10).catch(() => {}); await page.waitForTimeout(interval); continue; }
      if (await skip()) { await page.waitForTimeout(interval); continue; }
      if (s.choices) return s;
      if (await confirmCard()) { await page.waitForTimeout(interval); continue; }
      if (await dismissTranscript()) { await page.waitForTimeout(interval); continue; }
      if (!s.busy) {
        await page.waitForTimeout(interval);
        const s2 = await state();
        if (!s2.busy && !s2.speech && !s2.choices) return s2;
        continue;
      }
      await page.waitForTimeout(interval);
    }
    throw new Error('waitIdle: timed out');
  }

  async function openMap() {
    await page.locator('.tools .tool:not(.player)').first().tap(); // the map tool is always the first (see src/engine/dom/app.ts)
    for (let i = 0; i < 50; i++) { if ((await state()).map) return; await page.waitForTimeout(80); }
    throw new Error('openMap: the map did not open');
  }

  const choiceTexts = () => page.evaluate(() => [...document.querySelectorAll('.side .choices .choice')].map((e) => e.textContent));

  /** Taps the `.choice` containing this text: a talk topic, or a map place once openMap() ran.
   * Polls for a moment first: the list can still be rendering right after the tap that opened it. A map
   * travel keeps its place list on screen through the travel animation (~2s): wait for that same list to
   * actually change (or for speech/busy/no-choices) before handing off to waitIdle, instead of returning
   * the instant we see *a* choices list, which could be the stale one we just tapped. */
  async function say(text, { max = 12000 } = {}) {
    const c = page.locator('.side .choices .choice', { hasText: text });
    for (let waited = 0; waited < max; waited += 100) {
      if (await c.count()) break;
      await page.waitForTimeout(100);
    }
    if (!(await c.count())) throw new Error(`say: no choice matching "${text}"`);
    const before = await choiceTexts();
    await c.first().tap();
    for (let waited = 0; waited < 6000; waited += 100) {
      const s = await state();
      if (s.busy || s.speech || !s.choices) break;
      const now = await choiceTexts();
      if (now.length !== before.length || now.some((t, i) => t !== before[i])) break;
      await page.waitForTimeout(100);
    }
    return waitIdle();
  }

  // ------------------------------------------------------------------ scripted actions, playback

  /** Drives { verb, a, b? } straight through the engine (window.__game.engine.act), bypassing taps: a fallback
   * for a step that is awkward to script by touch (precise geometry, a flaky animation…). */
  async function act(action) {
    await page.evaluate((a) => window.__game.engine.act(a), action);
    return waitIdle();
  }

  /** Plays a list of { verb, a, b? } steps (verb and target ids, see src/engine/core/engine.ts `Action`) by tapping. */
  async function play(steps) {
    for (const step of steps) {
      await verbById(step.verb);
      await target(step.a);
      if (step.b) await target(step.b);
      await waitIdle();
    }
  }

  /** Taps the n-th option of the open choice list (a talk topic, a nested reply, "Bye"): the index the engine
   * recorded in the session entry's `picks`. Polls for the list first: it can still be rendering. */
  async function pick(i, { max = 3000 } = {}) {
    const all = page.locator('.side .choices .choice');
    for (let waited = 0; waited < max; waited += 100) {
      if ((await all.count()) > i) break;
      await page.waitForTimeout(100);
    }
    if ((await all.count()) <= i) throw new Error(`pick: no choice #${i} (${await all.count()} shown)`);
    const before = await choiceTexts();
    await all.nth(i).tap();
    for (let waited = 0; waited < 6000; waited += 100) {
      const s = await state();
      if (s.busy || s.speech || !s.choices) break;
      const now = await choiceTexts();
      if (now.length !== before.length || now.some((t, i) => t !== before[i])) break;
      await page.waitForTimeout(100);
    }
    return waitIdle();
  }

  /** Answers the choice prompts an action opened, in the recorded order (`SessionEntry.picks`); a conversation
   * ends with its "Bye" pick. Leftover prompts (a recording that stopped mid-conversation) are closed on the
   * last option, as the solver's silent presenter would. */
  async function answer(picks = []) {
    let s = await waitIdle();
    for (const i of picks) { if (!s.choices) break; s = await pick(i); }
    for (let n = 0; n < 5 && s.choices; n++) { await page.locator('.side .choices .choice').last().tap(); s = await waitIdle(); }
    return s;
  }

  /** The world's scripts run on their own in the browser: a "Script <id>" step of the solver's path only waits
   * until that script has moved on (its saved position changed, or it finished), then until the engine is idle. */
  async function waitScript(id, { timeout = 20000 } = {}) {
    const before = await page.evaluate((i) => JSON.stringify(window.__game.engine.state.scripts?.[i] ?? null), id);
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const now = await page.evaluate((i) => JSON.stringify(window.__game.engine.state.scripts?.[i] ?? null), id);
      if (now !== before) break;
      await page.waitForTimeout(200);
    }
    return waitIdle();
  }

  /** A place's name on the map (the map lists places by name). */
  const placeName = (id) => page.evaluate((p) => window.__game.game.map?.places?.[p]?.name ?? p, id);

  /** Replays session entries (`npm run solve -- --json` `steps`, or an exported session's `log`) by tapping:
   * the verb and targets of an action, then its recorded answers; the map; another playable character; a
   * script step (waits for the script to move). A `start` entry (the new game) is the caller's business. */
  async function walkthrough(steps) {
    for (const [i, en] of steps.entries()) {
      if ('start' in en) { console.log(`walkthrough: step ${i + 1} is the new game itself, skipped`); continue; }
      if ('act' in en) {
        if (en.aborted) continue;
        await verbById(en.act.verb); await target(en.act.a); if (en.act.b) await target(en.act.b);
        await answer(en.picks);
      } else if ('travel' in en) { await openMap(); await say(await placeName(en.travel)); }
      else if ('map' in en) { await openMap(); if (en.maps?.[0]) await say(await placeName(en.maps[0])); else { await page.keyboard.press('Escape').catch(() => {}); await waitIdle(); } }
      else if ('step' in en) { await waitScript(en.step); }
      else if ('switch' in en) { await page.locator(`.tools .tool.player[data-player="${en.switch}"]`).tap(); await waitIdle(); }
      else if ('script' in en) { await page.evaluate((c) => window.__game.engine.script(c), en.script); await waitIdle(); }
      else if ('enter' in en) { await page.evaluate((r) => window.__game.engine.teleport(r), en.enter); await waitIdle(); }
      await screenshot(`walk-${String(i + 1).padStart(3, '0')}`).catch(() => {});
    }
  }

  async function close() { await browser.close(); }

  return {
    page, errors, screenshot, tapXY, tapScene, drag, line, pointOn, tapTarget, verb, verbById,
    itemSlot, item, inInventory, target, state, diagnose, waitIdle, openMap, say, pick, answer, skip, act, play, walkthrough, close,
  };
}
