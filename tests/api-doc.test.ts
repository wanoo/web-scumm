// docs/en/API.md and docs/fr/API.md carry the public API's signatures, generated from the sources (4.1.7,
// tools/api-doc.ts): a page behind the code fails here, and `npx tsx tools/api-doc.ts` brings it up to date.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { signatures, withBlock } from '../tools/api-doc';

describe('the API pages carry the signatures of the code', () => {
  const block = signatures();
  it('names every entry and more than a hundred exports', () => {
    for (const e of ['content', 'player', 'minigames', 'testing', 'reality'])
      expect(block).toContain(`### web-scumm/${e}`);
    expect(block.split('\n').filter((l) => l.startsWith('| `')).length).toBeGreaterThan(100);
  });
  for (const p of ['docs/en/API.md', 'docs/fr/API.md'])
    it(`${p} is up to date (npx tsx tools/api-doc.ts)`, () => {
      const page = readFileSync(p, 'utf8');
      expect(withBlock(page, block)).toBe(page);
    });
});
