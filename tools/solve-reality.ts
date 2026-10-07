// npm run solve:reality [-- --json] (4.1.1, Reality Bridge): a game that takes signals from outside is proved in
// every world it may meet. Closed: finishable on its own, through each required signal's fallback, with no softlock.
// Each scenario of games/<id>/reality/scenarios/*.json ({ "signals": [...] }): finishable with those signals, in that
// order; each recorded replay of games/<id>/replays/*.json (4.1.9) too. Adversarial: any declared signal at any point,
// again and again, creates no softlock. A truncated search is a failure, never a proof. No service is contacted. A
// game without `reality`: nothing to do. In prove:game.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { solve, type RealityPolicy } from '../src/engine/tools/solve';
import '../src/engine/tools/solve-pool';
import { loadLayouts } from '../src/engine/tools/load';
import { GAME, GAME_DIR, loadGameModule } from './game';
import { flushExit } from './flush';

const { game, commands } = await loadGameModule();
const asJson = process.argv.includes('--json');
if (!game.reality) {
  if (!asJson) console.log(`[${GAME}] no reality.signals: proved closed by npm run solve`);
  await flushExit(0);
}
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
// The scenarios, then the replays the connectors recorded (4.1.9, games/<id>/replays/*.json: their `signals`, in order).
const read = (dir: string, prefix: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => ({
          scenario: `${prefix}${basename(f, '.json')}`,
          signals: (JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as { signals: string[] }).signals,
        }))
    : [];
const scenarios = [
  ...read(resolve(GAME_DIR, 'reality', 'scenarios'), ''),
  ...read(resolve(GAME_DIR, 'replays'), 'replay '),
];
const declared = new Set(game.reality!.signals.map((s) => s.id));
const problems: string[] = [];
for (const s of scenarios)
  for (const sg of s.signals) if (!declared.has(sg)) problems.push(`scenario ${s.scenario}: "${sg}" is not declared`);
const required = game.reality!.signals.filter((s) => s.availability === 'required');
if (required.length && !scenarios.some((s) => required.every((r) => s.signals.includes(r.id))))
  problems.push(
    `no scenario sends every required signal (${required.map((r) => r.id).join(', ')}): add one in reality/scenarios/`,
  );

const runs: { world: string; status: string; states: number; softlocks: number; finished: boolean }[] = [];
const worlds: RealityPolicy[] = ['closed', ...scenarios, 'adversarial'];
for (const reality of worlds) {
  const r = await solve(structuredClone(game), layouts, { mode: 'prove', reality, ...(commands ? { commands } : {}) });
  runs.push({
    world: r.reality ?? '',
    status: r.status,
    states: r.states,
    softlocks: r.softlockCount,
    finished: r.finished,
  });
  if (r.status !== 'solved')
    problems.push(`${r.reality}: ${r.status}${r.softlockCount ? ` (${r.softlockCount} softlocks)` : ''}`);
}
if (asJson) console.log(JSON.stringify({ game: game.id, runs, problems }));
else {
  for (const r of runs)
    console.log(
      `  ${r.status === 'solved' ? '✔' : '✖'} ${r.world}: ${r.status}, ${r.states} states, ${r.softlocks} softlocks`,
    );
  for (const p of problems) console.log('  ✖ ' + p);
  console.log(
    problems.length
      ? `✖  [${GAME}] not proved in every world`
      : `✔  [${GAME}] proved closed, under ${scenarios.length} scenario(s) and adversarial`,
  );
}
await flushExit(problems.length ? 1 : 0);
