// @vitest-environment happy-dom
// The Rooms tab's editable lines and command lists (src/studio/rooms-lines.ts, 4.1.8): a text of the room file as a
// textarea saved through PUT room/:id/text, the "+ line" appender, a command list as lines and chips. The tab is a
// fake host, the backend a fake Api whose setText is spied on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cmd, RoomDef } from '@engine/core/types';
import { type Api, type GameInfo, serverApi, type TextRef, useApi } from '../../src/studio/api';
import { appender, cmds, line, type LinesHost, timed } from '../../src/studio/rooms-lines';

if (typeof ResizeObserver === 'undefined')
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );

const info: GameInfo = {
  id: 'g',
  title: 'G',
  rooms: [{ id: 'kitchen', name: 'Kitchen', decor: 'kitchen' }],
  characters: { lou: { name: 'Lou', color: '#f00' }, grandma: { name: 'Grandma', color: '#0f0' } },
  items: {},
  verbs: [],
  checkpoints: {},
  hero: 'lou',
  images: {},
};
const def: RoomDef = { id: 'kitchen', name: 'Kitchen', decor: 'kitchen', props: { piano: { name: 'piano' } } };
const file = 'games/demo/rooms/kitchen.ts';

const setText = vi.fn(async (_id: string, _path: string, _value: string | null) => ({
  ok: true as const,
  line: 12,
  changed: true,
}));

function host(texts: TextRef[]): LinesHost & { spies: Record<string, ReturnType<typeof vi.fn>> } {
  const byPath = new Map(texts.map((t) => [t.path, t]));
  const spies = {
    flushEditor: vi.fn(async () => undefined),
    ownWrite: vi.fn(),
    saved: vi.fn(),
    reload: vi.fn(async () => undefined),
    renderIfPending: vi.fn(),
    writeValue: vi.fn(),
  };
  return {
    info,
    room: 'kitchen',
    data: { def, layout: {}, texts, file },
    textAt: (p) => byPath.get(p),
    ...spies,
    spies,
  };
}

const ref = (path: string, value: string, kind: TextRef['kind'] = 'look', who?: string): TextRef => ({
  path,
  value,
  file,
  line: 7,
  kind,
  who,
});
const toasts = () => [...document.querySelectorAll('.toast')].map((t) => t.textContent);
const field = (el: HTMLElement | null) => el?.querySelector('textarea') as HTMLTextAreaElement;

/** Between tests: the body emptied, but the toasts' stack kept (src/studio/ui.ts holds it in a module variable). */
const reset = () => {
  for (const c of [...document.body.children]) c.classList.contains('toasts') ? c.replaceChildren() : c.remove();
};

describe('line', () => {
  beforeEach(() => {
    useApi({ ...serverApi, setText } as Api);
    setText.mockClear();
  });
  afterEach(() => {
    reset();
  });

  it('is nothing without a literal in the room file, else a textarea on the text, labelled and located', () => {
    const h = host([ref('look.piano[0]', 'A dusty piano.')]);
    expect(line(h, 'look.piano[1]')).toBeNull();
    const row = line(h, 'look.piano[0]', { label: 'Lou', color: '#f00' });
    expect(row?.className).toBe('line');
    expect(row?.dataset.path).toBe('look.piano[0]');
    expect(row?.title).toBe(`look.piano[0] · ${file}:7`);
    expect(field(row).value).toBe('A dusty piano.');
    expect(field(row).getAttribute('aria-label')).toBe('Lou: look.piano[0]');
    const who = row?.querySelector<HTMLElement>('.who');
    expect(who?.textContent).toBe('Lou');
    expect(who?.style.color).toMatch(/#f00|rgb\(255, 0, 0\)/);
    expect(row?.querySelector('.del')).toBeNull();
  });

  it('saves an edited text on blur: the placement first, then PUT text, a toast, the check', async () => {
    const h = host([ref('look.piano[0]', 'A dusty piano.')]);
    const row = line(h, 'look.piano[0]');
    document.body.append(row as HTMLElement);
    const t = field(row);
    t.value = 'A grand piano.';
    t.dispatchEvent(new Event('blur'));
    expect(row?.classList.contains('saving')).toBe(true);
    await vi.waitFor(() => expect(h.spies.saved).toHaveBeenCalled());
    expect(h.spies.flushEditor).toHaveBeenCalledTimes(1);
    expect(h.spies.ownWrite).toHaveBeenCalledTimes(1);
    expect(setText).toHaveBeenCalledWith('kitchen', 'look.piano[0]', 'A grand piano.');
    expect(toasts()).toEqual(['Saved · kitchen.ts:12']);
    expect(row?.classList.contains('saving')).toBe(false);
    expect(t.defaultValue).toBe('A grand piano.');
    expect(h.spies.reload).not.toHaveBeenCalled(); // the path did not move: no need to re-read the room
    expect(h.spies.renderIfPending).toHaveBeenCalled();
  });

  it('refuses an empty text, restores it on Escape, and does not write an unchanged one', async () => {
    const h = host([ref('look.piano[0]', 'A dusty piano.')]);
    const t = field(line(h, 'look.piano[0]'));
    t.value = '   ';
    t.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(toasts()).toEqual(['A line cannot be empty (✕ deletes it)']));
    expect(t.value).toBe('A dusty piano.');
    t.value = 'typing…';
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(t.value).toBe('A dusty piano.');
    t.dispatchEvent(new Event('blur'));
    await Promise.resolve();
    expect(setText).not.toHaveBeenCalled();
    expect(h.spies.renderIfPending).toHaveBeenCalled();
  });

  it('a deletable line has a ✕ that deletes the text and re-reads the room, as the paths after it shift', async () => {
    const h = host([ref('look.piano[0]', 'A dusty piano.')]);
    const row = line(h, 'look.piano[0]', { deletable: true });
    const del = row?.querySelector<HTMLButtonElement>('button.del');
    expect(del?.getAttribute('aria-label')).toBe('Delete look.piano[0]');
    del?.click();
    await vi.waitFor(() => expect(h.spies.reload).toHaveBeenCalled());
    expect(setText).toHaveBeenCalledWith('kitchen', 'look.piano[0]', null);
    expect(toasts()).toEqual(['Deleted · kitchen.ts:12']);
  });

  it('shows the length near the limit and marks it over 140 characters', () => {
    const t = field(line(host([ref('look.piano[0]', 'x'.repeat(130))]), 'look.piano[0]'));
    const count = t.parentElement?.querySelector('.count');
    expect(count?.textContent).toBe('130');
    expect(count?.classList.contains('over')).toBe(false);
    t.value = 'x'.repeat(141);
    t.dispatchEvent(new Event('input'));
    expect(count?.textContent).toBe('141');
    expect(count?.classList.contains('over')).toBe(true);
  });
});

describe('appender', () => {
  beforeEach(() => {
    useApi({ ...serverApi, setText } as Api);
    setText.mockClear();
  });
  afterEach(() => {
    reset();
  });

  it('appends a line at `path[+]` on Enter or the button, then clears itself; nothing for an empty text', async () => {
    const h = host([]);
    const add = appender(h, 'look.piano', 'New look line…');
    const input = add.querySelector('input') as HTMLInputElement;
    expect(input.placeholder).toBe('New look line…');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    expect(setText).not.toHaveBeenCalled();
    input.value = ' It hums. ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(input.value).toBe(''));
    expect(setText).toHaveBeenCalledWith('kitchen', 'look.piano[+]', 'It hums.');
    expect(h.spies.reload).toHaveBeenCalledTimes(1);
    expect(toasts()).toEqual(['Added · kitchen.ts:12']);
    input.value = 'Again';
    add.querySelector('button')?.click();
    await vi.waitFor(() => expect(setText).toHaveBeenCalledTimes(2));
  });

  it('reports a failed write and keeps the text', async () => {
    setText.mockRejectedValueOnce(new Error('409 the file changed'));
    const h = host([]);
    const add = appender(h, 'look.piano', 'New look line…');
    const input = add.querySelector('input') as HTMLInputElement;
    input.value = 'Lost?';
    add.querySelector('button')?.click();
    await vi.waitFor(() => expect(toasts()).toEqual(['409 the file changed']));
    expect(input.value).toBe('Lost?');
    expect(h.spies.saved).not.toHaveBeenCalled();
  });
});

describe('cmds and timed', () => {
  afterEach(() => {
    reset();
  });

  it('draws a say as a line with its speaker, a plain string as the hero, other commands as chips with their path', () => {
    const list: Cmd[] = [{ say: ['grandma', 'Tea?'] }, 'Yes please.', { give: 'cup', to: 'lou' } as unknown as Cmd];
    const h = host([ref('on[0].do[0].say[1]', 'Tea?', 'say', 'grandma'), ref('on[0].do[1]', 'Yes please.', 'say')]);
    const box = cmds(h, list, 'on[0].do');
    expect(box.className).toBe('cmds');
    const rows = [...box.children] as HTMLElement[];
    expect(rows.map((r) => r.className)).toEqual(['line', 'line', 'chip']);
    expect(rows[0]?.querySelector('.who')?.textContent).toBe('Grandma');
    expect(rows[1]?.querySelector('.who')?.textContent).toBe('Lou');
    expect(rows[2]?.textContent).toBe('give cup (to lou)');
    expect(rows[2]?.dataset.path).toBe('on[0].do[2]');
  });

  it('nests the branches of an if / else and a choice, and shows a text without a literal as a chip', () => {
    const list: Cmd[] = [
      { if: { has: 'key' }, then: [{ say: ['lou', 'Open!'] }], else: [{ toast: 'Locked.' }] },
      { choice: [{ text: 'Leave', do: [{ goto: 'hall' } as unknown as Cmd], if: 'awake' }] },
    ];
    const box = cmds(host([]), list, 'onEnter');
    const labels = [...box.querySelectorAll('.chip.k')].map((c) => c.textContent);
    expect(labels).toEqual(['if has key', 'else', 'choice']);
    const chips = [...box.querySelectorAll('.chip:not(.k)')].map((c) => c.textContent);
    expect(chips).toEqual(['say lou → Open!', 'toast Locked.', 'Leave', 'goto hall']);
    expect(box.querySelector('[data-path="onEnter[1].choice[0].do[0]"]')).not.toBeNull();
  });

  it('timed adds a Timeline toggle that draws the bars once and names the total', () => {
    const list: Cmd[] = [{ say: ['lou', 'Hello there.'] }, { wait: 500 }];
    const box = timed(host([]), list, 'onEnter');
    expect(box.className).toBe('timed');
    const toggle = box.querySelector('button') as HTMLButtonElement;
    const bars = box.querySelector('.tl') as HTMLElement;
    expect(toggle.textContent).toBe('Timeline');
    expect(bars.hidden).toBe(true);
    toggle.click();
    expect(bars.hidden).toBe(false);
    expect(toggle.textContent).toBe('Hide timeline');
    expect(bars.querySelectorAll('.tlbar').length).toBe(2);
    expect(bars.querySelector('.muted.small')?.textContent).toMatch(/^\d+\.\d s · 1 lines$/);
    toggle.click();
    expect(bars.hidden).toBe(true);
    expect(toggle.textContent).toBe('Timeline');
    expect(timed(host([]), [], 'onEnter').className).toBe('cmds');
  });
});
