import { describe, expect, it } from 'vitest';
import { assetKeys, placeholderVerdict, provenanceReport } from '@engine/tools/provenance';
import { game as demo } from '../games/demo/game';
import demoManifest from '../games/demo/assets.gen.json';
import demoProvenance from '../games/demo/provenance.json';
import type { Provenance } from '@engine/tools/provenance';

describe('asset provenance', () => {
  const manifest = { images: { 'hero/r1c1': [1, 1], 'decor/house': [1, 1] } };
  const game = { ...demo, audio: { sfx: { ding: 'ding.mp3' }, music: { theme: 'theme.mp3' } } } as typeof demo;
  it('lists every image and sound a game ships', () => {
    expect(assetKeys(game, manifest)).toEqual(['img:decor/house', 'img:hero/r1c1', 'music:theme.mp3', 'sfx:ding.mp3']);
  });
  it('reports what no entry covers, incomplete entries and placeholders', () => {
    const r = provenanceReport(game, manifest, { assets: [
      { match: 'img:hero/*', source: 'drawn', licence: 'own work', status: 'final' },
      { match: 'music:*', source: 'bought', licence: 'royalty-free', status: 'placeholder' },
      { match: 'sfx:*', source: '', licence: 'x', status: 'final' },
    ] } as Provenance);
    expect(r.uncovered).toEqual(['img:decor/house']);
    expect(r.placeholders).toEqual(['music:theme.mp3']);
    expect(r.incomplete).toEqual(['sfx:*']);
  });
  it('an asset two entries match is ambiguous, whatever their order', () => {
    const r = provenanceReport(game, manifest, { assets: [
      { match: 'img:*', source: 'a', licence: 'x', status: 'final' },
      { match: 'img:hero/*', source: 'b', licence: 'y', status: 'placeholder' },
      { match: 'music:*', source: 'c', licence: 'z', status: 'final' }, { match: 'sfx:*', source: 'd', licence: 'z', status: 'final' },
    ] } as Provenance);
    expect(r.ambiguous).toEqual(['img:hero/r1c1 (img:*, img:hero/*)']);
    expect(r.placeholders).toEqual([]);
  });
  it('the sample game covers every asset; its only placeholder is the non-commercial music', () => {
    const r = provenanceReport(demo, demoManifest as never, demoProvenance as Provenance);
    expect(r.uncovered).toEqual([]);
    expect(r.incomplete).toEqual([]);
    expect(r.placeholders).toEqual(['music:swan_lake.mp3']);
  });
});

describe('placeholders in a release', () => {
  const r = { keys: 2, uncovered: [], placeholders: ['music:theme.mp3'], incomplete: [], ambiguous: [] };
  it('fail it, unless the file says why they may ship', () => {
    expect(placeholderVerdict({ assets: [] }, r).errors).toHaveLength(1);
    const allowed = { assets: [], releaseExceptions: [{ match: 'music:theme.mp3', reason: 'a demo' }] };
    expect(placeholderVerdict(allowed, r)).toEqual({ errors: [], warnings: [expect.stringContaining('release exception: a demo')] });
    // an exception names its asset: a new placeholder is not covered by an older reason
    expect(placeholderVerdict(allowed, { ...r, placeholders: ['music:theme.mp3', 'img:new'] }).errors).toEqual([expect.stringContaining('img:new')]);
    expect(placeholderVerdict({ assets: [] }, { ...r, placeholders: [] })).toEqual({ errors: [], warnings: [] });
  });
});

