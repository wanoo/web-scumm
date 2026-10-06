// The tests a mutant is judged by (npm run test:mutation:core, 4.1.0 "Clarity"; `MUTATION_SET` since 4.1.2): for the
// core set, conditions, saves, sessions and migrations and the tests that exercise them; for the reality set, the
// signal's protocol, the engine's receive, the client and the Bridge. The rest of the suite is not run per mutant.
import { defineConfig } from 'vitest/config';
import base from './vite.config';

// The base's `include` is replaced, not merged (mergeConfig would concatenate the lists).
const CORE = [
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
];
const REALITY = ['tests/reality-*.test.ts', 'tests/bridge*.test.ts'];
const set = process.env.MUTATION_SET ?? 'core';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: set === 'reality' ? REALITY : set === 'all' ? [...CORE, ...REALITY] : CORE,
  },
});
