#!/usr/bin/env node
// npm run e2e [url] [--game demo] [--at=<checkpoint>] [--prod] [--generic] [--keyboard]
// Plays a web-scumm game by touch in a phone-sized browser (E2E_BROWSER=chromium|webkit|firefox).
//   - If games/<GAME>/e2e.mjs exists, it is loaded and must export `run(harness)`: a game-specific walkthrough,
//     free to call the generic harness and to play its own minigames for real instead of skipping them.
//   - Otherwise, this script asks `npm run solve -- --json` for an action path and replays it with
//     harness.walkthrough(steps).
// Screenshots land in E2E_OUT (default /tmp/e2e). The server (dev or deployed) must already answer at <url>.
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launch } from './e2e/lib.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173/';
// Flags accept both "--name value" and "--name=value".
const flag = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
};
const at = flag('at');
const prod = args.includes('--prod');
const generic = args.includes('--generic');
const keyboard = args.includes('--keyboard');
// Same game resolution as tools/game.ts (env GAME, else package.json config.game, else "demo"); --game overrides both.
const GAME = flag('game') ?? process.env.GAME ?? 'demo';

console.log(`e2e: ${url} (game: ${GAME}, browser: ${process.env.E2E_BROWSER ?? 'chromium'}, ${prod ? 'production' : 'development'}${keyboard ? ', keyboard' : ''})`);
const harness = await launch(url, { at, dev: !prod, input: keyboard ? 'keyboard' : undefined });
let ok = true;
try {
  const gameScript = resolve(ROOT, 'games', GAME, 'e2e.mjs');
  if (!generic && existsSync(gameScript)) {
    console.log(`e2e: playing games/${GAME}/e2e.mjs`);
    const { run } = await import(pathToFileURL(gameScript).href);
    await run(harness);
  } else {
    console.log('e2e: no games/<id>/e2e.mjs — replaying `npm run solve -- --json`');
    const r = spawnSync('npx', ['tsx', 'tools/solve.ts', '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GAME } });
    const stdout = (r.stdout ?? '').trim();
    if (!stdout) throw new Error(`npm run solve -- --json produced no output${r.stderr ? `: ${r.stderr}` : ''}`);
    const solved = JSON.parse(stdout.split('\n').pop());
    if (!solved.finished) console.log('e2e: warning — the solver did not reach the end; replaying its best path anyway');
    console.log(`e2e: replaying ${solved.steps.length} step(s) from the solver`);
    await harness.walkthrough(solved.steps);
  }
  console.log('e2e: done');
} catch (e) {
  ok = false;
  console.error('e2e: FAILED —', e.message);
  try { console.error('e2e: engine at failure:', JSON.stringify(await harness.diagnose())); } catch { /* page gone */ }
} finally {
  await harness.close();
}
if (harness.errors.length) {
  console.error(`e2e: ${harness.errors.length} browser error(s):`);
  harness.errors.forEach((e) => console.error('  ' + e));
  ok = false;
}
process.exit(ok ? 0 : 1);
