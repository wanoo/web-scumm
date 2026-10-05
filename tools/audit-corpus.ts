// npm run audit:corpus [-- --seeds=500 --from=1 --max=3000]: the abstractions against the explicit search on many
// random games (3.6, the nightly workflow): for each seed, the generator's three kinds of game (tests/gen/random-game.ts):
// plain, with free items (the canonical owner), and with three characters and free items (pooling by group). Prints a
// count per verdict and every divergence; exit 1 on a divergence. `partial` (the explicit search hit --max) is not a
// failure: those verdicts are just not compared.
import { auditAbstractions } from '../src/engine/tools/audit';
import { randomGame } from '../tests/gen/random-game';

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
console.log(`audit corpus: seeds ${from}–${from + seeds - 1}, ${max} states at most each, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const [k, c] of Object.entries(count)) console.log(`  ${k.padEnd(17)} ${c.same} same, ${c.partial} partial, ${c.diverged} diverged (${c.handovers} with hand-overs)`);
for (const d of diverged) console.log(`  ✖ ${d}`);
console.log(`${diverged.length ? '✖' : '✔'}  ${diverged.length ? `${diverged.length} divergence(s)` : 'no divergence'}`);
process.exit(diverged.length ? 1 : 0);
