// The mutation sets (4.1.8): which sources a set mutates, and which tests judge its mutants. One place, read by
// `tools/mutate.ts` (the mutants, the report, the input hash) and by `vitest.mutation.config.ts` (the tests that run
// against each mutant), so the two cannot drift apart.
export const SETS = {
  core: [
    'src/engine/core/cond.ts',
    'src/engine/core/save.ts',
    'src/engine/core/session-runtime.ts',
    'src/engine/core/migrate.ts',
  ],
  reality: [
    'src/engine/core/reality-runtime.ts',
    'src/engine/reality/protocol.ts',
    'src/engine/reality/client.ts',
    'src/engine/reality/http-port.ts',
    'bridge/src/bridge.ts',
    'bridge/src/store.ts',
    'bridge/src/lock.ts',
    'bridge/src/policy.ts',
  ],
  // The connectors' pure parts (4.1.9): a set of its own, so the Reality set does not double in time; run with
  // `--set=connectors`, not in `all` (not gated) until its survivors are measured and named (plan 4.1.9 §7).
  connectors: [
    'connectors/src/sdk.ts',
    'connectors/src/email/mime.ts',
    'connectors/src/terminal/line.ts',
    'connectors/src/terminal/vfs.ts',
    'connectors/src/badges/crypto.ts',
    'connectors/src/badges/fetch.ts',
  ],
  // Remix and Time Attack's contracts (4.1.16, plan §10): a world's seed and its normalisation, its hash, compilation
  // and application, its constraints, a category's world and its leaderboard key, the Daily and Mystery tokens.
  remix: [
    'src/engine/core/remix/seed-code.ts',
    'src/engine/core/remix/compile.ts',
    'src/engine/core/remix/apply.ts',
    'src/engine/core/remix/categories.ts',
    'src/engine/reality/daily.ts',
  ],
  // A run's envelope and `h0`, the recorder and its resume, the verifier (4.1.16).
  speedrun: [
    'src/engine/tools/speedrun/envelope.ts',
    'src/engine/tools/speedrun/recorder.ts',
    'src/engine/tools/speedrun/verify.ts',
  ],
  // The speedrun queue (4.1.17, plan §7): admission, quota, leaderboard ranking. Gated from the start: the bugs 4.1.17
  // fixed there (a board cut before ranking, a count then a write, a quota per process) were in no set.
  runs: ['bridge/src/runs.ts', 'bridge/src/runs-store.ts', 'bridge/src/runs-limiter.ts'],
  // The Bridge's stores and its fan-out (4.1.10, ADR 0009): measured, not gated yet. The `reality` set would double
  // with them (docs/dev/plans/4.1.10-constellation.md §6); its survivors are read and named or killed before the set
  // joins `GATED`.
  'reality-store': [
    'bridge/src/store-memory.ts',
    'bridge/src/store-sql.ts',
    'bridge/src/store-sqlite.ts',
    'bridge/src/migrations.ts',
    'bridge/src/streams.ts',
    'bridge/src/sign.ts',
  ],
};
export type MutationSet = keyof typeof SETS;
/** The tests a set's mutants are judged by (vitest `include` globs). */
export const TESTS: Record<MutationSet, string[]> = {
  core: [
    'tests/core.test.ts',
    'tests/core-runtime.test.ts',
    'tests/save-v3.test.ts',
    'tests/save-store.test.ts',
    'tests/stable-ids.test.ts',
    'tests/content-ids.test.ts',
    'tests/replay.test.ts',
    'tests/properties.test.ts',
    'tests/cmds.test.ts',
    'tests/critical-*.test.ts',
    'tests/engine-honesty.test.ts',
    'tests/scheduler.test.ts',
  ],
  reality: ['tests/reality-*.test.ts', 'tests/bridge*.test.ts'],
  // Short unit tests only: the load tools and the Postgres races are integration tests, never under each mutant.
  runs: [
    'tests/bridge-runs.test.ts',
    'tests/bridge-runs-queue.test.ts',
    'tests/bridge-runs-worker.test.ts',
    'tests/bridge-runs-http.test.ts',
    'tests/bridge-runs-store.test.ts',
    'tests/bridge-runs-durable.test.ts',
    'tests/bridge-leaderboard.test.ts',
    'tests/bridge-admission.test.ts',
  ],
  connectors: ['tests/connectors-*.test.ts'],
  'reality-store': ['tests/bridge-reality-store.test.ts', 'tests/bridge-fanout.test.ts', 'tests/bridge.test.ts'],
  remix: [
    'tests/remix-*.test.ts',
    'tests/speedrun-remix.test.ts',
    'tests/speedrun-daily.test.ts',
    'tests/code-wheel.test.ts',
  ],
  speedrun: ['tests/speedrun-*.test.ts', 'tests/critical-minigame-outcome.test.ts'],
};

/** The sets `all` runs and the gate judges; `connectors` and `reality-store` run on their own until they are gated. */
// `remix` and `speedrun` (4.1.16) are measured, not gated yet: their first runs left survivors to read one by one
// (docs/dev/passes/4.1.16.md); each is killed or named in docs/dev/mutants.json before the two join here, for 4.2.
export const GATED: MutationSet[] = ['core', 'reality', 'runs'];

export const setsOf = (set: MutationSet | 'all'): MutationSet[] => (set === 'all' ? GATED : [set]);
