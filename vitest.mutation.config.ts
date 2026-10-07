// The tests a mutant is judged by (npm run test:mutation:core, 4.1.0 "Clarity"; `MUTATION_SET` since 4.1.2): for the
// core set, conditions, saves, sessions and migrations and the tests that exercise them; for the reality set, the
// signal's protocol, the engine's receive, the client and the Bridge. The rest of the suite is not run per mutant.
import { defineConfig } from 'vitest/config';
import base from './vite.config';
import { setsOf, TESTS, type MutationSet } from './tools/mutation-sets';

// The base's `include` is replaced, not merged (mergeConfig would concatenate the lists). The lists live in
// tools/mutation-sets.ts (4.1.8), with the sources each set mutates.
const set = (process.env.MUTATION_SET ?? 'core') as MutationSet | 'all';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: setsOf(set).flatMap((k) => TESTS[k]),
  },
});
