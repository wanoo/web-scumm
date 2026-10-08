// npm run e2e:a11y [url] [--only=axe,keys,storage] [--allow-skip]
// The accessibility and storage gates a real browser has to prove (E2E_BROWSER=chromium|webkit), on the production
// build of the sample game (`npm run build:web && npm run preview`):
//   axe      axe-core on a conversation menu, the map, the save and load slots, the overwrite and restart
//            confirmations, and every built-in minigame: a serious or critical violation fails (AXE_ACCEPTED aside).
//   keys     every built-in minigame won with the keyboard alone (Playwright key presses, the page read as a player
//            reads it: images, labels, highlights); a win is a minigame that ended without its Skip button
//            (`App.minigameLog`). Skip itself is checked once at the keyboard.
//   storage  a save left by an older version is upgraded and loaded by this build: the v2 localStorage autosave and
//            slot (imported into IndexedDB, then removed), and a 3.1.0 envelope already in IndexedDB; then a manual
//            save survives a reload.
// Exit codes: 0 passed, 1 failed, 3 a check this browser cannot run under automation (`--allow-skip` makes it 0),
// never a silent pass. The minigames are launched with the engine's own script hook, with params that use the
// sample game's images (the demo plays only two of them).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './e2e/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const only = new Set((args.find((a) => a.startsWith('--only='))?.slice(7) ?? 'axe,keys,storage').split(','));
const allowSkip = args.includes('--allow-skip');
const browser = process.env.E2E_BROWSER ?? 'chromium';
const log = (m) => console.log(`e2e:a11y [${browser}] ${m}`);
const failures = [];
const skips = [];

// ------------------------------------------------------------------ minigame params (the sample game's images)

const PARAMS = {
  pick: {
    rounds: [
      { prompt: 'The red flower.', options: ['minigame/r1c2', 'minigame/r1c1', 'minigame/r1c3'], answer: 1 },
      { prompt: 'The yellow one.', options: ['minigame/r1c5', 'minigame/r1c4', 'minigame/r1c2'], answer: 2 },
    ],
    decoy: 'minigame/r1c6',
    decoyLine: 'A nettle.',
    wrongLine: 'Not that one.',
    win: 'A bouquet!',
  },
  pipes: {
    tiles: {
      ground: 'pipes/r3c1',
      straight: ['pipes/r3c2', 'pipes/r3c5'],
      elbow: ['pipes/r3c3', 'pipes/r3c6'],
      tee: ['pipes/r3c4', 'pipes/r4c1'],
    },
    source: 'pipes/r4c2',
    nozzle: ['pipes/r4c3', 'pipes/r4c4'],
    tank: 'house/r3c5',
    mushrooms: ['house/r4c5', 'house/r4c6'],
    // The game's own help from the first move: the next tile to turn is highlighted, as a player sees it.
    helpAfter: 0,
    intro: 'Turn the pipes.',
    win: 'Water!',
  },
  hide: {
    bg: 'decor/backyard',
    intro: 'Where is the cat?',
    win: 'Found!',
    answer: 2,
    spots: [
      { img: 'house/r4c5', x: 150, y: 340, h: 110, reply: 'Not here.' },
      { img: 'house/r4c6', x: 320, y: 340, h: 110, reply: 'Warmer.' },
      { img: 'house/r3c6', x: 490, y: 340, h: 120, found: 'house/r3c5' },
    ],
  },
  cables: {
    board: 'house/r3c5',
    knot: 'minigame/r3c1',
    intro: 'Plug each cable.',
    win: 'Lights on!',
    plugs: { red: 'items/r2c1', blue: 'items/r2c2', green: 'items/r2c4', yellow: 'items/r4c1' },
    sockets: ['yellow', 'green', 'blue', 'red'],
    sfx: { stamp: 'click' },
  },
  runner: {
    hero: { run: ['hero/r2c1', 'hero/r2c2'], jump: 'hero/r2c3', slide: 'hero/r2c4', stumble: 'hero/r2c5' },
    chaser: { frames: ['cat/r2c1', 'cat/r2c2'] },
    obstacles: { jump: 'items/r4c3', duck: 'minigame/r4c1' },
    bg: 'decor/backyard',
    seconds: 9,
    stumble: 'Oops!',
    intro: 'Run!',
    win: 'Safe!',
  },
  scratch: { ticket: 'items/r4c1', text: 'You won!', threshold: 0.55, hold: 600, intro: 'Scratch it.' },
  stroke: { target: 'cat/r2c1', hand: 'ui/r1c5', sfx: 'success', intro: 'Gently.', win: 'Purr.' },
  // 4.1.16: the code wheel, played as a player at the keyboard plays it (the question, the wheel as a list, the arrows).
  'code-wheel': {
    seed: 'WS-0000-0000',
    actors: [
      { id: 'pixel', label: 'Pixel' },
      { id: 'grandma', label: 'Grandma' },
      { id: 'neighbor', label: 'The neighbour' },
    ],
    symbols: [
      { id: 'fish', label: 'Fish' },
      { id: 'key', label: 'Key' },
      { id: 'moon', label: 'Moon' },
    ],
    answers: ['ANCHOR', 'BARREL', 'COMPASS'],
  },
};

// ------------------------------------------------------------------ helpers

const activeLabel = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return { label: a?.getAttribute('aria-label') ?? '', cls: a?.className?.toString?.() ?? '', tag: a?.tagName ?? '' };
  });
async function until(page, fn, arg, { timeout = 15000, interval = 50 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(interval);
  }
  return false;
}
const overlayGone = (page) =>
  until(page, () => !document.querySelector('.overlay .mg') && !document.querySelector('.overlay .mg-scratch'), null, {
    timeout: 30000,
  });

/** Starts a minigame with the engine's script hook (not awaited: it resolves when the minigame ends). */
async function startMinigame(page, id) {
  const before = await page.evaluate(() => window.__game.minigameLog.length);
  await page.evaluate(
    ([id, params]) => {
      void window.__game.engine.script([{ minigame: id, params }]);
    },
    [id, PARAMS[id]],
  );
  if (!(await until(page, () => !!document.querySelector('.overlay .mg'), null)))
    throw new Error(`${id}: the minigame did not open`);
  await page.waitForTimeout(400); // the microtask focus and the first frame
  return before;
}
async function resultOf(page, id, before) {
  if (!(await overlayGone(page))) throw new Error(`${id}: the minigame did not end`);
  const r = await page.evaluate((n) => window.__game.minigameLog[n] ?? null, before);
  if (!r || r.id !== id) throw new Error(`${id}: no record of the minigame ending`);
  await page.waitForFunction(() => !window.__game.engine.busy, null, { timeout: 10000 }).catch(() => {});
  return r;
}

// ------------------------------------------------------------------ keyboard strategies, one per minigame

const KEYS = {
  async 'code-wheel'(page) {
    // The question names a symbol and an actor; the wheel as a list says what that window shows.
    const answer = await page.evaluate(() => {
      const q = document.querySelector('.mg-wheel .mg-q')?.textContent ?? '';
      const rows = [...document.querySelectorAll('.mg-wheel details tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.textContent),
      );
      const m = /until (.+) sits under (.+?)\. /.exec(q);
      return m ? rows.find((r) => r[1] === m[1] && r[0] === m[2])?.[2] : undefined;
    });
    if (!answer) throw new Error('code-wheel: the question and the list do not give an answer');
    // Less motion asked of the system: the disc turns without an animation.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    const still = await page.evaluate(() => document.querySelector('.mg-wheel svg g')?.style.transition === 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (!still) throw new Error('code-wheel: the disc animates although less motion is asked for');
    // Turn the disc at the keyboard until its window shows it (the announcement says so), then answer.
    let shown = false;
    for (let k = 0; k < 4 && !shown; k++) {
      shown = await page.evaluate(
        (a) => document.querySelector('.mg-wheel [aria-live]')?.textContent?.includes(`its window shows ${a}`),
        answer,
      );
      if (!shown) await page.keyboard.press('ArrowRight');
    }
    if (!shown) throw new Error('code-wheel: the arrows never brought the answer under the window');
    await page.locator('.mg-wheel button.mg-answer', { hasText: answer }).focus();
    await page.keyboard.press('Enter');
    await overlayGone(page);
    const after = await page.evaluate(() => ({
      result: window.__game.minigameLog.at(-1)?.result,
      flag: window.__game.engine.state.flags['minigame.code-wheel'],
      focus: document.activeElement && document.activeElement !== document.body,
    }));
    if (after.result !== 'won' || after.flag !== 'won')
      throw new Error(`code-wheel: recorded ${after.result}, flag ${after.flag}, not won`);
    if (!after.focus) throw new Error('code-wheel: the focus did not come back to the game');
    return 'recorded won, the focus back, no animation under reduced motion';
  },
  async pick(page) {
    for (let round = 0; round < PARAMS.pick.rounds.length; round++) {
      const r = PARAMS.pick.rounds[round];
      const want = r.options[r.answer];
      const ok = await until(
        page,
        (w) =>
          [...document.querySelectorAll('.mg-opt img')].some((im) => im.src.includes(`/${w}.`)) &&
          document.activeElement?.classList.contains('mg-opt'),
        want,
      );
      if (!ok) throw new Error(`pick: round ${round + 1} never offered its answer with the focus on an option`);
      const idx = await page.evaluate(
        (w) =>
          [...document.querySelectorAll('.mg-opt')].findIndex((b) => b.querySelector('img')?.src.includes(`/${w}.`)),
        want,
      );
      const at = await page.evaluate(() => [...document.querySelectorAll('.mg-opt')].indexOf(document.activeElement));
      for (let k = at; k < idx; k++) await page.keyboard.press('ArrowRight');
      for (let k = at; k > idx; k--) await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
    }
  },
  async hide(page) {
    for (let k = 0; k < PARAMS.hide.answer; k++) await page.keyboard.press('ArrowRight');
    const a = await activeLabel(page);
    if (a.label !== `${PARAMS.hide.answer + 1} / ${PARAMS.hide.spots.length}`)
      throw new Error(`hide: the arrows put the focus on "${a.label}"`);
    await page.keyboard.press('Enter');
  },
  async pipes(page) {
    for (let move = 0; move < 80; move++) {
      const s = await page
        .evaluate(() => {
          const tiles = [...document.querySelectorAll('.mg-tile')];
          const cols = getComputedStyle(tiles[0].parentElement).gridTemplateColumns.split(' ').length;
          return {
            hl: tiles.findIndex((t) => t.classList.contains('mg-hl')),
            at: tiles.indexOf(document.activeElement),
            cols,
            n: tiles.length,
          };
        })
        .catch(() => null);
      if (!s || s.n === 0) return;
      if (s.hl < 0) {
        await page.waitForTimeout(150);
        if (await page.evaluate(() => !document.querySelector('.mg-tile.mg-hl'))) return;
        continue;
      }
      let at = s.at < 0 ? 0 : s.at;
      if (s.at < 0) await page.keyboard.press('ArrowRight'); // the focus enters the grid
      const [r0, c0] = [Math.floor(at / s.cols), at % s.cols],
        [r1, c1] = [Math.floor(s.hl / s.cols), s.hl % s.cols];
      for (let k = r0; k < r1; k++) await page.keyboard.press('ArrowDown');
      for (let k = r0; k > r1; k--) await page.keyboard.press('ArrowUp');
      for (let k = c0; k < c1; k++) await page.keyboard.press('ArrowRight');
      for (let k = c0; k > c1; k--) await page.keyboard.press('ArrowLeft');
      at = s.hl;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
    }
    throw new Error('pipes: still not connected after 80 turns');
  },
  async cables(page) {
    for (let n = 0; n < 4; n++) {
      const plug = await activeLabel(page);
      if (!plug.label.includes(' ') || plug.tag !== 'IMG')
        throw new Error(`cables: the focus is not on a plug ("${plug.label}", ${plug.tag})`);
      const color = plug.label.split(' ').pop();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      for (let t = 0; t < 6 && !(await activeLabel(page)).label.endsWith(` ${color}`); t++)
        await page.keyboard.press('Tab');
      const socket = await activeLabel(page);
      if (!socket.label.endsWith(` ${color}`) || socket.tag !== 'DIV')
        throw new Error(`cables: no socket for ${color} reached with Tab ("${socket.label}")`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
    }
  },
  async runner(page) {
    const AX = 430;
    const pressed = new Set();
    let stumbles = 0,
      jumps = 0,
      ducks = 0,
      sawToast = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 14000) {
      const s = await page.evaluate(
        ([basket, carpet]) => {
          const box = document.querySelector('.overlay .mg');
          if (!box) return null;
          const u = box.clientWidth / 640;
          const obs = [...box.querySelectorAll('img.mg-img')]
            .filter((im) => im.src.includes(`/${basket}.`) || im.src.includes(`/${carpet}.`))
            .map((im) => ({
              key: (im.dataset.e2e ??= String(Math.random())),
              x: (parseFloat(im.style.left) + parseFloat(im.style.width) / 2) / u,
              jump: im.src.includes(`/${basket}.`),
            }));
          return { obs, toast: !!box.querySelector('.mg-toast') };
        },
        [PARAMS.runner.obstacles.jump, PARAMS.runner.obstacles.duck],
      );
      if (!s) break;
      if (s.toast && !sawToast) stumbles++;
      sawToast = s.toast;
      for (const o of s.obs) {
        if (pressed.has(o.key) || o.x > AX + 120 || o.x < AX + 25) continue;
        pressed.add(o.key);
        await page.keyboard.press(o.jump ? 'ArrowUp' : 'ArrowDown');
        if (o.jump) jumps++;
        else ducks++;
      }
      await page.waitForTimeout(30);
    }
    if (jumps + ducks < 2) throw new Error(`runner: only ${jumps + ducks} obstacle(s) met`);
    if (stumbles > 1) throw new Error(`runner: ${stumbles} stumbles over ${jumps + ducks} obstacles`);
    return `${jumps} jumps, ${ducks} ducks, ${stumbles} stumble(s)`;
  },
  async scratch(page) {
    const done = () =>
      page.evaluate(() => {
        const c = document.querySelector('.mg-scratch canvas');
        return !c || c.style.opacity === '0';
      });
    const a = await activeLabel(page);
    if (a.tag !== 'CANVAS') throw new Error(`scratch: the focus is on ${a.tag}, not the ticket`);
    for (let row = 0; row < 12 && !(await done()); row++) {
      const dir = row % 2 ? 'ArrowLeft' : 'ArrowRight';
      for (let k = 0; k < 14 && !(await done()); k++) await page.keyboard.press(dir);
      await page.keyboard.press('ArrowDown');
    }
    if (!(await done())) throw new Error('scratch: the silver layer is still there');
  },
  async stroke(page) {
    for (let k = 0; k < 24; k++) {
      if (await page.evaluate(() => !document.querySelector('.overlay .mg'))) return;
      await page.keyboard.press(k % 2 ? 'ArrowRight' : 'ArrowLeft');
      await page.waitForTimeout(320);
    }
  },
};

// ------------------------------------------------------------------ the checks

async function startGame(h) {
  await h.walkthrough([{ start: { kind: 'new' }, picks: [] }]);
  // A room with someone to talk to, the map open to every place: the market checkpoint (as e2e.mjs reaches a room).
  await h.page.evaluate(async () => {
    await window.__game.engine.checkpoint('market');
  });
  await h.page.waitForTimeout(800);
  await h.waitIdle();
}

async function axeChecks(h) {
  const { page } = h;
  const found = [];
  await startGame(h);
  // A conversation menu, opened at the keyboard.
  await h.verbById('talk');
  await h.target('neighbor');
  if (!(await until(page, () => document.querySelectorAll('.side .choices .choice').length > 1, null)))
    throw new Error('axe: the conversation menu did not open');
  found.push(...(await h.axe('conversation menu')));
  await page.locator('.side .choices .choice').last().focus();
  await page.keyboard.press('Enter');
  await h.waitIdle();
  // The map.
  await h.openMap();
  found.push(...(await h.axe('map')));
  await page.keyboard.press('Escape');
  await h.waitIdle();
  // The slots: save (empty), save again (the overwrite confirmation), load; the restart confirmation.
  const menuButton = async (text) => {
    // The row's own label, exactly ("Save" is not "Autosave").
    const exact = new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const b = page
      .locator('.menu button')
      .filter({ has: page.locator('span:first-child', { hasText: exact }) })
      .first();
    await b.focus();
    await page.keyboard.press('Enter');
  };
  const ui = await page.evaluate(() => ({
    save: window.__game.t('save'),
    load: window.__game.t('load'),
    slot: window.__game.t('slot').replace('{n}', '1'),
    restart: window.__game.game.ui.restart,
    no: window.__game.game.ui.no,
  }));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu');
  found.push(...(await h.axe('pause menu')));
  await menuButton(ui.save);
  await page.waitForFunction(() => [...document.querySelectorAll('.menu button')].some((b) => !b.disabled));
  found.push(...(await h.axe('save slots')));
  await menuButton(ui.slot);
  await page.waitForFunction(() => !document.querySelector('.menu'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu');
  await menuButton(ui.save);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.menu button')].some((b) => !b.disabled && !b.textContent.includes('…')),
  );
  await menuButton(ui.slot);
  await page.waitForSelector('.menu p');
  found.push(...(await h.axe('overwrite confirmation')));
  await menuButton(ui.no);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu');
  await menuButton(ui.load);
  await page.waitForFunction(() => [...document.querySelectorAll('.menu button')].some((b) => !b.disabled));
  found.push(...(await h.axe('load slots')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu');
  await menuButton(ui.restart);
  await page.waitForSelector('.menu p');
  found.push(...(await h.axe('restart confirmation')));
  await menuButton(ui.no);
  await h.waitIdle();
  // Every minigame, as it opens.
  for (const id of Object.keys(PARAMS)) {
    const before = await startMinigame(page, id);
    found.push(...(await h.axe(`minigame ${id}`)));
    await page
      .locator('.mg-skip')
      .first()
      .focus()
      .catch(() => {});
    if (await page.locator('.mg-skip').count()) await page.keyboard.press('Enter');
    else await KEYS[id](page); // scratch has no Skip by default: scratched at the keyboard
    await resultOf(page, id, before);
  }
  if (found.length) failures.push(...found);
  log(
    found.length
      ? `axe: ${found.length} violation(s)`
      : `axe: no serious or critical violation (conversation, map, pause, save / load slots, overwrite and restart confirmations, ${Object.keys(PARAMS).length} minigames)`,
  );
}

async function keyChecks(h) {
  const { page } = h;
  await startGame(h);
  for (const id of Object.keys(PARAMS)) {
    const before = await startMinigame(page, id);
    const t0 = Date.now();
    let note = '';
    try {
      note = (await KEYS[id](page)) ?? '';
      const r = await resultOf(page, id, before);
      if (r.skipped) throw new Error('ended through Skip');
      log(`keys: ${id} won at the keyboard in ${((Date.now() - t0) / 1000).toFixed(1)} s${note ? ` (${note})` : ''}`);
    } catch (e) {
      failures.push(`keys: ${id}: ${e.message}`);
      // Out of the minigame before the next one: Skip, or wait for the end.
      await page
        .locator('.mg-skip')
        .first()
        .focus()
        .then(() => page.keyboard.press('Enter'))
        .catch(() => {});
      await overlayGone(page);
    }
  }
  // Skip, once, at the keyboard: Tab reaches it, Enter skips, and the record says so.
  const before = await startMinigame(page, 'pick');
  let reached = false;
  // macOS WebKit moves Tab between buttons only with Option held (the system's "keyboard navigation" convention).
  const back = browser === 'webkit' && process.platform === 'darwin' ? 'Alt+Shift+Tab' : 'Shift+Tab';
  for (let t = 0; t < 8 && !reached; t++) {
    await page.keyboard.press(back);
    reached = (await activeLabel(page)).cls.includes('mg-skip');
  }
  if (!reached) failures.push('keys: Skip is not reachable with Tab in the pick minigame');
  else {
    await page.keyboard.press('Enter');
    const r = await resultOf(page, 'pick', before);
    if (!r.skipped) failures.push('keys: Skip at the keyboard was not recorded as a skip');
    else log(`keys: Skip reached with ${back} and pressed with Enter`);
  }
}

async function storageChecks() {
  const gold = (v) => JSON.parse(readFileSync(resolve(ROOT, `tests/fixtures/saves/demo-${v}.json`), 'utf8')).envelope;
  // 1. The v2 localStorage autosave and slot: imported into IndexedDB once, then removed.
  {
    const h = await launch(url, {
      dev: false,
      input: 'keyboard',
      out: process.env.E2E_OUT ? `${process.env.E2E_OUT}/storage` : undefined,
    });
    try {
      const { page } = h;
      const st = gold('3.0.0').state;
      await page.evaluate((s) => {
        const id = window.__game.game.id;
        localStorage.setItem(`${id}.save`, JSON.stringify(s));
        localStorage.setItem(
          `${id}.slot.2`,
          JSON.stringify({ meta: { at: 5, room: s.room, roomName: 'Garden', v: s.v }, state: s }),
        );
      }, st);
      await page.reload();
      await page.waitForFunction(() => !!window.__game?.engine?.store, null, { timeout: 15000 });
      const r = await page.evaluate(async () => {
        const app = window.__game,
          id = app.game.id,
          store = app.engine.store;
        return {
          kind: 'listSlots' in store ? 'IndexedDB' : 'localStorage',
          auto: store.load()?.room ?? null,
          slot: (await app.slots.getSlot(2))?.room ?? null,
          left: [localStorage.getItem(`${id}.save`), localStorage.getItem(`${id}.slot.2`)].filter(Boolean).length,
        };
      });
      if (r.kind !== 'IndexedDB')
        skips.push(`storage: ${browser} gave the game no IndexedDB under automation (store: ${r.kind})`);
      else if (r.auto !== st.room || r.slot !== st.room || r.left)
        failures.push(`storage: the v2 localStorage save was not upgraded (${JSON.stringify(r)})`);
      else {
        log('storage: the v2 localStorage autosave and slot moved to IndexedDB, the old keys removed');
        // The upgraded autosave resumes from the title, and a manual save survives a reload.
        const resumed = await resume(page, st.room);
        if (!resumed) failures.push('storage: the upgraded autosave did not resume from the title');
        const rt = await h.saveRoundTrip();
        if (!rt.same || rt.store !== 'IndexedDB')
          failures.push(`storage: a manual save did not survive a reload (${JSON.stringify(rt)})`);
        else log('storage: the upgraded game resumed, and a manual save survived a reload (IndexedDB)');
      }
    } finally {
      await h.close();
    }
  }
  // 2. A 3.1.0 envelope already in IndexedDB: migrated and resumed by this build.
  {
    const h = await launch(url, {
      dev: false,
      input: 'keyboard',
      out: process.env.E2E_OUT ? `${process.env.E2E_OUT}/storage2` : undefined,
    });
    try {
      const { page } = h;
      const env = gold('3.1.0');
      const wrote = await page
        .evaluate(async (e) => {
          const id = window.__game.game.id;
          return new Promise((res) => {
            const open = indexedDB.open('web-scumm-saves', 1);
            open.onupgradeneeded = () => {
              if (!open.result.objectStoreNames.contains('slots')) open.result.createObjectStore('slots');
            };
            open.onerror = () => res(false);
            open.onsuccess = () => {
              const tx = open.result.transaction('slots', 'readwrite');
              tx.objectStore('slots').put(e, `${id}:auto`);
              tx.oncomplete = () => {
                open.result.close();
                res(true);
              };
              tx.onerror = () => res(false);
            };
          });
        }, env)
        .catch(() => false);
      if (!wrote) skips.push(`storage: ${browser} would not let the test write an older IndexedDB record`);
      else {
        await page.reload();
        await page.waitForFunction(() => !!window.__game?.engine?.store, null, { timeout: 15000 });
        const room = await page.evaluate(() => window.__game.engine.store.load()?.room ?? null);
        if (room !== env.state.room) failures.push(`storage: the 3.1.0 IndexedDB save was not loaded (room ${room})`);
        else if (!(await resume(page, env.state.room)))
          failures.push('storage: the 3.1.0 IndexedDB save did not resume from the title');
        else log('storage: a 3.1.0 save in IndexedDB was migrated and resumed');
      }
    } finally {
      await h.close();
    }
  }
}

/** The title's Continue button, at the keyboard; true when the game is in `room` with the title gone. */
async function resume(page, room) {
  const label = await page.evaluate(() => window.__game.game.ui.continue ?? '');
  const btn = page
    .locator('.overlay .bigbtn', { hasText: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    .first();
  if (!(await btn.count())) return false;
  await btn.focus();
  await page.keyboard.press('Enter');
  return until(
    page,
    (r) => window.__game.engine.state?.room === r && !document.querySelector('.overlay .bigbtn'),
    room,
    { timeout: 15000 },
  );
}

// ------------------------------------------------------------------ run

log(`${url} (${[...only].join(', ')})`);
try {
  if (only.has('axe')) {
    const h = await launch(url, { dev: false, input: 'keyboard' });
    try {
      await axeChecks(h);
    } finally {
      await h.close();
    }
  }
  if (only.has('keys')) {
    const h = await launch(url, { dev: false, input: 'keyboard' });
    try {
      await keyChecks(h);
    } finally {
      await h.close();
    }
  }
  if (only.has('storage')) await storageChecks();
} catch (e) {
  failures.push(`stopped: ${e.message}`);
}
for (const s of skips) log(`SKIPPED — ${s}`);
for (const f of failures) console.error(`e2e:a11y [${browser}] FAILED — ${f}`);
if (failures.length) process.exit(1);
if (skips.length) process.exit(allowSkip ? 0 : 3);
log('done');
