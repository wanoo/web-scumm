// Stable ids on the lines of lists (looks, hints, fallback answers) and on reactions by kind (`ListLine`, schema 3):
// assigned by `assignIds`, written by the codemod, used by translations (insertion-proof) and voice clips, required in
// a translated or voiced release.
import { describe, expect, it } from 'vitest';
import type { GameDef, ListLine } from '@engine/core/types';
import { assignIds, lineIds, renamePaths } from '@engine/core/content-ids';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { listText } from '@engine/core/list-lines';
import { applyLocale, textPaths } from '@engine/tools/i18n';
import { validate } from '@engine/tools/validate';
import { addIdsToItemsSource, addIdsToRoomSource, addIdsToRulesSource } from '../tools/ids/codemod';
import { mini, miniLayouts } from './fixtures/mini';

const lists = (): GameDef => {
  const g = mini();
  g.items.cle.look = ['A key.', 'Still a key.'];
  g.rooms[0].look = { valise: ['A suitcase.', 'Heavy.'], uncle: 'Uncle.' };
  g.rooms[0].hints = [{ until: 'never', lines: ['Try the key.', 'The key, really.'] }];
  g.rules.fallbacks.look = ['Nothing.', 'Nothing at all.'];
  g.rules.kinds = [{ verb: 'use', target: 'valise', say: 'Not like that.' }];
  return g;
};
const pathsOf = (g: GameDef) => textPaths(g).map((p) => p.path);

describe('list lines with ids', () => {
  it('assignIds names every list line, hint and kind (lines: all), and the table follows', () => {
    const g = lists();
    const before = Object.fromEntries(textPaths(g).map((p) => [p.path, `FR ${p.text}`]));
    const { game: v3, map } = assignIds(g, { lines: 'all' });
    expect(v3.rooms[0].look!.valise).toEqual([
      { id: 'a.look-valise.l-a-suitcase', text: 'A suitcase.' },
      { id: 'a.look-valise.l-heavy', text: 'Heavy.' },
    ]);
    expect(v3.rooms[0].look!.uncle).toBe('Uncle.'); // a single line is keyed by its owner already
    expect(v3.rooms[0].hints![0].id).toBe('a.hint');
    expect(v3.items.cle.look).toEqual([
      { id: 'item.cle.l-a-key', text: 'A key.' },
      { id: 'item.cle.l-still-a-key', text: 'Still a key.' },
    ]);
    expect((v3.rules.fallbacks.look as ListLine[]).map((l) => (typeof l === 'string' ? l : l.id))).toEqual([
      'fallback.look.l-nothing',
      'fallback.look.l-nothing-at-all',
    ]);
    expect(v3.rules.kinds![0].id).toBe('kind.use-valise');
    expect(pathsOf(v3)).toEqual(
      expect.arrayContaining([
        'room:a/look.valise.a.look-valise.l-a-suitcase',
        'room:a/hints.a.hint.lines.a.hint.l-try-the-key',
        'item:cle/look.item.cle.l-a-key',
        'rules/fallbacks.look.fallback.look.l-nothing',
        'rules/kinds.kind.use-valise.say',
      ]),
    );
    // every translation follows: nothing lost, nothing left at a positional path
    const renamed = renamePaths(before, map.paths);
    expect(Object.keys(renamed).sort()).toEqual(pathsOf(v3).sort());
    const fr = applyLocale(v3, renamed);
    expect((fr.rooms[0].look!.valise as ListLine[]).map(listText)).toEqual(['FR A suitcase.', 'FR Heavy.']);
    expect((fr.rooms[0].look!.valise as ListLine[])[0]).toMatchObject({ id: 'a.look-valise.l-a-suitcase' });
    expect(fr.rules.kinds![0].say).toBe('FR Not like that.');
    // and a second pass assigns nothing
    expect(assignIds(v3, { lines: 'all' }).added).toBe(0);
  });

  it("an insertion in a list never shifts the other lines' translations", () => {
    const { game: v3 } = assignIds(lists(), { lines: 'all' });
    const table = Object.fromEntries(textPaths(v3).map((p) => [p.path, `FR ${p.text}`]));
    (v3.rooms[0].look!.valise as ListLine[]).unshift('A new first line.');
    v3.rooms[0].hints!.unshift({ until: 'never', lines: ['A new first hint.'] });
    const fr = applyLocale(v3, table);
    expect((fr.rooms[0].look!.valise as ListLine[]).map(listText)).toEqual([
      'A new first line.',
      'FR A suitcase.',
      'FR Heavy.',
    ]);
    expect(fr.rooms[0].hints![1].lines.map(listText)).toEqual(['FR Try the key.', 'FR The key, really.']);
  });

  it('the engine speaks both shapes, and voices a line by its id', async () => {
    const { game: v3 } = assignIds(lists(), { lines: 'all' });
    v3.audio = { voices: { 'a.look-valise.l-a-suitcase': 'suitcase.mp3', 'kind.use-valise': 'kind.mp3' } };
    v3.rooms[0].on = [];
    const ui = new FakePresenter();
    const e = new Engine(v3, miniLayouts, ui, new MemoryStore());
    await e.newGame();
    await e.act({ verb: 'look', a: 'valise' });
    await e.act({ verb: 'look', a: 'valise' });
    await e.act({ verb: 'use', a: 'cle', b: 'valise' });
    expect(ui.log.filter((l) => l.startsWith('hero:')).slice(-3)).toEqual([
      'hero: A suitcase.',
      'hero: Heavy.',
      'hero: Not like that.',
    ]);
    expect(ui.voices).toEqual(['a.look-valise.l-a-suitcase', 'kind.use-valise']);
    expect(lineIds(v3).map((l) => l.id)).toEqual(
      expect.arrayContaining([
        'a.look-valise.l-a-suitcase',
        'a.hint.l-try-the-key',
        'kind.use-valise',
        'item.cle.l-a-key',
      ]),
    );
  });

  it('a translated or voiced release requires them; a plain release only warns', () => {
    const g = lists();
    const strict = validate(g, miniLayouts, { release: true, translated: true });
    expect(strict.errors.filter((e) => e.includes('no stable id')).length).toBeGreaterThanOrEqual(8);
    expect(
      validate(g, miniLayouts, { release: true }).warnings.some(
        (w) => w.includes('look.valise[0]') && w.includes('no stable id'),
      ),
    ).toBe(true);
    const { game: v3 } = assignIds(g, { lines: 'all' });
    expect(
      validate(v3, miniLayouts, { release: true, translated: true }).errors.filter((e) => e.includes('no stable id')),
    ).toEqual([]);
    (v3.rooms[0].look!.valise as ListLine[]).push({ id: 'item.cle.l-a-key', text: 'Duplicate.' });
    expect(validate(v3, miniLayouts).errors.some((e) => e.includes('line id "item.cle.l-a-key" is already used'))).toBe(
      true,
    );
  });

  it('the codemod writes them into the sources', () => {
    const { game: v3 } = assignIds(lists(), { lines: 'all' });
    const room = addIdsToRoomSource(
      `defineRoom({\n  id: 'a',\n  look: { valise: ['A suitcase.', 'Heavy.'], uncle: 'Uncle.' },\n  hints: [{ until: 'never', lines: ['Try the key.', 'The key, really.'] }],\n});\n`,
      v3.rooms[0],
    );
    expect(room.code).toContain(
      `valise: [{ id: 'a.look-valise.l-a-suitcase', text: 'A suitcase.' }, { id: 'a.look-valise.l-heavy', text: 'Heavy.' }], uncle: 'Uncle.'`,
    );
    expect(room.code).toContain(
      `hints: [{ id: 'a.hint', until: 'never', lines: [{ id: 'a.hint.l-try-the-key', text: 'Try the key.' }`,
    );
    const rules = addIdsToRulesSource(
      `export const rules = {\n  fallbacks: { look: ['Nothing.', 'Nothing at all.'] },\n  kinds: [{ verb: 'use', target: 'valise', say: 'Not like that.' }],\n};\n`,
      v3.rules,
    );
    expect(rules.code).toContain(`look: [{ id: 'fallback.look.l-nothing', text: 'Nothing.' }`);
    expect(rules.code).toContain(`kinds: [{ id: 'kind.use-valise', verb: 'use'`);
    const items = addIdsToItemsSource(
      `export const items = {\n  cle: { name: 'key', look: ['A key.', 'Still a key.'] },\n};\n`,
      v3.items,
    );
    expect(items.code).toContain(
      `look: [{ id: 'item.cle.l-a-key', text: 'A key.' }, { id: 'item.cle.l-still-a-key', text: 'Still a key.' }]`,
    );
    expect([room, rules, items].flatMap((r) => r.skipped)).toEqual([]);
  });
});
