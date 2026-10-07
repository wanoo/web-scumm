// npx tsx tools/speedrun/reference-run.ts [--category=any%] [--out=<file>] (4.1.14 "Time Attack"): a complete
// attempt of the current game (the reference chapter by default) recorded as a speedrun: the solver's route is played
// on the engine with the live recorder attached and the category's seed, then sealed into its `.wsrun`. The file
// committed under tests/fixtures/speedrun/ is this tool's output; tests/speedrun-reference.test.ts verifies it, and
// release.yml attaches it to the release (its ninth asset) after `npm run speedrun:verify` accepted it. Regenerate it
// after `npm version` or any change of the reference game's logic: a run is bound to its engine and its fingerprint.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

process.env.GAME ??= 'reference';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const { MemoryChunkStore } = await import('../../src/engine/core/journal-chunks');
const { solve } = await import('../../src/engine/tools/solve');
const { replay } = await import('../../src/engine/tools/replay');
const { exportEnvelope } = await import('../../src/engine/tools/speedrun/envelope');
const { SpeedrunRecorder } = await import('../../src/engine/tools/speedrun/recorder');
const { formatTime } = await import('../../src/engine/tools/speedrun/splits');
const { approvedContext } = await import('./package');
const { ROOT } = await import('../game');

const ctx = await approvedContext();
const manifest = ctx.game.speedrun;
const categoryId = arg('category') ?? 'any%';
const category = manifest?.categories.find((c) => c.id === categoryId);
if (!manifest || !category) throw new Error(`${ctx.game.id} has no speedrun category "${categoryId}"`);
const witness = await solve(structuredClone(ctx.game), ctx.layouts, { maxStates: 200000, commands: ctx.commands });
if (!witness.finished) throw new Error(`the solver found no route to the end of ${ctx.game.id}`);
const rec = new SpeedrunRecorder({
  engine: null as never,
  gameId: ctx.game.id,
  manifest,
  category,
  store: new MemoryChunkStore(),
  fingerprint: ctx.fingerprint,
  engineVersion: ctx.engineVersion,
  runId: `reference-${categoryId}`,
  now: () => 0,
});
await rec.prepare();
const r = await replay(
  ctx.game,
  ctx.layouts,
  { start: { kind: 'new' }, log: witness.steps.map(({ rnd: _, ...s }) => s) },
  { commands: ctx.commands, seed: rec.seed, attach: (e) => rec.bind(e) },
);
if (!r.ended) throw new Error(`the route did not reach the ending with the seed ${rec.seed}`);
const envelope = await rec.seal();
const out = resolve(ROOT, arg('out') ?? `tests/fixtures/speedrun/${ctx.game.id}-${categoryId.replace(/%/g, '')}.wsrun`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${exportEnvelope(envelope)}\n`);
console.log(
  `${out}: ${category.name}, ${envelope.timing.logicalSteps} steps, IGT ${formatTime(BigInt(envelope.timing.logicalTime))}, active ${formatTime(BigInt(envelope.timing.activeTime))}, proof ${envelope.finalProof.slice(0, 16)}…`,
);
