// The Assets tab's model (4.1.8, src/studio/assets-model.ts): the pure functions over a listing, run bare (no DOM):
// the tree's badges, the cell filters, the short uses, the preview URLs, the summary, the tree's groups and their order.
import { describe, expect, it } from 'vitest';
import type { AssetCell, AssetDecor, AssetSheet, AssetSound, AssetsListing, GameInfo } from '../../src/studio/api';
import {
  assetUrl,
  badges,
  cellState,
  fenced,
  keep,
  plural,
  sameSel,
  shortUse,
  summaryText,
  treeGroups,
  unprepared,
} from '../../src/studio/assets-model';

const cell = (id: string, o: Partial<AssetCell> = {}): AssetCell => ({
  id,
  file: `art/hero/${id}.png`,
  w: 256,
  h: 256,
  used: [],
  ids: [],
  prepared: false,
  backups: [],
  mtime: 7,
  ...o,
});
const sheet = (id: string, o: Partial<AssetSheet> = {}): AssetSheet => ({
  id,
  kind: 'sprites',
  grid: '2x1',
  cells: [],
  ...o,
});
const sound = (id: string, o: Partial<AssetSound> = {}): AssetSound => ({
  id,
  kind: 'sfx',
  file: `audio/sfx/${id}`,
  used: [],
  prepared: false,
  backups: [],
  mtime: 1,
  ...o,
});
const decor = (name: string, o: Partial<AssetDecor> = {}): AssetDecor => ({
  ...cell(name, { file: `art/${name}.png` }),
  name: `decor/${name}`,
  rooms: [],
  ...o,
});
const listing = (o: Partial<AssetsListing> = {}): AssetsListing => ({
  sheets: [],
  decors: [],
  sounds: { music: [], sfx: [] },
  missing: [],
  unprepared: 0,
  prompts: { sheets: [], style: '' },
  ...o,
});

const used = cell('r1c1', { used: ['cast.hero.walk'], prepared: true });
const unprep = cell('r1c2', { used: ['cast.hero.idle'] });
const unused = cell('r1c3');
const missing = cell('r1c4', { file: '', used: ['cast.hero.jump'], missing: true });

describe('badges and filters', () => {
  it('counts the missing, the not prepared and the unused cells, in that order, and leaves the used ones out', () => {
    expect(badges([used, unprep, unused, missing])).toEqual([
      ['miss', 1, '1 missing'],
      ['unprep', 1, '1 not prepared'],
      ['unused', 1, '1 unused'],
    ]);
    // A sound has no `missing`: it is counted unused or not prepared only.
    expect(badges([sound('a.ogg'), sound('b.ogg', { used: ['audio.sfx.b'] })])).toEqual([
      ['miss', 0, '0 missing'],
      ['unprep', 1, '1 not prepared'],
      ['unused', 1, '1 unused'],
    ]);
  });

  it('a missing cell is neither used nor unused, and only "all" keeps every cell', () => {
    const all = [used, unprep, unused, missing];
    expect(all.filter((c) => keep(c, 'all')).map((c) => c.id)).toEqual(['r1c1', 'r1c2', 'r1c3', 'r1c4']);
    expect(all.filter((c) => keep(c, 'used')).map((c) => c.id)).toEqual(['r1c1', 'r1c2']);
    expect(all.filter((c) => keep(c, 'unused')).map((c) => c.id)).toEqual(['r1c3']);
    expect(all.filter((c) => keep(c, 'missing')).map((c) => c.id)).toEqual(['r1c4']);
  });

  it('names a cell state missing, unused, unprep or used; a missing cell is never "not prepared"', () => {
    expect([used, unprep, unused, missing].map(cellState)).toEqual(['used', 'unprep', 'unused', 'missing']);
    expect(unprepared(missing)).toBe(false);
    expect(unprepared(unprep)).toBe(true);
  });
});

describe('texts', () => {
  it('drops the sheet character prefix of a use, and only that one', () => {
    const s = sheet('hero', { character: 'hero' });
    expect(shortUse('cast.hero.walk', s)).toBe('walk');
    expect(shortUse('cast.grandpa.walk', s)).toBe('cast.grandpa.walk');
    expect(shortUse('cast.hero.walk', sheet('items'))).toBe('cast.hero.walk');
  });

  it('takes the fenced text of a prompt section, else the whole section, and pluralises', () => {
    expect(fenced('Intro\n```text\nA hero, 6 x 4\n```\nOutro')).toBe('A hero, 6 x 4');
    expect(fenced('no fence here')).toBe('no fence here');
    expect([plural(1, 'cell'), plural(0, 'cell'), plural(3, 'sheet')]).toEqual(['1 cell', '0 cells', '3 sheets']);
  });

  it('sums up the listing: sheets, images without the missing ones, backgrounds, sounds, then the missing count', () => {
    const d = listing({
      sheets: [sheet('hero', { cells: [used, missing] })],
      decors: [decor('yard')],
      sounds: { music: [sound('a.ogg', { kind: 'music' })], sfx: [sound('b.ogg'), sound('c.ogg')] },
      missing: ['hero/r1c4'],
    });
    expect(summaryText(d)).toBe('1 sheet · 1 image · 1 background · 3 sounds · 1 missing');
    expect(summaryText(listing())).toBe('0 sheets · 0 images · 0 backgrounds · 0 sounds');
  });
});

describe('selection and URLs', () => {
  it('two selections are the same when they name the same sheet, decor or sound kind', () => {
    expect(sameSel({ type: 'sheet', id: 'hero' }, { type: 'sheet', id: 'hero' })).toBe(true);
    expect(sameSel({ type: 'sheet', id: 'hero' }, { type: 'decor', id: 'hero' })).toBe(false);
    expect(sameSel({ type: 'sounds', kind: 'sfx' }, { type: 'sounds', kind: 'sfx' })).toBe(true);
    expect(sameSel({ type: 'sounds', kind: 'sfx' }, { type: 'sounds', kind: 'music' })).toBe(false);
    expect(sameSel(null, { type: 'sheet', id: 'hero' })).toBe(false);
  });

  it('serves the source file through the dev server with its mtime, or the prepared copy in the demo', () => {
    const c = cell('r1c1', { file: 'art/hero sheet/r1c1.png', mtime: 42, asset: 'img/hero/r1c1.webp' });
    expect(assetUrl(c, false, '/')).toBe('/__studio/api/assets/file/art/hero%20sheet/r1c1.png?v=42');
    expect(assetUrl(c, true, '/web-scumm/')).toBe('/web-scumm/assets/img/hero/r1c1.webp');
    expect(assetUrl({ file: '', mtime: 0 }, false, '/')).toBeNull();
    expect(assetUrl({ file: 'art/x.png', mtime: 0 }, true, '/')).toBeNull();
  });
});

describe('the tree', () => {
  const chars: GameInfo['characters'] = {
    hero: { name: 'Zoe', color: '#fff' },
    grandpa: { name: 'Albert', color: '#000' },
  };
  const d = listing({
    sheets: [
      sheet('hero', { character: 'hero', cells: [used, unused] }),
      sheet('hero_poses', { character: 'hero', promptKind: 'poses' }),
      sheet('grandpa', { character: 'grandpa' }),
      sheet('items'),
      sheet('talk_hero', { kind: 'talk', character: 'hero' }),
      sheet('furniture', { kind: 'furniture' }),
    ],
    decors: [decor('yard', { rooms: ['yard', 'yard_night'] }), decor('title')],
    sounds: { music: [sound('theme.ogg', { kind: 'music' })], sfx: [] },
  });

  it('groups in a fixed order and sorts the characters by name, then by sheet id', () => {
    const groups = treeGroups(d, chars, {});
    expect(groups.map((g) => g.title)).toEqual([
      'Characters',
      'Objects',
      'Backgrounds',
      'Furniture',
      'Talk kits',
      'Sounds',
    ]);
    expect(groups[0].items.map((it) => it.label)).toEqual(['grandpa', 'hero', 'hero_poses']);
    expect(groups[0].items.map((it) => it.sub)).toEqual(['Albert', 'Zoe', 'Zoe · special poses']);
    expect(groups[1].items.map((it) => it.label)).toEqual(['items']);
    expect(groups[3].items.map((it) => it.label)).toEqual(['furniture']);
    expect(groups[4].items.map((it) => it.sel)).toEqual([{ type: 'sheet', id: 'talk_hero' }]);
  });

  it('a background entry is labelled without decor/, with its rooms, and the Backgrounds group carries the add button', () => {
    const add = { decor: {} as HTMLElement };
    const groups = treeGroups(d, chars, add);
    expect(groups[2].add).toBe(add.decor);
    expect(groups[2].items).toEqual([
      {
        sel: { type: 'decor', id: 'decor/yard' },
        label: 'yard',
        sub: 'yard, yard_night',
        badges: badges([d.decors[0]]),
      },
      { sel: { type: 'decor', id: 'decor/title' }, label: 'title', sub: undefined, badges: badges([d.decors[1]]) },
    ]);
    expect(groups.filter((g) => g.title !== 'Backgrounds').every((g) => g.add === undefined)).toBe(true);
  });

  it('the Sounds group always has Music then Sound effects, with their file counts', () => {
    const sounds = treeGroups(d, chars, {})[5].items;
    expect(sounds.map((it) => [it.label, it.sub])).toEqual([
      ['Music', '1 file'],
      ['Sound effects', '0 files'],
    ]);
    expect(sounds[0].badges).toEqual(badges(d.sounds.music));
  });
});
