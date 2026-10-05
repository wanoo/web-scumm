// npm run weight: what a player downloads before the first room is playable, per room, and per chapter (every room a
// player can be in during it, from the proof by chapters), against `assetBudgets` (`initialKB`, `roomKB`, `chapterKB`).
// The scopes come from the asset graph (src/engine/core/asset-graph.ts). Sizes are the built files: the game's assets
// (public/assets, `ASSETS_DIR` for a fixture) and, when the bundle is built (`dist/`, `DIST_DIR`), the app shell the
// service worker precaches (counted in `initial`, compressed size beside the raw one). Exit codes: 0 within budget,
// 1 over a budget or a file missing (`--release`: or a budget not set, the step of `verify:release`). `--json` for
// tools (`scripts/e2e-weight.mjs` reads it). docs/en/TOOLS.md "Weight".
import { cachedSolve } from './proof-cache';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { assetPath } from '../src/engine/tools/provenance';
import { proveChapters } from '../src/engine/tools/chapters';
import { assetGraph, initialScope, splitKey } from '../src/engine/core/asset-graph';
import { weightReport } from '../src/engine/tools/weight';
import { loadLayouts } from '../src/engine/tools/load';
import { ASSETS_DIR, GAME, GAME_DIR, loadGameModule } from './game';

const mod = await loadGameModule();
const game = mod.game;
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
let bindings: Record<string, { images?: string[]; sfx?: string[] }> = {};
try { bindings = Object.fromEntries(Object.entries({ ...(await import('../src/engine/minigames/index')).minigames, ...(mod.minigames ?? {}) }).map(([k, m]) => [k, (m as { bindings?: { images?: string[]; sfx?: string[] } }).bindings ?? {}])); } catch { /* no minigames */ }
const manifestFile = resolve(GAME_DIR, 'assets.gen.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) as { images: Record<string, [number, number]>; videos?: Record<string, number> } : undefined;
const graph = assetGraph(game, { manifest, bindings, layouts });

// The app shell: what the service worker precaches (its list in dist/sw.js), plus the worker and its runtime.
const DIST = resolve(process.env.DIST_DIR ?? 'dist');
const shell: string[] = [];
/** Shell files a first visit downloads twice (the page, then the service worker past the HTTP cache). */
const twice: string[] = [];
const sizes: Record<string, number | null> = {};
const gzip: Record<string, number> = {};
if (existsSync(resolve(DIST, 'sw.js'))) {
  const sw = readFileSync(resolve(DIST, 'sw.js'), 'utf8');
  const entries = [...sw.matchAll(/\{url:"([^"]+)",revision:(null|"[^"]*")\}/g)].map((m) => ({ url: m[1], revised: m[2] !== 'null' }));
  const files = ['sw.js', ...entries.map((e) => e.url), ...[...sw.matchAll(/"\.\/(workbox-[\w-]+?)(?:\.js)?"/g)].map((m) => `${m[1]}.js`)];
  // A precache entry with a revision (no hash in its name: index.html, the manifest, icons) is fetched again by the
  // service worker past the HTTP cache (`cache: 'reload'`): when the page loaded it too, a first visit pays it twice.
  const html = existsSync(resolve(DIST, 'index.html')) ? readFileSync(resolve(DIST, 'index.html'), 'utf8') : '';
  const pageLoads = (u: string) => u === 'index.html' || html.includes(u);
  for (const e of entries) if (e.revised && pageLoads(e.url)) twice.push(`shell:${e.url}`);
  for (const f of [...new Set(files)]) {
    const p = resolve(DIST, f);
    const k = `shell:${f}`;
    shell.push(k);
    if (!existsSync(p)) { sizes[k] = null; continue; }
    const b = readFileSync(p);
    sizes[k] = b.length;
    if (/\.(js|css|html|webmanifest|ttf|json|svg)$/.test(f)) gzip[k] = gzipSync(b, { level: 9 }).length;
  }
}
const keys = new Set<string>([...initialScope(graph, game), ...Object.values(graph.rooms).flat()]);
for (const k of keys) { const p = assetPath(k); const f = p ? resolve(ASSETS_DIR, p) : null; sizes[k] = f && existsSync(f) ? statSync(f).size : null; }
/** Decoded memory of the images (width × height × 4), from the manifest: what a room costs once on screen. */
const decoded = (ks: string[]) => ks.reduce((n, k) => { const [kind, id] = splitKey(k); const wh = kind === 'img' ? manifest?.images[id] : undefined; return n + (wh ? wh[0] * wh[1] * 4 : 0); }, 0);

// Chapters: every room a player can be in during each chapter (the proof by chapters explores them all, from every
// boundary state), including the rooms where it ends.
const chapters: { id: string; rooms: string[] }[] = [];
if (Object.values(game.checkpoints ?? {}).some((c) => c.goals?.length)) {
  const p = await proveChapters(game, layouts, { commands: mod.commands, solver: cachedSolve });
  for (const c of p.chapters) chapters.push({ id: c.id, rooms: [...new Set(c.results.flatMap((r) => [...r.roomsReached, ...r.boundaries.map((b) => b.room)]))].sort() });
}

// The budgets count what crosses the network: the shell's text files compressed (what a static host sends), the
// images and sounds as they are (already compressed).
const net: Record<string, number | null> = { ...sizes, ...gzip };
for (const k of twice) { net[`${k}#again`] = net[k]; sizes[`${k}#again`] = sizes[k]; if (gzip[k] !== undefined) gzip[`${k}#again`] = gzip[k]; }
const rep = weightReport(game, net, chapters, game.assetBudgets ?? {}, { bindings, layouts, shell: [...shell, ...twice.map((k) => `${k}#again`)] });
const kb = (b: number) => `${Math.round(b / 1024)} KB`;
const b = game.assetBudgets ?? {};
const missing = [...new Set([rep.initial, ...rep.rooms, ...rep.chapters].flatMap((w) => w.missing))];
const shellBytes = shell.reduce((n, k) => n + (sizes[k] ?? 0), 0); // raw
const shellGzip = shell.reduce((n, k) => n + (gzip[k] ?? sizes[k] ?? 0), 0);
const initialKeys = [...shell, ...twice.map((k) => `${k}#again`), ...initialScope(graph, game)];
if (process.argv.includes('--json')) {
  // Written before exiting: a large JSON on a pipe would be cut by process.exit.
  const code = rep.over.length || missing.length ? 1 : 0;
  process.stdout.write(JSON.stringify({ ...rep, budgets: b, missing, shell: { files: shell.length, bytes: shellBytes, gzip: shellGzip }, initialKeys, sizes, gzip, decoded: { initial: decoded(initialKeys), rooms: Object.fromEntries(game.rooms.map((r) => [r.id, decoded(graph.rooms[r.id] ?? [])])) } }) + '\n', () => process.exit(code));
  await new Promise(() => {});
}
console.log(`[${GAME}] what a player downloads (built files in ${ASSETS_DIR.replace(process.cwd() + '/', '')}${shell.length ? `, app shell from ${DIST.replace(process.cwd() + '/', '')}/sw.js` : ''})`);
if (shell.length) console.log(`  app shell  ${kb(shellGzip).padStart(9)}  ${shell.length} files compressed (${kb(shellBytes)} raw), counted in initial`);
else console.log('  app shell  not counted: no built bundle (npm run build:web) — initial is the game assets only');
console.log(`  initial    ${kb(rep.initial.bytes).padStart(9)}  ${rep.initial.files} files, ${Math.round(decoded(initialKeys) / 1048576)} MB decoded${b.initialKB !== undefined ? `  (budget ${b.initialKB} KB)` : ''}`);
for (const r of rep.rooms) console.log(`  room       ${kb(r.bytes).padStart(9)}  ${r.id}, ${Math.round(decoded(graph.rooms[r.id] ?? []) / 1048576)} MB decoded${b.roomKB !== undefined ? `  (budget ${b.roomKB} KB)` : ''}`);
for (const c of rep.chapters) console.log(`  chapter    ${kb(c.bytes).padStart(9)}  ${c.id}: ${c.rooms.join(', ')}${b.chapterKB !== undefined ? `  (budget ${b.chapterKB} KB)` : ''}`);
for (const m of missing) console.log(`  ✖ ${m}: no built file (${m.startsWith('shell:') ? 'npm run build:web' : 'npm run assets'})`);
for (const o of rep.over) console.log(`  ✖ ${o}`);
const release = process.argv.includes('--release');
const unset = (['initialKB', 'roomKB', 'chapterKB'] as const).filter((k) => b[k] === undefined);
if (unset.length) console.log(`  ${release ? '✖' : 'ℹ'} no ${unset.join(', ')}: set assetBudgets.${unset[0]} (and the others) in game.ts${release ? ': a release says how much it asks a phone to download' : ' to hold the game to them'}`);
const failed = rep.over.length + missing.length + (release ? unset.length : 0);
console.log(`${failed ? '✖' : '✔'}  [${GAME}] ${rep.over.length ? `${rep.over.length} budget(s) exceeded` : missing.length ? `${missing.length} file(s) missing` : release && unset.length ? 'no weight budget' : 'within budget'}`);
process.exit(failed ? 1 : 0);
