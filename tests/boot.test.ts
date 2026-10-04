import { describe, expect, it } from 'vitest';
import { openStore, pickLanguage, waitFonts } from '@engine/boot';
import type { App } from '@engine/dom/app';
import { MemoryStore } from '@engine/core/ports';
import { mini } from './fixtures/mini';

describe('bootGame helpers', () => {
  it('picks the language: query, then the saved choice, then the browser when the game ships it', () => {
    const g = mini();
    const locales = { fr: {}, de: {} };
    expect(pickLanguage(g, locales, { query: 'fr', stored: 'de', navigatorLang: 'de-DE' })).toBe('fr');
    expect(pickLanguage(g, locales, { stored: 'de', navigatorLang: 'fr-FR' })).toBe('de');
    expect(pickLanguage(g, locales, { navigatorLang: 'fr-CA' })).toBe('fr');
    expect(pickLanguage(g, locales, { navigatorLang: 'it-IT' })).toBeUndefined();
    expect(pickLanguage(g, undefined, { navigatorLang: 'fr' })).toBeUndefined();
  });

  it('waits for the fonts and never fails on them', async () => {
    const g = mini();
    const asked: string[] = [];
    await waitFonts(g, { load: async (s) => { asked.push(s); } });
    expect(asked).toHaveLength(2);
    await expect(waitFonts(g, { load: async () => { throw new Error('no font'); } })).resolves.toBeUndefined();
    await expect(waitFonts(g, undefined)).resolves.toBeUndefined();
  });

  it('keeps the store\'s early errors and warnings until the App exists, then forwards them', async () => {
    const g = mini();
    const seen: string[] = [];
    const fake = { reportStorageError: (e: Error) => seen.push(`error:${e.message}`), reportSaveWarning: (m: string) => seen.push(`warn:${m}`) } as unknown as App;
    let fail!: (e: Error) => void, warn!: (m: string) => void;
    const opened = await openStore(g, async (_game, f, w) => { fail = f; warn = w; return new MemoryStore(); });
    expect(opened.store).toBeInstanceOf(MemoryStore);
    fail(new Error('early')); warn('soon');
    expect(seen).toEqual([]);
    opened.attach(fake);
    expect(seen).toEqual(['error:early', 'warn:soon']);
    fail(new Error('late'));
    expect(seen).toEqual(['error:early', 'warn:soon', 'error:late']);
  });

  it('falls back to no store when the opener throws', async () => {
    const opened = await openStore(mini(), async () => { throw new Error('no IndexedDB'); });
    expect(opened.store).toBeUndefined();
    opened.attach({ reportStorageError() {}, reportSaveWarning() {} } as unknown as App);
  });
});
