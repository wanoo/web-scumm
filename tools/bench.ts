// npm run bench [-- --rooms=40 --players=3 --items=30 --flags=100 --npcs=5 --scripts=10 --topics=40 --max=200000 --prove --v3]
// --prove adds the exhaustive proof of the whole game (slow on a big one: the reduction is off in proof mode);
// --v3 generates the game with stable ids (schemaVersion 3), as a real v3 game.
// Generates a game of that size (src/engine/tools/stress.ts) and times every tool on it: validate, solve (global and
// per chapter, plain and with the partial-order reduction), the content report, the world and puzzle graphs, text
// extraction and translation, a save migration.
import { validate } from '../src/engine/tools/validate';
import { solve } from '../src/engine/tools/solve';
import { report, reportMarkdown } from '../src/engine/tools/report';
import { worldGraph, toSvg } from '../src/engine/tools/graph';
import { puzzleGraph, toPuzzleSvg } from '../src/engine/tools/puzzle';
import { applyLocale, textPaths } from '../src/engine/tools/i18n';
import { migrate } from '../src/engine/core/migrate';
import { makeStressGame } from '../src/engine/tools/stress';
import { Engine } from '../src/engine/core/engine';
import { FakePresenter, MemoryStore } from '../src/engine/core/ports';

const arg = (k: string, d: number) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? Number(m.slice(k.length + 3)) : d; };
const opts = { rooms: arg('rooms', 40), players: arg('players', 3), items: arg('items', 30), flags: arg('flags', 100), npcs: arg('npcs', 5), scripts: arg('scripts', 10), topics: arg('topics', 40) };
const max = arg('max', 200000);
const prove = process.argv.includes('--prove');
const v3 = process.argv.includes('--v3');
const { game, layouts } = makeStressGame({ ...opts, ...(v3 ? { schemaVersion: 3 as const } : {}) });
const rows: [string, string][] = [];
const time = async <T>(label: string, fn: () => T | Promise<T>, note: (r: T) => string = () => '') => {
  const t0 = performance.now();
  const r = await fn();
  rows.push([label, `${(performance.now() - t0).toFixed(0)} ms ${note(r)}`.trim()]);
  return r;
};

console.log(`stress game: ${game.rooms.length} rooms, ${Object.keys(game.items).length} items, ${game.players?.ids.length ?? 1} players, ${Object.keys(game.characters).length} characters, ` +
  `${game.rooms.reduce((n, r) => n + (r.on?.length ?? 0), 0)} rules, ${game.rooms.reduce((n, r) => n + Object.values(r.talk ?? {}).flat().length, 0)} topics, ` +
  `${(game.scripts?.length ?? 0) + game.rooms.reduce((n, r) => n + (r.scripts?.length ?? 0), 0)} scripts, ${Object.keys(game.checkpoints ?? {}).length} chapters, ${game.migrations?.length ?? 0} migrations`);
const v = await time('validate', () => validate(game, layouts), (r) => `${r.errors.length} errors, ${r.warnings.length} warnings`);
if (v.errors.length) console.log(v.errors.slice(0, 5).join('\n'));
await time('report', () => reportMarkdown(report(game, layouts)), (r) => `${r.length} chars`);
await time('world graph + svg', () => toSvg(worldGraph(game)), (r) => `${r.length} chars`);
await time('puzzle graph + svg', () => { const g = puzzleGraph(game); return { g, svg: toPuzzleSvg(g) }; }, (r) => `${r.g.nodes.length} nodes, ${r.g.edges.length} edges`);
await time('texts: extract + apply', () => { const p = textPaths(game); return applyLocale(game, Object.fromEntries(p.map((x) => [x.path, x.text.toUpperCase()]))); }, (r) => `${textPaths(r).length} texts`);
await time('migrate a v1 save', () => { const e = new Engine(structuredClone(game), layouts, new FakePresenter(), new MemoryStore()); return e.newGame().then(() => migrate(game, { ...structuredClone(e.state), v: 1, flags: { old_1: true, tmp_1: true } })); }, (r) => `v${r?.v}`);
const cps = Object.keys(game.checkpoints ?? {});
let prev: string | undefined;
for (const cp of cps) {
  const goal = game.checkpoints![cp].goals;
  await time(`solve chapter ${cp}`, () => solve(game, layouts, { maxStates: max, start: prev ? { checkpoint: prev } : 'new', goal }), (r) => `${r.finished ? 'finished' : 'NOT finished'}, ${r.states} states, ${r.path.length} actions, ${r.profile.tries} runs${r.truncated ? ' (limit)' : ''}`);
  prev = cp;
}
await time(`solve from ${prev} to the end`, () => solve(game, layouts, { maxStates: max, start: { checkpoint: prev! } }), (r) => `${r.finished ? 'finished' : 'NOT finished'}, ${r.states} states, ${r.path.length} actions, ${r.profile.tries} runs${r.truncated ? ' (limit)' : ''}`);
await time('solve global', () => solve(game, layouts, { maxStates: max }), (r) => `${r.finished ? 'finished' : 'NOT finished'}, ${r.states} states, ${r.path.length} actions, ${r.profile.tries} runs${r.truncated ? ' (limit)' : ''}${r.broken.length ? `, ${r.broken.length} invariant(s) broken` : ''}`);
if (prove) await time('solve global, --prove', () => solve(game, layouts, { maxStates: max, mode: 'prove' }), (r) => `${r.status}, ${r.states} states, ${r.profile.tries} runs, ${r.softlocks.length} softlock sample(s)${r.truncated ? ' (limit)' : ''}`);
await time('solve global, --por=stubborn', () => solve(game, layouts, { maxStates: max, por: 'stubborn' }), (r) => `${r.finished ? 'finished' : 'NOT finished'}, ${r.states} states, ${r.path.length} actions, ${r.profile.tries} runs, ${r.profile.postponed} postponed${r.truncated ? ' (limit)' : ''}`);
console.log('');
console.log('| Step | Result |', '\n|---|---|');
for (const [a, b] of rows) console.log(`| ${a} | ${b} |`);
