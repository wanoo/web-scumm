// @vitest-environment happy-dom
// The Storyboard tab's editor blocks (src/studio/storyboard-view.ts, 4.1.8) rendered against a fake host: what a
// card, the hints, the talks and the reactions show, and what they tell the tab on an input or a click.
import { describe, expect, it, vi } from 'vitest';
import type { GameInfo } from '../../src/studio/api';
import { NotesStore } from '../../src/studio/notes';
import { type Doc, normDoc } from '../../src/studio/storyboard-model';
import {
  hintsBlock,
  lines,
  panelCard,
  reactionsBlock,
  type SbHost,
  talksBlock,
} from '../../src/studio/storyboard-view';

const info: GameInfo = {
  id: 'demo',
  title: 'Demo',
  rooms: [{ id: 'garden', name: 'The garden', decor: 'garden-decor' }],
  characters: { pixel: { name: 'Pixel', color: '#f80' }, grandpa: { name: 'Grandpa', color: '#8cf' } },
  items: {},
  verbs: [],
  checkpoints: {},
  hero: 'pixel',
  images: {},
  sfx: ['metal', 'door'],
};

function board(): Doc {
  return normDoc({
    boards: [
      {
        id: 'garden',
        title: 'The garden',
        room: 'garden',
        panels: [
          {
            id: 'garden-1',
            title: 'The pipe',
            action: 'Pick up pipe',
            lines: [
              { who: 'action', text: 'Pixel grabs the pipe' },
              { who: 'hero', text: 'A pipe!' },
              { who: 'grandpa', text: 'Bring it back!' },
            ],
            sfx: ['metal', 'thunder'],
          },
          { id: 'garden-2', title: 'The gate', lines: [] },
        ],
        hints: ['Look around', 'The pipe is useful'],
        talks: { grandpa: [{ topic: 'The pipe?', lines: [{ who: 'grandpa', text: 'Mine.' }] }] },
        reactions: [{ action: 'Push gnome', lines: [{ who: 'hero', text: 'It wobbles.' }] }],
      },
    ],
  });
}

/** A host recording what the blocks tell the tab. */
function host(doc: Doc) {
  const notes = new NotesStore();
  notes.entries = [{ id: 'n1', about: 'garden-1', author: 'you', text: 'Shorter?', at: '2026-10-07T10:00:00Z' }];
  const state = { pi: 0, li: 0 };
  const h: SbHost & { calls: string[] } = {
    calls: [],
    info,
    notes,
    doc,
    cov: null,
    get board() {
      return doc.boards[0];
    },
    get panel() {
      return doc.boards[0]?.panels[state.pi];
    },
    get pi() {
      return state.pi;
    },
    set pi(v) {
      state.pi = v;
    },
    get li() {
      return state.li;
    },
    set li(v) {
      state.li = v;
    },
    changed: (structure) => void h.calls.push(`changed(${structure ? 'structure' : ''})`),
    focus: (key) => void h.calls.push(`focus(${key})`),
    openRoom: (id) => void h.calls.push(`openRoom(${id})`),
    selectPanel: (i, li) => void h.calls.push(`select(${i}${li === undefined ? '' : `,${li}`})`),
    renderList: () => void h.calls.push('renderList'),
    renderPreview: () => void h.calls.push('renderPreview'),
  };
  return h;
}

const board0 = (doc: Doc) => doc.boards[0] as NonNullable<Doc['boards'][0]>;
const panel = (doc: Doc, i: number) => board0(doc).panels[i] as NonNullable<Doc['boards'][0]['panels'][0]>;
const input = (el: Element | null, value: string) => {
  const field = el as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event('input'));
};
const texts = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent);
/** The add button with that label (a block nests the lines' own "+ line"). */
const adder = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button.add')].find((b) => b.textContent === label);

describe('panelCard', () => {
  it('shows the number, the title, the id, the action, the lines with their speakers, the sounds and the notes', () => {
    const doc = board();
    const hst = host(doc);
    const card = panelCard(hst, board0(doc), panel(doc, 0), 0);
    document.body.replaceChildren(card);
    expect(card.className).toBe('card on');
    expect(card.querySelector('header .num')?.textContent).toBe('1');
    expect(card.querySelector<HTMLInputElement>('input.ptitle')?.value).toBe('The pipe');
    expect(card.querySelector<HTMLInputElement>('input.pid')?.value).toBe('garden-1');
    expect(card.querySelector<HTMLInputElement>('[aria-label="Panel 1 action"]')?.value).toBe('Pick up pipe');
    const rows = [...card.querySelectorAll('.sbline')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.classList.contains('stage')).toBe(true);
    expect(rows[0]?.querySelector('textarea')?.placeholder).toBe('What happens…');
    // The speaker select's value: happy-dom loses an option pre-selected before insertion; the painted colour says it.
    expect((rows[2]?.querySelector('select.who') as HTMLElement).style.color).toBe('#8cf');
    expect(texts(card, '.sfx .chipx').map((t) => t?.replace('✕', ''))).toEqual(['metal', 'thunder']);
    expect(card.querySelector('.chipx.unknown')?.getAttribute('title')).toBe('thunder: not in audio.sfx');
    expect(texts(card, 'select.addsfx option')).toEqual(['+ sfx', 'door']);
    expect(card.querySelector('.ncount')?.textContent).toBe('✎ 1');
    expect(card.querySelector('.covlist')).toBeNull();
  });

  it('writes a typed title into the panel, removes an emptied optional action, and tells the tab', () => {
    const doc = board();
    const hst = host(doc);
    const card = panelCard(hst, board0(doc), panel(doc, 0), 0);
    input(card.querySelector('input.ptitle'), 'The old pipe');
    expect(panel(doc, 0).title).toBe('The old pipe');
    input(card.querySelector('[aria-label="Panel 1 action"]'), '');
    expect('action' in panel(doc, 0)).toBe(false);
    input(card.querySelector('input.pid'), 'garden-one');
    expect(panel(doc, 0).id).toBe('garden-one');
    expect(hst.calls).toEqual(['changed()', 'changed()', 'renderPreview', 'changed()']);
  });

  it('selects the panel on a click and a line on focus; moves, duplicates and deletes a panel through the host', () => {
    const doc = board();
    const hst = host(doc);
    const card = panelCard(hst, board0(doc), panel(doc, 0), 0);
    document.body.replaceChildren(card);
    card.dispatchEvent(new Event('click'));
    card.querySelectorAll('textarea')[1]?.dispatchEvent(new Event('focus'));
    expect(hst.calls).toEqual(['select(0)', 'select(0,1)']);
    hst.calls.length = 0;

    expect(card.querySelector<HTMLButtonElement>('[aria-label="Move panel 1 up"]')?.disabled).toBe(true);
    card.querySelector<HTMLButtonElement>('[aria-label="Move panel 1 down"]')?.click();
    expect(board0(doc).panels.map((p) => p.id)).toEqual(['garden-2', 'garden-1']);
    expect(hst.pi).toBe(1);

    card.querySelector<HTMLButtonElement>('[aria-label="Duplicate panel 1"]')?.click();
    expect(board0(doc).panels.map((p) => p.id)).toEqual(['garden-2', 'garden-1-copy', 'garden-1']);
    expect(panel(doc, 1).title).toBe('The pipe (copy)');

    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    card.querySelector<HTMLButtonElement>('[aria-label="Delete panel 1"]')?.click();
    expect(confirm).toHaveBeenCalledWith(
      'Delete panel garden-1 "The pipe"? Its 1 note(s) stay in notes.json. (Nothing is written until you save.)',
    );
    expect(board0(doc).panels.map((p) => p.id)).toEqual(['garden-1-copy', 'garden-1']);
    vi.unstubAllGlobals();
    // A click on the panel's own buttons does not select it (the event stops at the button).
    expect(hst.calls).toEqual(['changed(structure)', 'changed(structure)', 'changed(structure)']);
  });
});

describe('lines', () => {
  it('adds a line spoken by the last speaker (the hero on an empty list), creating the list, and asks for its focus', () => {
    const doc = board();
    const hst = host(doc);
    const empty = panel(doc, 1) as unknown as Record<string, unknown>;
    delete empty.lines;
    const box = lines(hst, empty, 'lines', 'p1');
    expect(box.querySelectorAll('.sbline')).toHaveLength(0);
    adder(box, '+ line')?.click();
    expect(empty.lines).toEqual([{ who: 'hero', text: '' }]);
    expect(hst.calls).toEqual(['focus(p1.0)', 'changed(structure)']);

    hst.calls.length = 0;
    const full = lines(hst, panel(doc, 0), 'lines', 'p0');
    adder(full, '+ line')?.click();
    expect(panel(doc, 0).lines?.at(-1)).toEqual({ who: 'grandpa', text: '' });
    full.querySelector<HTMLButtonElement>('[aria-label="Move line 2 up"]')?.click();
    expect(panel(doc, 0).lines?.map((l) => l.who)).toEqual(['hero', 'action', 'grandpa', 'grandpa']);
    expect(hst.calls).toEqual(['focus(p0.3)', 'changed(structure)', 'focus(p0.0)', 'changed(structure)']);
  });

  it('changes the speaker of a line, repainting its row, and the text of a line', () => {
    const doc = board();
    const hst = host(doc);
    const box = lines(hst, panel(doc, 0), 'lines', 'p0');
    const row = box.querySelectorAll('.sbline')[1] as HTMLElement;
    const who = row.querySelector('select.who') as HTMLSelectElement;
    expect(texts(who, 'option')).toEqual(['hero (Pixel)', 'action', 'stage', 'Grandpa (grandpa)']);
    expect(who.style.color).toBe('#f80');
    who.value = 'stage';
    who.dispatchEvent(new Event('change'));
    expect(panel(doc, 0).lines?.[1]?.who).toBe('stage');
    expect(row.classList.contains('stage')).toBe(true);
    expect(who.style.color).toBe('');
    input(row.querySelector('textarea'), 'The pipe glints.');
    expect(panel(doc, 0).lines?.[1]?.text).toBe('The pipe glints.');
    expect(hst.calls).toEqual(['changed()', 'changed()']);
  });
});

describe('hints, talks and reactions', () => {
  it('numbers the hints, edits one in place, and appends an empty one to focus', () => {
    const doc = board();
    const hst = host(doc);
    const box = hintsBlock(hst, board0(doc));
    expect(texts(box, '.num')).toEqual(['1', '2']);
    input(box.querySelectorAll('textarea')[1] ?? null, 'The pipe opens the gate');
    expect(board0(doc).hints).toEqual(['Look around', 'The pipe opens the gate']);
    adder(box, '+ hint')?.click();
    expect(board0(doc).hints).toHaveLength(3);
    expect(hst.calls).toEqual(['changed()', 'focus(hint.2)', 'changed(structure)']);
  });

  it('shows each character with its topics, offers the characters without topics, and adds a topic for one', () => {
    const doc = board();
    const hst = host(doc);
    const box = talksBlock(hst, board0(doc));
    expect(box.querySelector('.talkhead b')?.textContent).toBe('Grandpa');
    expect(box.querySelector('.talkhead code')?.textContent).toBe('grandpa');
    expect(box.querySelector<HTMLInputElement>('[aria-label="Topic 1 of grandpa"]')?.value).toBe('The pipe?');
    // The hero never gets topics and grandpa already has his: nobody is left to add.
    expect(box.querySelector('[aria-label="Add topics for a character"]')).toBeNull();
    adder(box, '+ topic')?.click();
    expect(board0(doc).talks?.grandpa).toEqual([
      { topic: 'The pipe?', lines: [{ who: 'grandpa', text: 'Mine.' }] },
      { topic: '', lines: [{ who: 'grandpa', text: '' }] },
    ]);
    expect(hst.calls).toEqual(['focus(talk.grandpa.1)', 'changed(structure)']);

    delete board0(doc).talks;
    const fresh = talksBlock(hst, board0(doc));
    const add = fresh.querySelector('[aria-label="Add topics for a character"]') as HTMLSelectElement;
    expect(texts(add, 'option')).toEqual(['+ character…', 'Grandpa (grandpa)']);
    add.value = 'grandpa';
    add.dispatchEvent(new Event('change'));
    expect(board0(doc).talks).toEqual({ grandpa: [{ topic: '', lines: [{ who: 'grandpa', text: '' }] }] });
  });

  it('lists the reactions with their lines and adds one said by the hero', () => {
    const doc = board();
    const hst = host(doc);
    const box = reactionsBlock(hst, board0(doc));
    expect(box.querySelector<HTMLInputElement>('[aria-label="Reaction 1 action"]')?.value).toBe('Push gnome');
    expect(box.querySelector<HTMLTextAreaElement>('.sbline textarea')?.value).toBe('It wobbles.');
    box.querySelector<HTMLButtonElement>('[aria-label="Delete reaction 1"]')?.click();
    expect(board0(doc).reactions).toEqual([]);
    adder(box, '+ reaction')?.click();
    expect(board0(doc).reactions).toEqual([{ action: '', lines: [{ who: 'hero', text: '' }] }]);
    expect(hst.calls).toEqual(['changed(structure)', 'focus(react.0)', 'changed(structure)']);
  });
});
