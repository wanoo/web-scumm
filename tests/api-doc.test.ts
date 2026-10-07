// docs/en/API.md and docs/fr/API.md carry the public API's signatures, generated from the sources (4.1.7,
// tools/api-doc.ts): a page behind the code fails here, and `npx tsx tools/api-doc.ts` brings it up to date. Since
// 4.1.8 every export also declares its stability (`@public` or `@extension`) and says what it is: a bare export fails.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiRows, signatures, withBlock } from '../tools/api-doc';

describe('the API pages carry the signatures of the code', () => {
  const rows = apiRows();
  const block = signatures(rows);
  it('names every entry and more than a hundred exports', () => {
    for (const e of ['content', 'player', 'minigames', 'testing', 'reality'])
      expect(block).toContain(`### web-scumm/${e}`);
    expect(rows.length).toBeGreaterThan(100);
    expect(block.split('\n').filter((l) => l.startsWith('| `')).length).toBe(rows.length);
  });
  it('every export says what it is (a first doc sentence on its declaration)', () => {
    const bare = rows.filter((r) => !r.doc).map((r) => `${r.entry}: ${r.name}`);
    expect(bare).toEqual([]);
  });
  it('every export declares its stability, @public or @extension (tools/api-doc.ts says which is which)', () => {
    const untagged = rows.filter((r) => r.stability !== 'public' && r.stability !== 'extension');
    expect(untagged.map((r) => `${r.entry}: ${r.name}`)).toEqual([]);
    // Both kinds exist: a contract a host implements is not the same promise as a name it calls.
    expect(rows.some((r) => r.stability === 'extension')).toBe(true);
    expect(rows.filter((r) => r.stability === 'public').length).toBeGreaterThan(rows.length / 2);
  });
  it('a type alias is printed as what it stands for, not as the members of a string or an array', () => {
    const sig = (name: string) => rows.find((r) => r.name === name)?.signature;
    expect(sig('Id')).toBe('type Id = string');
    expect(sig('Point')).toBe('type Point = [number, number]');
    expect(sig('Keyring')).toBe('type Keyring = BridgeKey[]');
    expect(sig('TransitionKind')).toBe("type TransitionKind = 'cut' | 'fade' | 'wipe'");
    // A side too wide to read is summarised, and an interface shows its first members.
    expect(sig('Cmd')).toMatch(/^type Cmd = union of \d+$/);
    expect(sig('RoomDef')).toMatch(/^interface \{ id, name, decor, /);
  });
  for (const p of ['docs/en/API.md', 'docs/fr/API.md'])
    it(`${p} is up to date (npx tsx tools/api-doc.ts)`, () => {
      const page = readFileSync(p, 'utf8');
      expect(withBlock(page, block)).toBe(page);
    });
});
