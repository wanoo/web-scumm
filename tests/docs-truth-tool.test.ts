// The documentation checked against the code (4.1.16, plan §12, `npm run docs:truth`): the shipped documents agree
// with it, and each contradiction the tool exists for is found in a page that makes it (a save schema of the past,
// a script that does not exist, a tool file that is gone, a capability called mounted that the code does not mount).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { check, documents, facts } from '../tools/docs-truth';

const DIR = 'tests/fixtures/docs-truth-tool-tmp';
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('docs:truth', () => {
  it('the shipped documents agree with the code', () => {
    expect(documents().length).toBeGreaterThan(40);
    expect(check()).toEqual([]);
    expect(facts()).toMatchObject({ saveSchema: 4, wsrunSchema: 2 });
  });
  it('finds a save schema of the past, a missing script, a missing tool file', () => {
    mkdirSync(DIR, { recursive: true });
    const page = `${DIR}/page.md`;
    writeFileSync(
      page,
      [
        'Saves are envelopes `{ format, schema: 3, gameId }`.',
        'Run `npm run no-such-script` first, then `npm run -s mcp`.',
        'See `tools/no-such-tool.ts`.',
      ].join('\n'),
    );
    const found = check([page]).map((c) => `${c.line}: ${c.what}`);
    expect(found).toEqual([
      '1: a save envelope is schema 4, the text says 3',
      "2: `npm run no-such-script`: no such script in package.json nor in a created game's",
      '3: `tools/no-such-tool.ts`: no such file',
    ]);
  });
});
