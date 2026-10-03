// npm run solve: proves that the game can be finished from "New game".
// Options: --max=20000 (number of states), --from=<checkpoint>, --json (JSON output for scripts/e2e.mjs: the labelled
// path and the session entries `steps` on stdout, no other text; the default output, meant for humans, doesn't change:
// other scripts read it), --profile (what the states are made of, what the search cost), --por=sleep|stubborn (partial-order reduction: fewer engine runs, or fewer states too), --chapters (one bounded search
// per checkpoint that declares `goals`: from the previous checkpoint until its goals hold, then from the last one to the
// ending; each chapter must be solvable on its own).
// The game: GAME, otherwise package.json → config.game (see tools/game.ts).
import { resolve } from 'node:path';
import { profileText, solve } from '../src/engine/tools/solve';
import { loadLayouts } from '../src/engine/tools/load';
import { GAME_DIR, loadGameModule } from './game';

const { game, commands } = await loadGameModule();
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const from = arg('from');
const asJson = process.argv.includes('--json');
const t0 = Date.now();
const maxStates = Number(arg('max') ?? 20000);
const por = arg('por') === 'sleep' ? 'sleep' as const : arg('por') === 'stubborn' ? 'stubborn' as const : false;

if (process.argv.includes('--chapters')) {
  const cps = Object.entries(game.checkpoints ?? {}).filter(([, c]) => c.goals?.length);
  if (!cps.length) { console.log('✖  No checkpoint declares `goals`: nothing to solve by chapter'); process.exit(1); }
  let prev: string | null = null;
  let bad = 0;
  for (const [id, c] of cps) {
    const t = Date.now();
    const r = await solve(game, layouts, { maxStates, start: prev ? { checkpoint: prev } : 'new', goal: c.goals, commands, por });
    const ok = r.finished && !r.broken.length;
    if (!ok) bad++;
    console.log(`${ok ? '✔' : '✖'}  chapter → ${id} (from ${prev ?? 'new game'}): ${r.finished ? `${r.path.length} actions` : 'goals not reached'}, ${r.states} states, ${((Date.now() - t) / 1000).toFixed(1)} s${r.truncated ? ' (limit reached)' : ''}`);
    if (!r.finished) r.path.slice(-5).forEach((p) => console.log(`     … ${p}`));
    for (const b of r.broken) console.log(`   ✖ invariant #${b.invariant} became true after: ${b.path.slice(-3).join(' › ')}`);
    for (const e of r.errors) console.log('   ' + e);
    prev = id;
  }
  const t = Date.now();
  const r = await solve(game, layouts, { maxStates, start: { checkpoint: prev! }, commands, por });
  const ok = r.finished && !r.broken.length;
  if (!ok) bad++;
  console.log(`${ok ? '✔' : '✖'}  chapter → ending (from ${prev}): ${r.finished ? `${r.path.length} actions` : 'no ending reached'}, ${r.states} states, ${((Date.now() - t) / 1000).toFixed(1)} s`);
  for (const b of r.broken) console.log(`   ✖ invariant #${b.invariant} became true after: ${b.path.slice(-3).join(' › ')}`);
  process.exit(bad ? 1 : 0);
}

const r = await solve(game, layouts, { maxStates, start: from ? { checkpoint: from } : 'new', commands, por });

if (asJson) {
  // `path` labels each step for humans; `steps` are the session entries ({ act, picks… }) the e2e harness replays.
  console.log(JSON.stringify({
    finished: r.finished, states: r.states, truncated: r.truncated, path: r.path, steps: r.steps,
    roomsReached: r.roomsReached, unlockedReached: r.unlockedReached, flagsReached: r.flagsReached,
    itemsNeverUsed: r.itemsNeverUsed, unusedItems: r.unusedItems, errors: r.errors, broken: r.broken, profile: r.profile,
  }));
  process.exit(r.errors.length || r.broken.length ? 1 : 0);
}

console.log(`\n${r.finished ? '✔  The game can be finished' : '…  No ending reached'} — ${r.states} states explored in ${((Date.now() - t0) / 1000).toFixed(1)} s${r.truncated ? ' (limit reached)' : ''}`);
console.log(`\n${r.finished ? 'Path found' : 'Path to the last explored state'} (${r.path.length} actions):`);
r.path.forEach((p, i) => console.log(`  ${String(i + 1).padStart(3)}. ${p}`));
console.log(`\nRooms reached: ${r.roomsReached.join(', ') || '—'}`);
console.log(`Places unlocked on the map: ${r.unlockedReached.join(', ') || '—'}`);
console.log(`Flags set: ${r.flagsReached.join(', ') || '—'}`);
if (r.itemsNeverUsed.length) console.log(`Items obtained but never used in a rule: ${r.itemsNeverUsed.join(', ')}`);
if (r.unusedItems.length) console.log(`Items never obtained: ${r.unusedItems.join(', ')}`);
if (r.deadEnds.length) {
  console.log(`\nDead ends (${r.deadEnds.length}):`);
  for (const d of r.deadEnds.slice(0, 5)) console.log(`  - ${d.room}, inventory [${d.inventory.join(', ')}] after: ${d.path.slice(-3).join(' › ') || 'the start'}`);
}
if (r.broken.length) {
  console.log(`\n✖  Invariants broken (${r.broken.length}):`);
  for (const b of r.broken) console.log(`   #${b.invariant} ${JSON.stringify(game.invariants?.[b.invariant])} became true after: ${b.path.slice(-4).join(' › ') || 'the start'}`);
}
if (r.errors.length) { console.log(`\n✖  Errors during exploration:`); r.errors.forEach((e) => console.log('   ' + e)); }
if (process.argv.includes('--profile')) console.log('\n' + profileText(r.profile, game));
process.exit(r.errors.length || r.broken.length ? 1 : 0);
