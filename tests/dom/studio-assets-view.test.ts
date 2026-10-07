// @vitest-environment happy-dom
// The DOM pieces the Assets tab's views share (4.1.8, src/studio/assets-view.ts): the "Used by" list and its "Open
// room" buttons, the backups with a thumbnail for images only, the shared style block, `nodes`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetsListing, GameInfo } from '../../src/studio/api';
import { type AssetsHost, backupsList, nodes, styleDetails, usedList } from '../../src/studio/assets-view';

const info = (o: Partial<GameInfo> = {}): GameInfo => ({
  id: 'demo',
  title: 'Demo',
  rooms: [
    { id: 'yard', name: 'Yard', decor: 'decor/yard' },
    { id: 'house', name: 'House', decor: 'decor/house' },
  ],
  characters: {},
  items: {},
  verbs: [],
  checkpoints: {},
  hero: 'hero',
  images: {},
  ...o,
});
const listing = (o: Partial<AssetsListing> = {}): AssetsListing => ({
  sheets: [],
  decors: [],
  sounds: { music: [], sfx: [] },
  missing: [],
  unprepared: 0,
  prompts: { sheets: [], style: '```text\nflat colours, thick outlines\n```' },
  ...o,
});
function host(o: Partial<AssetsHost> = {}): AssetsHost {
  return {
    demo: false,
    info: info(),
    data: () => listing(),
    sel: () => null,
    select: vi.fn(),
    url: (x) => (x.file ? `/f/${x.file}?v=${x.mtime}` : null),
    ownWrite: vi.fn(),
    reload: vi.fn(async () => undefined),
    renderCenter: vi.fn(),
    ...o,
  };
}

/** Empties the page but keeps the toast stack `toast()` caches (emptied), so later toasts stay visible. */
const clean = () => {
  for (const el of [...document.body.children]) if (!el.classList.contains('toasts')) el.remove();
  document.querySelector('.toasts')?.replaceChildren();
};

afterEach(() => {
  vi.unstubAllGlobals();
  clean();
});

describe('usedList', () => {
  it('lists each use and offers "Open room" for the ones starting with a room id, handing the room to the host', () => {
    const openRoom = vi.fn();
    const ul = usedList(host({ openRoom }), ['yard.props.pantry', 'cast.hero.walk', 'house.on']);
    document.body.append(ul);
    expect(ul.className).toBe('as-used');
    expect([...ul.querySelectorAll('li')].map((li) => li.querySelector('code')?.textContent)).toEqual([
      'yard.props.pantry',
      'cast.hero.walk',
      'house.on',
    ]);
    const buttons = [...ul.querySelectorAll('li')].map((li) => li.querySelector<HTMLButtonElement>('button.link'));
    expect(buttons.map((b) => b?.textContent ?? null)).toEqual(['Open room', null, 'Open room']);
    buttons[2]?.click();
    expect(openRoom).toHaveBeenCalledWith('house');
  });

  it('offers no "Open room" without the callback, and says so when nothing uses the file', () => {
    const ul = usedList(host(), ['yard.props.pantry']);
    expect(ul.querySelector('button')).toBeNull();
    const p = usedList(host(), []);
    expect(p.tagName).toBe('P');
    expect(p.textContent).toBe('Not used by the game.');
  });
});

describe('backupsList', () => {
  it('is nothing without backups, else a section of links with a thumbnail for the images only', () => {
    expect(backupsList(host(), [], 3)).toBeNull();
    const s = backupsList(host(), ['art/hero/r1c1_v1.png', 'audio/sfx/bell_v1.ogg'], 3);
    expect(s?.querySelector('h3')?.textContent).toBe('Backups (2)');
    const links = [...(s?.querySelectorAll('a') ?? [])];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/f/art/hero/r1c1_v1.png?v=3',
      '/f/audio/sfx/bell_v1.ogg?v=3',
    ]);
    expect(links.map((a) => a.getAttribute('target'))).toEqual(['_blank', '_blank']);
    expect(links.map((a) => a.querySelector('img')?.getAttribute('src') ?? null)).toEqual([
      '/f/art/hero/r1c1_v1.png?v=3',
      null,
    ]);
    expect(links.map((a) => a.querySelector('span')?.textContent)).toEqual(['r1c1_v1.png', 'bell_v1.ogg']);
  });

  it('links to # when the host has no URL for a backup (the demo)', () => {
    const s = backupsList(host({ url: () => null }), ['art/hero/r1c1_v1.png'], 3);
    expect(s?.querySelector('a')?.getAttribute('href')).toBe('#');
    expect(s?.querySelector('img')).toBeNull();
  });
});

describe('styleDetails', () => {
  it('shows the style block folded and copies its fenced text', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const d = styleDetails(host());
    document.body.append(d);
    expect(d.className).toBe('as-style');
    expect(d.open).toBe(false);
    expect(d.querySelector('pre.as-md')?.textContent).toBe('```text\nflat colours, thick outlines\n```');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    d.querySelector('summary button')?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('flat colours, thick outlines'));
    expect(document.querySelector('.toast')?.textContent).toBe('Style block copied');
  });
});

describe('nodes', () => {
  it('drops the null, undefined and false placeholders and keeps the strings', () => {
    const el = document.createElement('b');
    expect(nodes(el, null, 'text', undefined, false)).toEqual([el, 'text']);
  });
});
