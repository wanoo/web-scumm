// Runs tests/fixtures/connectors/no-eval-run.ts under `node --disallow-code-generation-from-strings` (4.1.9,
// tests/connectors-abuse.test.ts): the connectors' sources through tsx, which itself generates no code from strings.
import { tsImport } from 'tsx/esm/api';

await tsImport('./no-eval-run.ts', import.meta.url);
