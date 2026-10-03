// Translation tables survive refactors: a reordered list keeps its translations, a removed text is parked, a text that
// comes back finds its translation again (mergeLocale, used by `npm run i18n -- extract --lang xx`).
import { describe, expect, it } from 'vitest';
import { localeStatus, mergeLocale, textPaths } from '@engine/tools/i18n';
import { mini } from './fixtures/mini';

describe('mergeLocale', () => {
  it('follows texts that moved, parks the ones that disappeared, revives the ones that come back', () => {
    const g = mini();
    g.rooms[0].look = { valise: ['Une valise.', 'Toujours une valise.'], uncle: 'Tonton.' };
    const paths0 = textPaths(g);
    const base0 = Object.fromEntries(paths0.map((p) => [p.path, p.text]));
    const fr = mergeLocale(paths0, {}, {});
    expect(fr.added).toBe(paths0.length);
    // translate two of them
    const table = { ...fr.table, 'room:a/look.valise[0]': 'A suitcase.', 'room:a/look.valise[1]': 'Still a suitcase.', 'room:a/look.uncle': 'Uncle.' };
    // reorder the list, drop the uncle's line
    g.rooms[0].look = { valise: ['Toujours une valise.', 'Une valise.'] };
    const m = mergeLocale(textPaths(g), table, base0);
    expect(m.table['room:a/look.valise[0]']).toBe('Still a suitcase.');
    expect(m.table['room:a/look.valise[1]']).toBe('A suitcase.');
    expect(m.remapped).toBe(2);
    expect(m.stale).toEqual(['room:a/look.uncle']);
    expect(m.table['_stale:room:a/look.uncle']).toBe('Uncle.');
    expect(localeStatus(g, m.table).stale).toEqual(['_stale:room:a/look.uncle']);
    // the line comes back: its translation too
    g.rooms[0].look.uncle = 'Tonton.';
    const m2 = mergeLocale(textPaths(g), m.table, base0);
    expect(m2.table['room:a/look.uncle']).toBe('Uncle.');
    expect(m2.revived).toBe(1);
    expect(Object.keys(m2.table).some((k) => k.startsWith('_stale:'))).toBe(false);
  });

  it('never maps an untranslated entry onto a new path', () => {
    const g = mini();
    g.rooms[0].look = { valise: ['Une valise.'] };
    const base0 = Object.fromEntries(textPaths(g).map((p) => [p.path, p.text]));
    const table = Object.fromEntries(textPaths(g).map((p) => [p.path, p.text])); // nothing translated yet
    g.rooms[0].look = { cadenas: ['Une valise.'] };
    const m = mergeLocale(textPaths(g), table, base0);
    expect(m.remapped).toBe(0);
    expect(m.table['room:a/look.cadenas[0]']).toBe('Une valise.');
  });
});
