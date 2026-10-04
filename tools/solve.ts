// npm run solve: finds a witness that the game can be finished from "New game". Add --prove to exhaust the reachable
// graph and report every reachable state from which the goal is no longer reachable.
// Options: --max=20000 (number of states), --from=<checkpoint>, --json (JSON output for scripts/e2e.mjs: the labelled
// path and the session entries `steps` on stdout, no other text; the default output, meant for humans, doesn't change:
// other scripts read it), --profile (what the states are made of, what the search cost), --por=sleep|stubborn (partial-order reduction: fewer engine runs, or fewer states too), --chapters (one bounded search
// per checkpoint that declares `goals`: from the previous checkpoint until its goals hold, then from the last one to the
// ending; each chapter must be solvable on its own). With --prove, --chapters proves each chapter from every reachable
// boundary state of the previous one (deduped by what the chapter reads), not from the hand-written checkpoint, which
// must itself be one of those boundary states (src/engine/tools/chapters.ts).
// The game: GAME, otherwise package.json → config.game (see tools/game.ts).
import { cachedSolve } from './proof-cache';
import { exitOf, worstStatus, type SolveStatus } from '../src/engine/tools/status';
import { resolve } from 'node:path';
import { profileText } from '../src/engine/tools/solve';
import { MAX_STARTS, proveChapters } from '../src/engine/tools/chapters';
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
const mode = process.argv.includes('--prove') ? 'prove' as const : 'witness' as const;

if (process.argv.includes('--chapters') && mode === 'prove') {
  const p = await proveChapters(game, layouts, { maxStates, commands, mode: 'prove', solver: cachedSolve });
  // A game without chapters is proved by the global search (`--prove`): nothing more to do here, and not a failure.
  if (!p.chapters.length) { console.log('ℹ  No checkpoint declares `goals`: no chapter to prove (the global proof covers the game)'); process.exit(0); }
  if (asJson) { console.log(JSON.stringify({ status: p.status, exit: p.exit, headline: p.headline, ms: p.ms, chapters: p.chapters.map(({ results, ...c }) => ({ ...c, softlockCauses: results.flatMap((r) => r.softlockCauses) })) })); process.exit(p.exit); }
  for (const c of p.chapters) {
    const ok = c.status === 'solved' && !c.checkpointUnreachable;
    if (c.status === 'truncated' && !c.results.length) { console.log(`✖  chapter → ${c.id}: truncated, ${c.distinct} distinct boundary states exceed the budget of ${MAX_STARTS} starts (the proof stops here)`); continue; }
    console.log(`${ok ? '✔' : '✖'}  chapter → ${c.id}: ${c.status} from ${c.distinct} boundary state(s), ${c.states} states, ${(c.ms / 1000).toFixed(1)} s${c.softlockCount ? `, ${c.softlockCount} softlock state(s)` : ''}${c.boundaries ? `, ${c.boundaries} distinct boundary state(s) for the next chapter` : ''}`);
    if (c.checkpointUnreachable) console.log(`   ✖ checkpoint "${c.id}" is not one of the reachable boundary states of this chapter; closest one differs on: ${(c.checkpointDiff ?? []).join(', ') || '(nothing: no boundary state at all)'}`);
    for (const r of c.results) for (const cause of r.softlockCauses.slice(0, 5)) console.log(`   ✖ ${cause.count} softlock state(s) after "${cause.action}" in ${cause.room}: ${cause.sample.slice(-4).join(' › ')}`);
    for (const r of c.results) for (const e of r.errors) console.log('   ' + e);
  }
  const hits = p.chapters.flatMap((c) => c.results).filter((x) => (x as { cached?: string }).cached).length;
  console.log(`${p.exit === 0 ? '✔' : '✖'}  proof by chapters: ${p.headline} — ${(p.ms / 1000).toFixed(1)} s${hits ? ` (${hits} search(es) from the proof cache)` : ''}`);
  process.exit(p.exit);
}

if (process.argv.includes('--chapters')) {
  const cps = Object.entries(game.checkpoints ?? {}).filter(([, c]) => c.goals?.length);
  if (!cps.length) { console.log('ℹ  No checkpoint declares `goals`: no chapter to solve (the global search covers the game)'); process.exit(0); }
  let prev: string | null = null;
  let worst: SolveStatus = 'solved';
  for (const [id, c] of cps) {
    const t = Date.now();
    const r = await cachedSolve(game, layouts, { maxStates, start: prev ? { checkpoint: prev } : 'new', goal: c.goals, commands, por, mode });
    worst = worstStatus(worst, r.status);
    const ok = r.exit === 0;
    console.log(`${ok ? '✔' : '✖'}  chapter → ${id} (from ${prev ?? 'new game'}): ${r.finished ? `${r.path.length} actions` : 'goals not reached'}, ${r.states} states, ${((Date.now() - t) / 1000).toFixed(1)} s${r.truncated ? ' (limit reached)' : ''}${r.softlocks.length ? ` (${r.softlocks.length} softlock samples)` : ''}`);
    if (!r.finished) r.path.slice(-5).forEach((p) => console.log(`     … ${p}`));
    for (const b of r.broken) console.log(`   ✖ invariant #${b.invariant} became true after: ${b.path.slice(-3).join(' › ')}`);
    for (const e of r.errors) console.log('   ' + e);
    prev = id;
  }
  const t = Date.now();
  const r = await cachedSolve(game, layouts, { maxStates, start: { checkpoint: prev! }, commands, por, mode });
  worst = worstStatus(worst, r.status);
  const ok = r.exit === 0;
  console.log(`${ok ? '✔' : '✖'}  chapter → ending (from ${prev}): ${r.finished ? `${r.path.length} actions` : 'no ending reached'}, ${r.states} states, ${((Date.now() - t) / 1000).toFixed(1)} s`);
  for (const b of r.broken) console.log(`   ✖ invariant #${b.invariant} became true after: ${b.path.slice(-3).join(' › ')}`);
  process.exit(exitOf(worst));
}

const r = await cachedSolve(game, layouts, { maxStates, start: from ? { checkpoint: from } : 'new', commands, por, mode });

if (asJson) {
  // `path` labels each step for humans; `steps` are the session entries ({ act, picks… }) the e2e harness replays.
  console.log(JSON.stringify({
    status: r.status, exit: r.exit, headline: r.headline, mode: r.mode, cached: r.cached ?? null, finished: r.finished, states: r.states, truncated: r.truncated, path: r.path, steps: r.steps,
    softlockCount: r.softlockCount, softlockCauses: r.softlockCauses,
    roomsReached: r.roomsReached, unlockedReached: r.unlockedReached, flagsReached: r.flagsReached,
    itemsNeverUsed: r.itemsNeverUsed, unusedItems: r.unusedItems, softlocks: r.softlocks, assumptions: r.assumptions,
    errors: r.errors, broken: r.broken, profile: r.profile,
  }));
  process.exit(r.exit);
}

console.log(`\n${r.finished ? '✔  The game can be finished' : '…  No ending reached'} — ${r.states} states explored in ${((Date.now() - t0) / 1000).toFixed(1)} s${r.truncated ? ' (limit reached)' : ''}`);
console.log(`${r.exit === 0 ? '✔' : '✖'}  ${r.mode === 'prove' ? 'Proof' : 'Witness'} ${r.headline}${r.assumptions.length ? ` · assumptions: ${r.assumptions.join(', ')}` : ''}`);
if (r.cached) console.log(`   (from the proof cache, key ${r.cached}: the engine, the game and the options are unchanged; --no-cache runs it again)`);
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
if (r.softlockCount) {
  console.log(`\n✖  Reachable softlocks: ${r.softlockCount} state(s) from which the ending is lost, ${r.softlockCauses.length} cause(s):`);
  for (const c of r.softlockCauses.slice(0, 10)) console.log(`  - ${c.count} state(s) after "${c.action}" in ${c.room}: ${c.sample.slice(-4).join(' › ') || 'the start'}`);
  console.log(`  (the path shown is the shortest found, not necessarily the shortest there is)`);
}
if (r.broken.length) {
  console.log(`\n✖  Invariants broken (${r.broken.length}):`);
  for (const b of r.broken) console.log(`   #${b.invariant} ${JSON.stringify(game.invariants?.[b.invariant])} became true after: ${b.path.slice(-4).join(' › ') || 'the start'}`);
}
if (r.errors.length) { console.log(`\n✖  Errors during exploration:`); r.errors.forEach((e) => console.log('   ' + e)); }
if (process.argv.includes('--profile')) console.log('\n' + profileText(r.profile, game));
process.exit(r.exit);
