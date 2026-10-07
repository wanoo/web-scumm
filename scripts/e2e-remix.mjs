// npm run e2e:remix [-- --browsers=chromium,webkit,firefox] [--seeds=50] [--allow-skip] (4.1.15, ADR 0018): the same
// seed makes the same world and the same hash in Node, Chromium, WebKit and Firefox. One module (the reference game,
// its manifest, compileVariant, the code wheel) bundled once with esbuild and evaluated in Node and in a blank page of
// each browser; for each of the seeds and each mode: the world's hash and its assignments, and the code wheel the
// seed draws (copy-protection stream). Node's answers are the reference; a browser that differs fails, the seed named.
// Exit codes: 0 every runtime agrees, 1 a difference, 3 a browser Playwright cannot launch (`--allow-skip`: 0, said).
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const names = (args.find((a) => a.startsWith('--browsers='))?.slice(11) ?? 'chromium,webkit,firefox').split(',');
const seeds = Number(args.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 50);
const allowSkip = args.includes('--allow-skip');

const entry = `
import { game } from './games/reference/game.ts';
import { compileVariant } from './src/engine/core/remix/compile.ts';
import { compileGameManifest } from './src/engine/core/remix/apply.ts';
import { encodeSeedCode } from './src/engine/core/remix/seed-code.ts';
import { generateWheel } from './src/engine/core/remix/code-wheel.ts';
globalThis.__remix = (n) => {
  const c = compileGameManifest(game);
  const hall = game.rooms.find((r) => r.id === 'hall');
  const wheel = hall.on.find((r) => r.id === 'hall.use-map').do.find((x) => x.minigame === 'code-wheel').params;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const seed = encodeSeedCode((i * 2654435761 + 977) % 2 ** 35);
    for (const mode of ['remix', 'daily', 'mystery']) {
      const v = compileVariant(c, game.remix, seed, 1, mode);
      rows.push({ seed, mode, hash: v.hash, assignments: JSON.stringify(v.assignments) });
    }
    const w = generateWheel(wheel, seed);
    rows.push({ seed, mode: 'code-wheel', hash: w.answer, assignments: JSON.stringify(w) });
  }
  return rows;
};`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'e2e-remix-entry.ts' },
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  charset: 'utf8',
  alias: { '@engine': resolve(ROOT, 'src/engine') },
  define: { 'import.meta.env': 'undefined' },
  logLevel: 'error',
});
const code = bundle.outputFiles[0].text;
const reference = new Function(`${code}; return globalThis.__remix(${seeds});`)();
console.log(`✔  node: ${reference.length} worlds and wheels (${seeds} seeds × remix, daily, mystery, code wheel)`);

let failed = 0;
let skipped = 0;
const types = { chromium, webkit, firefox };
for (const name of names) {
  const type = types[name];
  if (!type) {
    console.error(`✖  unknown browser "${name}" (chromium, webkit or firefox)`);
    failed++;
    continue;
  }
  let browser;
  try {
    browser = await type.launch();
  } catch (e) {
    console.error(`⚠  ${name}: cannot launch (${e.message.split('\n')[0]})`);
    skipped++;
    continue;
  }
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><title>remix</title>');
    await page.addScriptTag({ content: code });
    const rows = await page.evaluate((n) => globalThis.__remix(n), seeds);
    const bad = rows.filter((r, i) => r.hash !== reference[i].hash || r.assignments !== reference[i].assignments);
    for (const r of bad.slice(0, 10)) console.error(`✖  ${name}: ${r.seed} (${r.mode}) differs from Node`);
    if (!bad.length) console.log(`✔  ${name}: the same ${rows.length} worlds and wheels as Node`);
    failed += bad.length;
  } finally {
    await browser.close();
  }
}
if (failed) process.exit(1);
if (skipped) {
  console.log(`${allowSkip ? 'ℹ' : '✖'}  ${skipped} browser(s) not run${allowSkip ? ' (--allow-skip)' : ''}`);
  process.exit(allowSkip ? 0 : 3);
}
