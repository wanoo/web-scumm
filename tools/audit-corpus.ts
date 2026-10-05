// npm run audit:corpus [-- --seeds=500 --from=1 --max=3000 --json=corpus.json | --merge a.json b.json]: the
// abstractions against the explicit search on many random games (3.6, the nightly workflow): for each seed, the generator's three kinds of game (tests/gen/random-game.ts):
// plain, with free items (the canonical owner), and with three characters and free items (pooling by group). Prints a
// count per verdict and every divergence; exit 1 on a divergence. `partial` (the explicit search hit --max) is not a
// failure: those verdicts are just not compared, and the counts say so (3.6.1: tried, compared, partial). `--json`:
// the same counts in a file (the nightly's artifact).
// `--merge a.json b.json …` (3.7): the counts of several shards (the nightly runs one per job) added up, printed, and
// written with `--json`; exit 1 on a divergence in any of them.
import { readFileSync, writeFileSync } from 'node:fs';
import { auditAbstractions } from '../src/engine/tools/audit';
import { randomGame } from '../tests/gen/random-game';

interface Counts { tried: number; compared: number; same: number; partial: number; diverged: number; handovers: number }
interface Shard { from: number; seeds: number; max: number; seconds: number; kinds: Record<string, Counts>; divergences: string[] }
const json = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
const print = (title: string, r: Shard) => {
  console.log(title);
  for (const [k, c] of Object.entries(r.kinds)) console.log(`  ${k.padEnd(17)} ${c.tried} tried, ${c.compared} compared (${c.same} same, ${c.diverged} diverged), ${c.partial} partial (${c.handovers} with hand-overs)`);
  for (const d of r.divergences) console.log(`  ✖ ${d}`);
  console.log(`${r.divergences.length ? '✖' : '✔'}  ${r.divergences.length ? `${r.divergences.length} divergence(s)` : 'no divergence'}`);
  if (json) writeFileSync(json, JSON.stringify(r, null, 1) + '\n');
  process.exit(r.divergences.length ? 1 : 0);
};
if (process.argv.includes('--merge')) {
  const files = process.argv.slice(process.argv.indexOf('--merge') + 1).filter((a) => !a.startsWith('--'));
  const shards = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Shard);
  const kinds: Record<string, Counts> = {};
  for (const sh of shards) for (const [k, c] of Object.entries(sh.kinds)) {
    const t = (kinds[k] ??= { tried: 0, compared: 0, same: 0, partial: 0, diverged: 0, handovers: 0 });
    for (const f of Object.keys(t) as (keyof Counts)[]) t[f] += c[f];
  }
  const merged: Shard = { from: Math.min(...shards.map((s) => s.from)), seeds: shards.reduce((n, s) => n + s.seeds, 0), max: Math.max(...shards.map((s) => s.max)), seconds: Math.max(...shards.map((s) => s.seconds)), kinds, divergences: shards.flatMap((s) => s.divergences) };
  print(`audit corpus: ${shards.length} shard(s), ${merged.seeds} seeds, ${merged.max} states at most each, ${merged.seconds} s for the slowest`, merged);
}

const arg = (k: string, d: number) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? Number(m.slice(k.length + 3)) : d; };
const seeds = arg('seeds', 100), from = arg('from', 1), max = arg('max', 3000);
const kinds = [{ name: 'plain', o: {} }, { name: 'free items', o: { free: true } }, { name: 'three characters', o: { free: true, players: 3 as const } }];
const t0 = Date.now();
const diverged: string[] = [];
const count: Record<string, Record<string, number>> = {};
for (let seed = from; seed < from + seeds; seed++) {
  for (const k of kinds) {
    const { game, layouts } = randomGame(seed, k.o);
    const a = await auditAbstractions(game, layouts, { maxStates: max });
    (count[k.name] ??= { same: 0, partial: 0, diverged: 0, handovers: 0 })[a.status]++;
    if (a.abstract.handovers) count[k.name].handovers++;
    if (a.status === 'diverged') diverged.push(`seed ${seed} (${k.name}): ${a.divergences.join('; ')}`);
  }
}
const seconds = Math.round((Date.now() - t0) / 1000);
print(`audit corpus: seeds ${from}–${from + seeds - 1}, ${max} states at most each, ${seconds} s`, { from, seeds, max, seconds, kinds: Object.fromEntries(Object.entries(count).map(([k, c]) => [k, { tried: seeds, compared: c.same + c.diverged, same: c.same, partial: c.partial, diverged: c.diverged, handovers: c.handovers }])), divergences: diverged });
