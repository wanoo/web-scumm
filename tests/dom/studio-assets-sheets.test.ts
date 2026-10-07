// @vitest-environment happy-dom
// The Assets tab's sheets view (4.1.8, src/studio/assets-sheets.ts), rendered against a fake host: the sheet's header
// and filter counts, a cell card's texts and classes and what the host hears on a click, the prompt panel, the side
// panel's facts, and the Replace upload (the file picked, POST assets/cell with its fields, the toast, the reload).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetCell, AssetSheet, AssetsListing, GameInfo } from '../../src/studio/api';
import { cellCard, cellPanel, renderSheet, type SheetsHost, uploadDialog } from '../../src/studio/assets-sheets';

const cell = (id: string, o: Partial<AssetCell> = {}): AssetCell => ({
  id,
  file: `art/hero/${id}.png`,
  w: 256,
  h: 256,
  used: [],
  ids: [`hero/${id}`],
  prepared: false,
  backups: [],
  mtime: 7,
  ...o,
});
const used = cell('r1c1', { used: ['cast.hero.walk', 'cast.hero.run'], prepared: true });
const unprep = cell('r1c2', { used: ['cast.hero.idle'] });
const unused = cell('r1c3', { ids: [] });
const missing = cell('r1c4', { file: '', w: 0, h: 0, used: ['cast.hero.jump'], missing: true });
// Referenced by nothing the game still names, and without a file: the listing may hold such a cell after a rename.
const orphan = cell('r1c5', { file: '', w: 0, h: 0, ids: [], missing: true });
const hero: AssetSheet = {
  id: 'hero',
  kind: 'sprites',
  character: 'hero',
  grid: '2x2',
  cells: [used, unprep, unused, missing],
};

const info = (): GameInfo => ({
  id: 'demo',
  title: 'Demo',
  rooms: [{ id: 'yard', name: 'Yard', decor: 'decor/yard' }],
  characters: { hero: { name: 'Zoe', color: '#fff' } },
  items: {},
  verbs: [],
  checkpoints: {},
  hero: 'hero',
  images: {},
});
const listing = (o: Partial<AssetsListing> = {}): AssetsListing => ({
  sheets: [hero],
  decors: [],
  sounds: { music: [], sfx: [] },
  missing: ['hero/r1c4'],
  unprepared: 1,
  prompts: {
    sheets: [{ id: 'hero', kind: 'character', markdown: '```text\nZoe, 2 x 2\n```', missingMarkdown: 'only r1c4' }],
    style: 'style',
  },
  ...o,
});
function host(o: Partial<SheetsHost> = {}): SheetsHost {
  return {
    demo: false,
    info: info(),
    data: () => listing(),
    listing: () => listing(),
    sel: () => ({ type: 'sheet', id: 'hero' }),
    select: vi.fn(),
    url: (x) => (x.file ? `/f/${x.file}?v=${x.mtime}` : null),
    ownWrite: vi.fn(),
    reload: vi.fn(async () => undefined),
    renderCenter: vi.fn(),
    filter: 'all',
    cell: null,
    setFilter: vi.fn(),
    setCell: vi.fn(),
    ...o,
  };
}
const render = (h: SheetsHost, id = 'hero') => {
  const root = document.createElement('div');
  root.append(...renderSheet(h, id));
  document.body.append(root);
  return root;
};
const texts = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent);

/** Empties the page but keeps the toast stack `toast()` caches (emptied), so later toasts stay visible. */
const clean = () => {
  for (const el of [...document.body.children]) if (!el.classList.contains('toasts')) el.remove();
  document.querySelector('.toasts')?.replaceChildren();
};

afterEach(() => {
  vi.unstubAllGlobals();
  clean();
});

describe('renderSheet', () => {
  it('shows the sheet, who it is for, its grid, the cell counts, and one card per cell', () => {
    const root = render(host());
    expect(texts(root, 'header.as-head > *')).toEqual(['hero', 'Zoe · sprites · grid 2x2', '3 cells, 2 used']);
    expect(texts(root, '.as-cells .as-cell code')).toEqual(['r1c1', 'r1c2', 'r1c3', 'r1c4']);
    expect(texts(root, '[role=group] button')).toEqual(['All (4)', 'Used (2)', 'Unused (1)', 'Missing (1)']);
    expect(root.querySelector('[role=group] button.on')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[role=group] button.on')?.textContent).toBe('All (4)');
  });

  it('a filter button hands the filter to the host, and the filtered grid shows only its cells or says there are none', () => {
    const h = host();
    const root = render(h);
    [...root.querySelectorAll<HTMLButtonElement>('[role=group] button')][2].click();
    expect(h.setFilter).toHaveBeenCalledWith('unused');
    clean();
    const filtered = render(host({ filter: 'missing' }));
    expect(texts(filtered, '.as-cells .as-cell code')).toEqual(['r1c4']);
    const empty = render(host({ filter: 'used', data: () => listing({ sheets: [{ ...hero, cells: [unused] }] }) }));
    expect(empty.querySelector('.as-cells')).toBeNull();
    expect(empty.lastElementChild?.textContent).toBe('No used cell.');
    expect(empty.lastElementChild?.className).toBe('muted');
  });

  it('an unknown sheet drops the selection and says so', () => {
    const h = host();
    const root = render(h, 'ghost');
    expect(h.select).toHaveBeenCalledWith(null);
    expect(root.textContent).toBe('No sheet "ghost".');
  });

  it('the prompt panel offers the upload, the copy of the whole or the missing prompt, and the style block', () => {
    const root = render(host());
    const panel = root.querySelector('details.as-prompt');
    expect(panel?.querySelector('h3')?.textContent).toBe('Prompt (character, 1 missing: click to show)');
    expect(texts(panel ?? root, '.as-phead button')).toEqual([
      'Copy prompt',
      'Copy prompt for missing cells only',
      'Upload generated sheet…',
    ]);
    expect(texts(panel ?? root, '.seg button')).toEqual(['Whole sheet', 'Missing cells only']);
    expect(panel?.querySelector('details.as-style')).not.toBeNull();
    // Demo: no upload; a sheet without a prompt: a flat panel saying so.
    clean();
    const demo = render(host({ demo: true, data: () => listing({ prompts: { sheets: [], style: '' } }) }));
    expect(demo.querySelector('.as-prompt.panel')?.className).toBe('as-prompt panel');
    expect(demo.querySelector('.as-phead.flat span')?.textContent).toBe(
      'No generated prompt for this sheet (the game does not reference it, or its cells are named by hand).',
    );
    expect(demo.querySelector('.as-phead button')).toBeNull();
  });
});

describe('cellCard', () => {
  it('names the state in its class, shows the id, the first short use and a +N, and the thumbnail', () => {
    const h = host({ cell: 'r1c1' });
    const card = cellCard(h, hero, used);
    expect(card.className).toBe('as-cell used on');
    expect(card.title).toBe('cast.hero.walk\ncast.hero.run');
    expect(card.querySelector('.as-use')?.textContent).toBe('walk +1');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/f/art/hero/r1c1.png?v=7');
    expect(card.querySelector('img')?.getAttribute('alt')).toBe('hero/r1c1');
    card.click();
    expect(h.setCell).toHaveBeenCalledWith('r1c1');
  });

  it('a not prepared cell wears the ! badge, an unused one says so, a missing one has no picture', () => {
    expect(cellCard(host(), hero, unprep).querySelector('.as-meta .as-b.unprep')?.textContent).toBe('!');
    expect(cellCard(host(), hero, unprep).className).toBe('as-cell unprep');
    const u = cellCard(host(), hero, unused);
    expect(u.className).toBe('as-cell unused');
    expect(u.title).toBe('not used by the game');
    expect(u.querySelector('.as-use')?.textContent).toBe('unused');
    const m = cellCard(host(), hero, missing);
    expect(m.className).toBe('as-cell missing');
    expect(m.querySelector('img')).toBeNull();
    expect(m.querySelector('.as-pic span')?.textContent).toBe('missing');
    expect(m.querySelector('.as-use')?.textContent).toBe('jump');
    expect(cellCard(host(), hero, orphan).querySelector('.as-use')?.textContent).toBe('referenced, no file');
  });
});

describe('cellPanel', () => {
  it('shows the cell large with its facts, where it is used, and closes through the host', () => {
    const h = host({ cell: 'r1c2' });
    const panel = cellPanel(h, hero, unprep);
    document.body.append(panel);
    expect(panel.querySelector('h2')?.textContent).toBe('hero/r1c2');
    expect(panel.querySelector('.as-big img')?.getAttribute('src')).toBe('/f/art/hero/r1c2.png?v=7');
    expect(texts(panel, 'dl.facts dt')).toEqual(['File', 'Size', 'Image id', 'Prepared']);
    expect(texts(panel, 'dl.facts dd')).toEqual([
      'art/hero/r1c2.png',
      '256 × 256 px',
      'hero/r1c2 ',
      'no: run Prepare assets',
    ]);
    expect(panel.querySelector('dl.facts .warn')).not.toBeNull();
    expect(texts(panel, '.as-used code')).toEqual(['cast.hero.idle']);
    expect(texts(panel, 'section h3')).toEqual(['Used by', 'Replace']);
    expect(panel.querySelector('select[aria-label="Background keying"]')).not.toBeNull();
    panel.querySelector<HTMLButtonElement>('button.icon[title=Close]')?.click();
    expect(h.setCell).toHaveBeenCalledWith(null);
  });

  it('a missing cell offers "Add file…" and the demo no replacement at all', () => {
    const m = cellPanel(host(), hero, missing);
    expect(m.querySelector('.as-big span')?.textContent).toBe('Missing: the game references it, no file yet.');
    expect(texts(m, 'section h3')).toEqual(['Used by', 'Add the file']);
    expect(m.querySelector('section .bar button.primary')?.textContent).toBe('Add file…');
    expect(texts(m, 'dl.facts dd')).toEqual(['—', 'hero/r1c4 ', '—']);
    const d = cellPanel(host({ demo: true }), hero, used);
    expect(d.querySelector('section .bar')).toBeNull();
    expect(d.querySelector('p.muted.small')?.textContent).toBe('Replacing a cell needs the dev server.');
    expect(texts(d, 'dl.facts dd')).toEqual(['art/hero/r1c1.png', '256 × 256 px', 'hero/r1c1 ', '✔ in public/assets']);
  });

  it('Replace… picks a file and POSTs assets/cell with the sheet, the cell, the data URL and the key, then reloads', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, file: 'art/hero/r1c1.png', backup: 'art/hero/r1c1_v1.png', keyed: 'keyed' }),
    }));
    vi.stubGlobal('fetch', fetch);
    const h = host();
    const panel = cellPanel(h, hero, used);
    document.body.append(panel);
    const key = panel.querySelector<HTMLSelectElement>('select[aria-label="Background keying"]');
    if (key) key.value = 'never';
    panel.querySelector<HTMLButtonElement>('section .bar button.primary')?.click();
    const input = document.body.querySelector<HTMLInputElement>('input[type=file][hidden]');
    expect(input?.getAttribute('accept')).toBe('image/png,image/jpeg,image/webp');
    Object.defineProperty(input, 'files', { value: [new File(['png'], 'new.png', { type: 'image/png' })] });
    input?.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1));
    expect(h.ownWrite).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/__studio/api/assets/cell');
    expect(JSON.parse(String(init.body))).toEqual({
      sheetId: 'hero',
      cell: 'r1c1',
      data: 'data:image/png;base64,cG5n',
      key: 'never',
    });
    expect(document.querySelector('.toast')?.textContent).toBe(
      'art/hero/r1c1.png replaced (keyed), old one kept as r1c1_v1.png',
    );
  });
});

describe('uploadDialog', () => {
  it('opens a modal for the sheet, refuses a bad id or grid before any upload, and sends sheet, grid and data', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        file: 'art/hero.png',
        output: 'cut 4',
        written: ['r1c1'],
        backups: [],
        cells: [],
      }),
    }));
    vi.stubGlobal('fetch', fetch);
    const h = host();
    uploadDialog(h, 'hero', '2x2');
    const dialog = document.querySelector('.modal[role=dialog]');
    expect(dialog?.getAttribute('aria-label')).toBe('Upload a generated hero sheet');
    const status = dialog?.querySelector('p');
    expect(status?.textContent).toBe('Cells that already exist are never recut without asking.');
    const id = dialog?.querySelector<HTMLInputElement>('input[aria-label="Sheet id"]');
    const grid = dialog?.querySelector<HTMLInputElement>('input[aria-label="Grid (columns x rows)"]');
    const go = dialog?.querySelector<HTMLButtonElement>('.actions button');
    expect(id?.value).toBe('hero');
    expect(grid?.value).toBe('2x2');
    if (id) id.value = 'decor';
    go?.click();
    expect(status?.textContent).toBe('Sheet id: letters, digits, _ and - (not "decor").');
    expect(status?.className).toBe('error small');
    if (id) id.value = 'hero';
    if (grid) grid.value = 'six';
    go?.click();
    expect(status?.textContent).toBe('Grid: COLSxROWS, e.g. 6x4.');
    if (grid) grid.value = '2X2';
    go?.click();
    expect(status?.textContent).toBe('Choose the image first.');
    expect(fetch).not.toHaveBeenCalled();
    const file = dialog?.querySelector<HTMLInputElement>('input[type=file]');
    Object.defineProperty(file, 'files', { value: [new File(['sheet'], 's.png', { type: 'image/png' })] });
    go?.click();
    await vi.waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/__studio/api/assets/sheet');
    expect(JSON.parse(String(init.body))).toEqual({
      sheetId: 'hero',
      grid: '2x2',
      data: 'data:image/png;base64,c2hlZXQ=',
    });
    expect(h.select).toHaveBeenCalledWith({ type: 'sheet', id: 'hero' }, null);
    // The upload dialog closed; the cut result is shown.
    expect(document.querySelector('.modal[aria-label="Cut result: hero"] pre.as-out')?.textContent).toBe('cut 4');
    expect(document.querySelector('.modal[aria-label="Upload a generated hero sheet"]')).toBeNull();
  });
});
