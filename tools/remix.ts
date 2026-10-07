// npm run remix -- --seed <code> [--mode=remix|daily|…] [--json]: the world a seed makes for the current game (4.1.15,
// ADR 0018), its assignments and its hash; the same seed gives the same hash on every machine and browser.
// npm run remix -- --preview <code>: the same world, read: each dimension's value, then `validate` and a solver witness
// on that instance (`--max=<states>`, default 20000). `--seed story` is the author's world.
import { resolve } from 'node:path';
import { flushExit } from './flush';
import { cachedSolve } from './proof-cache';
import { GAME, GAME_DIR, loadGameModule } from './game';
import { compileVariant } from '../src/engine/core/remix/compile';
import { applyVariant, compileGameManifest } from '../src/engine/core/remix/apply';
import { REMIX_ALGORITHM_VERSION } from '../src/engine/core/remix/manifest';
import { describeVariant } from '../src/engine/tools/remix';
import { validate } from '../src/engine/tools/validate';
import { loadLayouts } from '../src/engine/tools/load';

const argv = process.argv.slice(2);
const after = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
};
const preview = after('preview');
const seed = preview ?? after('seed');
if (!seed) {
  console.error('usage: npm run remix -- --seed <WS-XXXX-XXXX|story> [--mode=remix] [--json] | --preview <seed>');
  await flushExit(2);
}
const { game, commands } = await loadGameModule();
if (!game.remix) {
  console.error(`✗  [${GAME}] declares no \`remix\` manifest: one world, the story`);
  await flushExit(1);
}
const c = compileGameManifest(game);
const mode = after('mode') ?? 'remix';
let variant: ReturnType<typeof compileVariant>;
try {
  variant = compileVariant(c, game.remix!, seed!, Number(after('version') ?? REMIX_ALGORITHM_VERSION), mode);
} catch (e) {
  console.error(`✗  ${(e as Error).message}`);
  await flushExit(1);
}
if (argv.includes('--json') && !preview) {
  console.log(JSON.stringify(variant!, null, 1));
  await flushExit(0);
}
for (const l of describeVariant(game, variant!)) console.log(l);
if (!preview) await flushExit(0);

const world = applyVariant(game, variant!);
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const r = validate(world, layouts, { commands });
console.log(`validate: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
for (const e of r.errors) console.log(`  ✗ ${e}`);
const s = await cachedSolve(world, layouts, { commands, maxStates: Number(after('max') ?? 20000) });
console.log(`solve: ${s.headline}${s.cached ? ` (cached ${s.cached})` : ''}`);
await flushExit(r.errors.length || s.status !== 'solved' ? 1 : 0);
