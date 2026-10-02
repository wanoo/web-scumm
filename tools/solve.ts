// npm run solve: proves that the game can be finished from "New game".
// Options: --max=20000 (number of states), --from=<checkpoint>, --json (JSON output for scripts/e2e.mjs: the action
// path on stdout, no other text; the default output, meant for humans, doesn't change).
// The game: GAME, otherwise package.json → config.game (see tools/game.ts).
import { resolve } from 'node:path';
import { solve } from '../src/engine/tools/solve';
import { loadLayouts } from '../src/engine/tools/load';
import { GAME_DIR, loadGameModule } from './game';

const { game } = await loadGameModule();
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const from = arg('from');
const asJson = process.argv.includes('--json');
const t0 = Date.now();
const r = await solve(game, layouts, { maxStates: Number(arg('max') ?? 20000), start: from ? { checkpoint: from } : 'new' });

if (asJson) {
  // The solver only labels each step (e.g. "Open door", "Give key → grandpa", `Talk lou: "..."`,
  // "Map → Market"); it does not keep the raw { verb, a, b } objects. scripts/e2e/lib.mjs's walkthrough()
  // parses these labels back into actions at runtime, using the game's own verbs (id, label, join).
  console.log(JSON.stringify({
    finished: r.finished, states: r.states, truncated: r.truncated, path: r.path,
    roomsReached: r.roomsReached, unlockedReached: r.unlockedReached, flagsReached: r.flagsReached,
    itemsNeverUsed: r.itemsNeverUsed, unusedItems: r.unusedItems, errors: r.errors,
  }));
  process.exit(r.errors.length ? 1 : 0);
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
if (r.errors.length) { console.log(`\n✖  Errors during exploration:`); r.errors.forEach((e) => console.log('   ' + e)); }
process.exit(r.errors.length ? 1 : 0);
