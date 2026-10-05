// What a build ships (3.7.1): every file of dist/ is the engine's code, a locked asset of the game, a data file it
// names, a font, an icon or a notice; another game's asset or a stray file is refused, a locked file missing too.
import { describe, expect, it } from 'vitest';
import { assetsManifest, inventory, manifestMatches, NOTICES, strayAssets } from '../src/engine/tools/inventory';
import type { ProvenanceLock } from '../src/engine/tools/provenance';

const lock: ProvenanceLock = { version: 1, assets: {
  'img:hall/bg': { sha256: 'a1', bytes: 10, match: 'img:*', licence: 'CC BY 4.0', status: 'final' },
  'music:theme.mp3': { sha256: 'b2', bytes: 20, match: 'music:theme.mp3', licence: 'CC BY 4.0', status: 'final' },
} };
const f = (sha256 = 'x') => ({ sha256 });
const build = (extra: Record<string, { sha256: string }> = {}) => ({
  'index.html': f(), 'sw.js': f(), 'workbox-a85f4708.js': f(), 'manifest.webmanifest': f(), 'og.png': f(), 'icons/icon-192.png': f(), 'icons/icon-512.png': f(),
  'assets/index-C1jekjDv.js': f(), 'assets/index-DtuRcgmU.css': f(), 'assets/tools/index-DkIPnWO-.js': f(),
  'assets/PressStart2P-2BZhbCiP.ttf': f(), 'fonts/DotGothic16.ttf': f(),
  'assets/img/hall/bg.webp': f('a1'), 'assets/audio/music/theme.mp3': f('b2'), 'data/dossier.bin': f(),
  ...Object.fromEntries(NOTICES.map((n) => [n, f()])),
  ...extra,
});

describe('the files of a build', () => {
  it('a build of this game alone, with its notices, is accounted for', () => {
    const r = inventory({ files: build(), lock, data: ['data/dossier.bin'] });
    expect(r).toMatchObject({ extra: [], missing: [], changed: [] });
    expect(r.kinds).toEqual({ code: 7, asset: 2, data: 1, font: 2, shell: 3, licence: 5 });
  });

  it('another game\'s score, a stray file or a data file the game does not name: refused', () => {
    const r = inventory({ files: build({ 'assets/audio/music/night_market.mp3': f(), 'notes.txt': f() }), lock, data: [] });
    expect(r.extra).toEqual(['assets/audio/music/night_market.mp3', 'data/dossier.bin', 'notes.txt']);
  });

  it('a locked file changed since its review, or missing, and a notice missing', () => {
    const files = build({ 'assets/img/hall/bg.webp': f('other') });
    delete (files as Record<string, unknown>)['assets/audio/music/theme.mp3'];
    delete (files as Record<string, unknown>)['licenses/THIRD_PARTY_NOTICES.txt'];
    const r = inventory({ files, lock, data: ['data/dossier.bin'] });
    expect(r.changed).toEqual(['assets/img/hall/bg.webp']);
    expect(r.missing).toEqual(['assets/audio/music/theme.mp3', 'licenses/THIRD_PARTY_NOTICES.txt']);
  });

  it('a build removes the assets that are not the game\'s, and nothing else', () => {
    expect(strayAssets(['assets/img/hall/bg.webp', 'assets/img/market/bg.webp', 'assets/audio/music/theme.mp3', 'assets/index-C1jekjDv.js'], Object.keys(lock.assets))).toEqual(['assets/img/market/bg.webp']);
  });

  it('the assets manifest says who made each file, and matches the lock', () => {
    const m = assetsManifest(lock, [{ match: 'img:*', author: 'Wano', source: 'drawn' }]);
    expect(m[0]).toEqual({ key: 'img:hall/bg', path: 'assets/img/hall/bg.webp', sha256: 'a1', bytes: 10, licence: 'CC BY 4.0', status: 'final', author: 'Wano', source: 'drawn' });
    expect(manifestMatches(m, lock)).toBe(true);
    expect(manifestMatches(m.slice(1), lock)).toBe(false);
  });
});
