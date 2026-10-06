// The tests a mutant of the critical core is judged by (npm run test:mutation:core, 4.1.0 "Clarity"): conditions,
// saves, sessions and migrations, and the tests that exercise them. The rest of the suite is not run per mutant.
import { defineConfig } from 'vitest/config';
import base from './vite.config';

// The base's `include` is replaced, not merged (mergeConfig would concatenate the lists).
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
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
    ],
  },
});
