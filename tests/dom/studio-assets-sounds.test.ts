// @vitest-environment happy-dom
// The Assets tab's sounds view (4.1.8, src/studio/assets-sounds.ts): the music or sfx table, the files referenced
// without a file, a row's player, badge and uses, the empty messages, and the uploads (Add sound… and Replace… POST
// assets/sound with kind, file and data URL; a replacement must keep the extension).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetSound, AssetsListing, GameInfo } from '../../src/studio/api';
import { renderSounds, soundRow } from '../../src/studio/assets-sounds';
import type { AssetsHost } from '../../src/studio/assets-view';

const sound = (id: string, o: Partial<AssetSound> = {}): AssetSound => ({
  id,
  kind: 'sfx',
  file: `audio/sfx/${id}`,
  used: [],
  prepared: false,
  backups: [],
  mtime: 5,
  ...o,
});
const bell = sound('bell.ogg', { used: ['audio.sfx.bell', 'market.on'], prepared: true, asset: 'audio/sfx/bell.mp3' });
const creak = sound('creak.wav', { used: ['audio.sfx.creak'], backups: ['audio/sfx/creak_v1.wav'] });
const spare = sound('spare.ogg');
const info = (): GameInfo => ({
  id: 'demo',
  title: 'Demo',
  rooms: [],
  characters: {},
  items: {},
  verbs: [],
  checkpoints: {},
  hero: 'hero',
  images: {},
});
const listing = (o: Partial<AssetsListing> = {}): AssetsListing => ({
  sheets: [],
  decors: [],
  sounds: { music: [], sfx: [bell, creak, spare] },
  missing: ['hero/r1c1', 'audio/sfx/thunder.ogg', 'audio/music/theme.ogg'],
  unprepared: 1,
  prompts: { sheets: [], style: '' },
  ...o,
});
function host(o: Partial<AssetsHost> = {}): AssetsHost {
  return {
    demo: false,
    info: info(),
    data: () => listing(),
    sel: () => ({ type: 'sounds', kind: 'sfx' }),
    select: vi.fn(),
    url: (x) => (x.file ? `/f/${x.file}?v=${x.mtime}` : null),
    ownWrite: vi.fn(),
    reload: vi.fn(async () => undefined),
    renderCenter: vi.fn(),
    ...o,
  };
}
const render = (h: AssetsHost, kind: 'music' | 'sfx' = 'sfx') => {
  const root = document.createElement('div');
  root.append(...renderSounds(h, kind));
  document.body.append(root);
  return root;
};
const texts = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent);
const pick = (name: string, type: string) => {
  const input = document.body.querySelector<HTMLInputElement>('input[type=file][hidden]');
  Object.defineProperty(input, 'files', { value: [new File(['snd'], name, { type })] });
  input?.dispatchEvent(new Event('change'));
  return input;
};

/** Empties the page but keeps the toast stack `toast()` caches (emptied), so later toasts stay visible. */
const clean = () => {
  for (const el of [...document.body.children]) if (!el.classList.contains('toasts')) el.remove();
  document.querySelector('.toasts')?.replaceChildren();
};

afterEach(() => {
  vi.unstubAllGlobals();
  clean();
});

describe('renderSounds', () => {
  it('shows the folder and count, the sounds referenced without a file for this kind only, and one row per file', () => {
    const root = render(host());
    expect(texts(root, 'header.as-head > *')).toEqual([
      'Sound effects',
      'games/demo/audio/sfx/ · 3 files',
      'Add sound…',
    ]);
    expect(root.querySelector('p.error.small')?.textContent).toBe('Referenced without a file: thunder.ogg');
    expect(texts(root, 'table.as-sounds thead th')).toEqual(['File', 'Play', 'Used by', '']);
    expect(texts(root, 'table.as-sounds tbody tr > td:first-child code')).toEqual([
      'bell.ogg',
      'creak.wav',
      'spare.ogg',
    ]);
  });

  it('says when there is no music or no sound effect yet, and hides Add sound in the demo', () => {
    const root = render(host({ demo: true }), 'music');
    expect(texts(root, 'header.as-head > *')).toEqual(['Music', 'games/demo/audio/music/ · 0 files']);
    expect(root.querySelector('table')).toBeNull();
    expect(root.querySelector('p.muted:not(.small)')?.textContent).toBe(
      'No music yet. Add a file, then list it in audio.music (game.ts).',
    );
    expect(root.querySelector('p.error.small')?.textContent).toBe('Referenced without a file: theme.ogg');
    const sfx = render(host({ data: () => listing({ sounds: { music: [], sfx: [] }, missing: [] }) }));
    expect(sfx.querySelector('p.muted:not(.small)')?.textContent).toBe('No sound effect yet.');
    expect(sfx.querySelector('p.error')).toBeNull();
  });
});

describe('soundRow', () => {
  it('a used, prepared sound: its player, its uses as chips, Replace…', () => {
    const tr = soundRow(host(), bell);
    expect(tr.className).toBe('');
    expect(tr.querySelector('.as-b.unprep')).toBeNull();
    const audio = tr.querySelector('audio');
    expect(audio?.getAttribute('src')).toBe('/f/audio/sfx/bell.ogg?v=5');
    expect(audio?.getAttribute('aria-label')).toBe('Play bell.ogg');
    expect(audio?.getAttribute('preload')).toBe('none');
    expect(texts(tr, 'code.as-usechip')).toEqual(['audio.sfx.bell', 'market.on']);
    expect(tr.querySelector('td:last-child button')?.textContent).toBe('Replace…');
  });

  it('a not prepared sound wears the ! badge and lists its backups; an unused one is marked and has no chips', () => {
    const tr = soundRow(host(), creak);
    expect(tr.querySelector('.as-b.unprep')?.textContent).toBe('!');
    expect(tr.querySelector('td .muted.small')?.textContent).toBe('backups: creak_v1.wav');
    const u = soundRow(host(), spare);
    expect(u.className).toBe('unused');
    expect(texts(u, 'td:nth-child(3) span')).toEqual(['unused']);
    const demo = soundRow(host({ demo: true, url: () => null }), spare);
    expect(demo.querySelector('audio')).toBeNull();
    expect(demo.querySelector('td:nth-child(2) span')?.textContent).toBe('not prepared');
    expect(demo.querySelector('td:last-child button')).toBeNull();
  });
});

describe('uploads', () => {
  it('Add sound… POSTs assets/sound with the kind, a safe file name and the data URL, then reloads', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, file: 'audio/sfx/door_slam.ogg' }),
    }));
    vi.stubGlobal('fetch', fetch);
    const h = host();
    const root = render(h);
    root.querySelector<HTMLButtonElement>('header button.primary')?.click();
    const input = pick('door slam!.ogg', 'audio/ogg');
    expect(input?.getAttribute('accept')).toBe('audio/*');
    await vi.waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/__studio/api/assets/sound');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'sfx',
      file: 'door_slam_.ogg',
      data: 'data:audio/ogg;base64,c25k',
    });
    expect(h.ownWrite).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.toast')?.textContent).toBe('audio/sfx/door_slam.ogg saved');
  });

  it('Add sound… with an existing name asks first, and does nothing when refused', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const h = host();
    render(h).querySelector<HTMLButtonElement>('header button.primary')?.click();
    pick('bell.ogg', 'audio/ogg');
    await vi.waitFor(() =>
      expect(confirm).toHaveBeenCalledWith('bell.ogg exists: replace it (the old file is kept as a backup)?'),
    );
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('Replace… keeps the file name and refuses another extension', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, file: 'audio/sfx/creak.wav', backup: 'audio/sfx/creak_v2.wav' }),
    }));
    vi.stubGlobal('fetch', fetch);
    const h = host();
    const tr = soundRow(h, creak);
    document.body.append(tr);
    tr.querySelector<HTMLButtonElement>('td:last-child button')?.click();
    const input = pick('other.mp3', 'audio/mpeg');
    expect(input?.getAttribute('accept')).toBe('audio/*,.wav');
    await vi.waitFor(() =>
      expect(document.querySelector('.toast.error')?.textContent).toBe(
        'Pick a .wav file to replace creak.wav (or use Add sound for another format).',
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    tr.querySelector<HTMLButtonElement>('td:last-child button')?.click();
    pick('Creak-NEW.WAV', 'audio/wav');
    await vi.waitFor(() => expect(h.reload).toHaveBeenCalledTimes(1));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/__studio/api/assets/sound');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'sfx',
      file: 'creak.wav',
      data: 'data:audio/wav;base64,c25k',
    });
    expect(document.querySelector('.toast.ok')?.textContent).toBe(
      'audio/sfx/creak.wav saved, old one kept as creak_v2.wav',
    );
  });
});
