#!/usr/bin/env node
// Visual baselines (3.4): every room of the game, still, against its reference image in tests/visual/<game>/<room>.png.
// The scene only (no interface text, so no font rendering), the animations frozen (`RoomView.still()`: first frame,
// mouths closed, no bob, the camera where it rests). A room whose drawing changes by more than --tolerance of its
// pixels (default 0.5%) fails: a change of the painter (Canvas, layers, masks) must leave the old rooms as they were.
// `--update` writes the references. The production build must be served (`npm run preview`).
// Exit codes: 0 every room matches, 1 not (or a reference is missing).
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readPng, diffShare } from './e2e/png.mjs';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const update = process.argv.includes('--update');
const tolerance = Number(process.argv.find((a) => a.startsWith('--tolerance='))?.split('=')[1] ?? 0.005);
const game = process.argv.find((a) => a.startsWith('--game='))?.split('=')[1] ?? process.env.GAME ?? 'demo';
const renderer = process.argv.find((a) => a.startsWith('--renderer='))?.split('=')[1];
const dir = `tests/visual/${game}`;
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 1 })).newPage();
const target = new URL(url);
if (renderer) target.searchParams.set('renderer', renderer);
await page.goto(target.toString());
await page.waitForFunction(() => !!window.__game?.engine, null, { timeout: 20000 });
const rooms = await page.evaluate(() => window.__game.game.rooms.map((r) => ({ id: r.id, checkpoint: Object.entries(window.__game.game.checkpoints ?? {}).find(([, c]) => c.room === r.id)?.[0] ?? null })));
let failed = 0;
for (const r of rooms) {
  // A checkpoint in the room when there is one (its state is the designed one), else a new game moved there.
  await page.evaluate(async ({ id, checkpoint }) => {
    const g = window.__game;
    document.querySelectorAll('.overlay').forEach((o) => o.remove());
    if (checkpoint) await g.engine.checkpoint(checkpoint);
    else { await g.engine.checkpoint(Object.keys(g.game.checkpoints ?? {})[0]); g.engine.state.room = id; await g.engine.enter(id, undefined, false); }
  }, r);
  await page.waitForFunction(() => !window.__game.engine.busy, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  // The room only: the sentence line and anything else over the scene is text, drawn differently on every system.
  await page.evaluate(() => { document.querySelectorAll('.overlay, .speech, .a11y-targets').forEach((o) => o.remove()); for (const c of document.querySelector('.scene').children) if (c !== window.__game.view.el) c.style.visibility = 'hidden'; window.__game.view.still(); });
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.scene img')].map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; })))));
  await page.waitForTimeout(200);
  const shot = await page.locator('.scene').screenshot({ animations: 'disabled' });
  const file = `${dir}/${r.id}.png`;
  if (update) { writeFileSync(file, shot); console.log(`  ✎ ${file}`); continue; }
  if (!existsSync(file)) { console.log(`  ✖ ${r.id}: no reference (${file}); run with --update`); failed++; continue; }
  const share = diffShare(readPng(readFileSync(file)), readPng(shot));
  const ok = share <= tolerance;
  if (!ok) { failed++; writeFileSync(`${dir}/${r.id}.actual.png`, shot); }
  console.log(`  ${ok ? '✔' : '✖'} ${r.id}: ${(share * 100).toFixed(2)}% of the pixels differ${ok ? '' : ` (tolerance ${(tolerance * 100).toFixed(2)}%, see ${dir}/${r.id}.actual.png)`}`);
}
await browser.close();
console.log(`${failed ? '✖' : '✔'}  visual baselines: ${update ? `${rooms.length} written` : `${rooms.length - failed}/${rooms.length} rooms match`}`);
process.exit(failed ? 1 : 0);
