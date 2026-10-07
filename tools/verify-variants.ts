// npm run verify:variants: every world a mode of the current game can make, checked (4.1.15, ADR 0018, D25).
// A `catalogue` mode: each logical instance (presentation left out, D27) validated and solved; each one is a release
// gate (exit 1 if one fails). A `generator` mode: a published sample of seeds (`--sample=50`), validated and solved; the
// report says "sample", never "all seeds". Both print the coverage per dimension and per pair of dimensions, the values
// never chosen and the dominant ones. A certificate per instance goes to .cache/proofs/variants/<logical key>.json;
// `--out=<file>` writes the whole report (the release asset). `--max=<states>` bounds each search (default 20000);
// `--prove` runs the exhaustive proof per instance instead of a witness (to the ending, then to every objective).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { flushExit } from './flush';
import { cacheDir, cachedSolve, engineHash } from './proof-cache';
import { GAME, GAME_DIR, loadGameModule } from './game';
import { applyVariant, compileGameManifest } from '../src/engine/core/remix/apply';
import { logicalKey, RemixManifestError } from '../src/engine/core/remix/compile';
import { coverage, instancesOf, remixGoals, seedDraws } from '../src/engine/tools/remix';
import { validate } from '../src/engine/tools/validate';
import { loadLayouts } from '../src/engine/tools/load';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const { game, commands } = await loadGameModule();
if (!game.remix) {
  console.log(`✔  [${GAME}] declares no \`remix\` manifest: one world, the story (proved by npm run solve)`);
  await flushExit(0);
}
let c: ReturnType<typeof compileGameManifest>;
try {
  c = compileGameManifest(game);
} catch (e) {
  console.error(`✗  [${GAME}] ${e instanceof RemixManifestError ? e.message : String(e)}`);
  await flushExit(1);
}
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const maxStates = Number(arg('max') ?? 20000);
const sample = Number(arg('sample') ?? 50);
const draws = Number(arg('draws') ?? 1000);
// --prove: the exhaustive proof per instance (no softlock), not only a witness; what `prove:game` does for the story.
const prove = process.argv.includes('--prove');
const certDir = join(cacheDir(), 'variants');
mkdirSync(certDir, { recursive: true });
const report: Record<string, unknown> = {
  game: GAME,
  check: process.argv.includes('--prove') ? 'prove' : 'witness',
  manifestHash: c!.hash,
  engine: engineHash().slice(0, 16),
  modes: [],
};
let failed = 0;
const proved = new Map<string, string>();

for (const mode of game.remix!.modes) {
  let set: ReturnType<typeof instancesOf>;
  try {
    set = instancesOf(game, mode.id, sample);
  } catch (e) {
    console.error(`✗  mode ${mode.id}: ${e instanceof RemixManifestError ? e.problems.join('; ') : String(e)}`);
    failed++;
    continue;
  }
  const rows: { seed: string; world: string; logical: string; status: string; errors: number }[] = [];
  for (const v of set.variants) {
    const key = logicalKey(c!, v);
    let status = proved.get(key);
    let errors = 0;
    if (!status) {
      const world = applyVariant(game, v);
      const r = validate(world, layouts, { commands });
      errors = r.errors.length;
      const s = await cachedSolve(world, layouts, { commands, maxStates, mode: prove ? 'prove' : 'witness' });
      // Every objective, the optional ones included, and what a coupled answer or a code wheel sets, reachable in this
      // world (the answer its hint names, an order's group).
      const goal = [...Object.values(world.objectives ?? {}).map((o) => o.done), ...remixGoals(world)];
      const all = goal.length ? await cachedSolve(world, layouts, { commands, maxStates, goal }) : s;
      status = errors
        ? 'invalid'
        : s.status !== 'solved'
          ? s.status
          : all.status !== 'solved'
            ? `objectives ${all.status}`
            : 'solved';
      if (prove && s.truncated) status = 'truncated (raise --max)';
      else if (prove && s.softlockCount) status = `${s.softlockCount} softlock(s)`;
      proved.set(key, status);
      writeFileSync(
        join(certDir, `${key}.json`),
        JSON.stringify(
          {
            game: GAME,
            key,
            mode: mode.id,
            assignments: v.assignments,
            status,
            headline: s.headline,
            states: s.states,
            steps: s.path.length,
            errors: r.errors,
            engine: report.engine,
            manifestHash: c!.hash,
          },
          null,
          1,
        ),
      );
    }
    if (status !== 'solved') failed++;
    rows.push({ seed: v.seed, world: v.hash.slice(0, 12), logical: key.slice(0, 12), status, errors });
  }
  // The instances' coverage (a catalogue: logical dimensions only, presentation is not enumerated, D27), then what
  // `--draws` seeds pick (default 1000): every dimension the mode varies, as players meet them.
  const cov = coverage(c!, mode.id, set.variants, { logicalOnly: set.exhaustive });
  const drawn = coverage(c!, mode.id, seedDraws(game, mode.id, draws));
  const ok = rows.filter((r) => r.status === 'solved').length;
  const what = set.exhaustive
    ? `catalogue: ${rows.length} instance(s), every one checked`
    : `generator: a sample of ${rows.length} seed(s) checked (not every seed)`;
  console.log(
    `${ok === rows.length ? '✔' : '✗'}  [${GAME}] mode ${mode.id} (${mode.strategy}) — ${what}; ${ok}/${rows.length} ${prove ? 'proved (no softlock)' : 'solved (a witness to the ending, and to every objective and Remix goal)'}`,
  );
  for (const r of rows.filter((x) => x.status !== 'solved'))
    console.log(`   ✗ ${r.seed} (world ${r.world}): ${r.status}`);
  for (const [dim, counts] of Object.entries(cov.perDimension))
    console.log(
      `   ${dim}: ${Object.entries(counts)
        .map(([v, n]) => `${v}=${n}`)
        .join(', ')}`,
    );
  for (const n of [...cov.neverChosen, ...drawn.neverChosen])
    console.log(`   ⚠ never chosen: ${n.dimension} = ${n.value}`);
  for (const d of drawn.dominant)
    console.log(`   ⚠ dominant over ${draws} seeds: ${d.dimension} = ${d.value} (${Math.round(d.share * 100)}%)`);
  if (mode.dimensions.length)
    console.log(
      `   ${draws} seeds drew: ${Object.entries(drawn.perDimension)
        .map(
          ([d, k]) =>
            `${d} {${Object.entries(k)
              .map(([v, n]) => `${v}: ${n}`)
              .join(', ')}}`,
        )
        .join('; ')}`,
    );
  (report.modes as unknown[]).push({
    id: mode.id,
    strategy: mode.strategy,
    exhaustive: set.exhaustive,
    instances: rows,
    coverage: cov,
    draws: drawn,
  });
}
console.log(`   certificates: ${certDir} (${proved.size} logical world(s))`);
const out = arg('out');
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`   report: ${out}`);
}
await flushExit(failed ? 1 : 0);
