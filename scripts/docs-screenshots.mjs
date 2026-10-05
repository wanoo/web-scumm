// npm run docs:screenshots: the README's images, taken from the real production bundle and the real Studio, never
// mock-ups. Builds the game into .cache/docs-dist, serves it and the Studio, plays the sample game through the e2e
// harness and drives the Studio with Playwright, then writes WebP files to docs/img/ (Pillow, quality 85, 1440 px
// wide at most). `--only=game|studio`, `--keep-png` (the raw captures stay in .cache/docs-shots).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { launch } from './e2e/lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const RAW = resolve(ROOT, '.cache/docs-shots');
const IMG = resolve(ROOT, 'docs/img');
const GAME_PORT = 4317, STUDIO_PORT = 5317;
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const procs = [];
const serve = (cmd, argv, env = {}) => { const p = spawn(cmd, argv, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p; };
const up = async (url, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`${url} did not answer in ${ms / 1000} s`);
};
const stop = () => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } };
process.on('exit', stop);

/** PNG → WebP under docs/img (Pillow), at most 1440 px wide. */
function webp(png, name) {
  const r = spawnSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
if im.width > 1440: im = im.resize((1440, round(im.height * 1440 / im.width)), Image.LANCZOS)
im.save(sys.argv[2], 'WEBP', quality=85, method=6)
print(im.width, im.height)`, png, resolve(IMG, `${name}.webp`)], { encoding: 'utf8' });
  if (r.status) throw new Error(r.stderr);
  console.log(`docs:screenshots ${name}.webp ${r.stdout.trim()}`);
}

async function game() {
  console.log('docs:screenshots building the production bundle');
  const b = spawnSync('npx', ['vite', 'build', '--outDir', '.cache/docs-dist', '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8' });
  if (b.status) throw new Error(b.stderr || b.stdout);
  serve('npx', ['vite', 'preview', '--outDir', '.cache/docs-dist', '--port', String(GAME_PORT), '--strictPort']);
  const url = `http://127.0.0.1:${GAME_PORT}/`;
  await up(url);
  const solved = JSON.parse(spawnSync('npx', ['tsx', 'tools/solve.ts', '--json'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n').pop());
  if (solved.status !== 'solved') throw new Error(`the solver says ${solved.status}`);

  const h = await launch(url, { dev: false, out: RAW });
  const { page } = h;
  const shot = async (name) => { const f = `${RAW}/${name}.png`; await page.screenshot({ path: f }); webp(f, name); };
  const settle = (ms = 900) => page.waitForTimeout(ms);
  try {
    // The scene: the start of the game, then a conversation open in the side column.
    await h.walkthrough(solved.steps.slice(0, 1));
    await h.waitIdle(); await settle();
    await shot('v36-hero');
    // The tutorial guides the first actions: follow the solver's path until it lets go.
    for (let i = 1; i < solved.steps.length && await page.evaluate(() => !!window.__game.engine.guiding); i++) await h.walkthrough([solved.steps[i]]);
    await h.waitIdle(); await settle();
    const talker = await page.evaluate(() => { const g = window.__game; const r = g.engine.room(); return Object.keys(r.talk ?? {}).find((a) => g.engine.targets(r).includes(a)) ?? null; });
    if (!talker) throw new Error('nobody to talk to in the first room');
    // Tapped like a player: the verb, then the character; the topics come up as choices.
    await h.verbById('talk'); await h.target(talker);
    await page.waitForSelector('.choices .choice', { timeout: 15000 });
    await settle(1500);
    await shot('v36-player-scene');
    await page.locator('.choices .choice').last().click(); await h.waitIdle(); await settle();
    // A minigame: the sample game's own pipes command, run by the engine.
    await page.evaluate(() => {
      const g = window.__game;
      let found = null;
      const walk = (x) => { if (found || !x || typeof x !== 'object') return; if (x.minigame === 'pipes') { found = x; return; } for (const v of Object.values(x)) walk(v); };
      walk(g.game.rooms);
      if (!found) throw new Error('no pipes minigame in the sample game');
      void g.engine.script([{ minigame: 'pipes', params: found.params }]);
    });
    await page.waitForSelector('.overlay .mg-skip', { timeout: 10000 }); await settle(1500);
    await shot('v36-player-minigame');
    await page.locator('.overlay .mg-skip').click({ force: true }); await h.waitIdle();
    // The map, late in the game (more places open).
    await page.evaluate(async () => { const g = window.__game; const cps = Object.keys(g.game.checkpoints ?? {}); await g.engine.checkpoint(cps[cps.length - 1]); });
    await h.waitIdle(); await settle();
    await h.openMap(); await settle();
    await shot('v36-player-map');
    await page.keyboard.press('Escape').catch(() => {});
  } finally { await h.close(); }

  // The ending: the solver's whole path, played by tapping, in a fresh page.
  const e = await launch(url, { dev: false, out: `${RAW}/ending` });
  try {
    await e.walkthrough(solved.steps);
    if (!(await e.ended())) throw new Error('the walkthrough did not reach the ending');
    await e.page.waitForTimeout(4000);
    const f = `${RAW}/v36-player-ending.png`;
    await e.page.screenshot({ path: f }); webp(f, 'v36-player-ending');
  } finally { await e.close(); }
}

async function studio() {
  serve('npx', ['vite', '--port', String(STUDIO_PORT), '--strictPort'], { STUDIO: '1' });
  const base = `http://127.0.0.1:${STUDIO_PORT}/__studio/`;
  await up(base, 90000);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const shot = async (name, el) => { const f = `${RAW}/${name}.png`; await (el ?? page).screenshot({ path: f }); webp(f, name); };
  try {
    await page.goto(`${base}#rooms/house`);
    await page.waitForSelector('.entities .ent', { timeout: 60000 }); await page.waitForTimeout(2500);
    await page.locator('.entities .ent', { hasText: 'pantry' }).first().click(); await page.waitForTimeout(1500);
    await shot('v36-studio-rooms');
    await page.goto(`${base}#storyboard`); await page.reload(); await page.waitForTimeout(4000);
    await shot('v36-studio-storyboard');
    await page.goto(`${base}#assets`); await page.reload(); await page.waitForTimeout(4000);
    await shot('v36-studio-assets');
    await page.goto(`${base}#check`); await page.reload();
    await page.waitForSelector('.badge.ok, .badge.warn', { timeout: 120000 }); await page.waitForTimeout(1500);
    await shot('v36-studio-check');
    // The proof: the puzzle graph with the critical path and the solver's heat.
    await page.locator('label', { hasText: 'Critical path' }).locator('input').check();
    await page.locator('label', { hasText: 'Heat' }).locator('select').selectOption('solver');
    await page.waitForTimeout(1000);
    // The panel at the top of the screen, its toggles and the start of the graph.
    await page.locator('label', { hasText: 'Critical path' }).evaluate((el) => el.closest('.panel')?.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(800);
    const box = await page.locator('label', { hasText: 'Critical path' }).evaluate((el) => { const r = el.closest('.panel').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, innerHeight - r.y) }; });
    const f = `${RAW}/v36-proof-graph.png`;
    await page.screenshot({ path: f, clip: box }); webp(f, 'v36-proof-graph');
  } finally { await browser.close(); }
}

try {
  if (only !== 'studio') await game();
  if (only !== 'game') await studio();
  if (!args.includes('--keep-png')) rmSync(RAW, { recursive: true, force: true });
  console.log('docs:screenshots done');
} catch (err) {
  console.error('docs:screenshots FAILED —', err.message);
  process.exitCode = 1;
} finally { stop(); }
