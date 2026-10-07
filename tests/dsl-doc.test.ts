// docs/en/DSL.md and docs/fr/DSL.md carry the DSL's reference generated from its schemas (4.1.12, tools/dsl-doc.ts):
// every condition kind, every command key with its shape, the objectives' fields, the fields' classes. A page behind
// the schemas fails here; `npx tsx tools/dsl-doc.ts` brings it up to date.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CMD_KEYS } from '@engine/core/cmds';
import { objectiveSchema } from '@engine/core/ir-schema';
import { COND_KINDS } from '../src/studio/schema';
import { COND_DOCS } from '../tools/dsl-meta';
import { dslBlock, shapeOf, withDslBlock } from '../tools/dsl-doc';

describe('the generated DSL reference', () => {
  for (const lang of ['en', 'fr'] as const) {
    const block = dslBlock(lang);
    it(`${lang}: every command, every condition, every objective field`, () => {
      for (const k of CMD_KEYS) expect(block, k).toContain(`| \`${k}\` | \`{ ${k}: `);
      for (const k of COND_KINDS) expect(block, k).toContain(`| \`${COND_DOCS[k].shape}\` |`);
      for (const k of Object.keys(objectiveSchema.shape)) expect(block, k).toContain(`| \`${k}\` |`);
      expect(block).toContain('`objectives`');
    });
    it(`docs/${lang}/DSL.md is up to date (npx tsx tools/dsl-doc.ts)`, () => {
      const page = readFileSync(`docs/${lang}/DSL.md`, 'utf8');
      expect(withDslBlock(page, block)).toBe(page);
    });
  }

  it('writes a shape as the content writes it', () => {
    expect(
      shapeOf({
        k: 'tuple',
        items: [
          { k: 'id', ref: 'item' },
          { k: 'id', ref: 'char' },
        ],
        labels: ['item', 'to'],
      }),
    ).toBe('[item, to]');
    expect(shapeOf({ k: 'object', fields: { a: { k: 'text' }, b: { k: 'cond', optional: true } } })).toBe(
      '{ a: text, b?: cond }',
    );
    expect(shapeOf({ k: 'list', of: { k: 'cmds' } })).toBe('[[cmd, …], …]');
  });

  it('the two languages say the same rows', () => {
    const rows = (b: string) => b.split('\n').filter((l) => l.startsWith('| `')).length;
    expect(rows(dslBlock('fr'))).toBe(rows(dslBlock('en')));
  });
});
