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
/** The sets `--set=all` runs and fails on (the nightly, release-check): `reality-store` is not among them yet. */
export const GATED: MutationSet[] = ['core', 'reality'];

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
  'reality-store': ['tests/bridge-reality-store.test.ts', 'tests/bridge-fanout.test.ts', 'tests/bridge.test.ts'],
};

export const setsOf = (set: MutationSet | 'all'): MutationSet[] => (set === 'all' ? GATED : [set]);
