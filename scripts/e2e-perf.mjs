#!/usr/bin/env node
// The frame-rate gate (3.4): a room played in Chromium with the CPU slowed down (`--cpu`, default 4×, the automated
// stand-in for a mid-range phone; a real phone is a manual pass, D12), the hero walking back and forth, frames counted
// for `--seconds` (default 5). Fails under `--min` frames per second (default 30). `--renderer=canvas|dom` picks the
// painter, `--room=<id>` the room (default: every room with a checkpoint). The production build must be served.
// Exit codes: 0 fast enough everywhere, 1 not.
import { chromium } from 'playwright';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const cpu = Number(arg('cpu', 4)), seconds = Number(arg('seconds', 5)), min = Number(arg('min', 30));
const renderer = arg('renderer', 'canvas'), only = arg('room', null);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 })).newPage();
const cdp = await page.context().newCDPSession(page);
const target = new URL(url);
target.searchParams.set('renderer', renderer);
await page.goto(target.toString());
await page.waitForFunction(() => !!window.__game?.engine, null, { timeout: 20000 });
const rooms = await page.evaluate((only) => Object.entries(window.__game.game.checkpoints ?? {}).map(([id, c]) => ({ checkpoint: id, room: c.room })).filter((x, i, all) => all.findIndex((y) => y.room === x.room) === i && (!only || x.room === only)), only);
let failed = 0;
for (const r of rooms) {
  await page.evaluate(async (cp) => { document.querySelectorAll('.overlay').forEach((o) => o.remove()); await window.__game.engine.checkpoint(cp); }, r.checkpoint);
  await page.waitForTimeout(500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const res = await page.evaluate(async (ms) => {
    const g = window.__game, v = g.view, hero = g.engine.heroId();
    const at = v.pos(hero) ?? [320, 360];
    let walking = true;
    (async () => { for (let i = 0; walking; i++) await v.walkTo(hero, i % 2 ? at : [Math.max(60, at[0] - 220), at[1]], false); })();
    const paints0 = v.r.paints ?? 0;
    const frames = await new Promise((done) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < ms) requestAnimationFrame(f); else done(n / ((t - t0) / 1000)); }; requestAnimationFrame(f); });
    walking = false;
    return { fps: frames, paints: (v.r.paints ?? 0) - paints0, painter: v.painter };
  }, seconds * 1000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const ok = res.fps >= min;
  if (!ok) failed++;
  console.log(`  ${ok ? '✔' : '✖'} ${r.room}: ${res.fps.toFixed(1)} fps with the ${res.painter} painter, CPU ÷${cpu}${res.painter === 'canvas' ? `, ${res.paints} paints` : ''}`);
}
await browser.close();
console.log(`${failed ? '✖' : '✔'}  frame rate: ${rooms.length - failed}/${rooms.length} rooms at ${min} fps or more`);
process.exit(failed ? 1 : 0);
