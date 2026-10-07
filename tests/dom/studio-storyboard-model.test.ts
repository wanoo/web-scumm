// The Storyboard tab's model (src/studio/storyboard-model.ts, 4.1.8): the pure rules the editor blocks and the tab
// share, run without a browser: normalisation of legacy fields, list moves, ids, speakers and coverage lookups.
import { describe, expect, it } from 'vitest';
import type { GameInfo } from '../../src/studio/api';
import {
  colorOf,
  duplicatePanel,
  findPanel,
  idProblem,
  move,
  nextBoardId,
  nextPanelId,
  normDoc,
  panelCov,
  panelIssues,
  panelList,
  speakerOptions,
  uniquePanelId,
} from '../../src/studio/storyboard-model';
import type { CoverageData } from '../../src/studio/api';

const info: GameInfo = {
  id: 'demo',
  title: 'Demo',
  rooms: [{ id: 'garden', name: 'The garden', decor: 'garden-decor' }],
  characters: {
    pixel: { name: 'Pixel', color: '#f80' },
    grandpa: { name: 'Grandpa', color: '#8cf' },
    cat: { name: 'cat', color: '#999' },
  },
  items: {},
  verbs: [],
  checkpoints: {},
  hero: 'pixel',
  images: {},
};

const legacy = () => ({
  title: 'Legacy',
  boards: [
    {
      id: 'garden',
      title: 'The garden',
      panels: [
        { id: 'garden-1', title: 'The pipe', lines: ['A pipe!', ['grandpa', 'Bring it back!']] },
        { lines: [{ who: 'stage', text: 'Night falls', mood: 'calm' }] },
      ],
      arrival: ['Hello garden'],
      talk: { grandpa: [{ q: 'The pipe?', answer: ['Mine.'] }] },
      optional: [['Push gnome', 'It wobbles.']],
    },
  ],
});

describe('normDoc', () => {
  it('normalises the lines of panels and arrivals to { who, text } and keeps the other fields of a line', () => {
    const doc = normDoc(legacy());
    const [b] = doc.boards;
    expect(b?.panels[0]?.lines).toEqual([
      { who: 'hero', text: 'A pipe!' },
      { who: 'grandpa', text: 'Bring it back!' },
    ]);
    expect(b?.panels[1]?.lines).toEqual([{ who: 'stage', text: 'Night falls', mood: 'calm' }]);
    expect(b?.arrival).toEqual([{ who: 'hero', text: 'Hello garden' }]);
    expect(doc.title).toBe('Legacy');
  });

  it('renames talk to talks and optional to reactions, normalising their content', () => {
    const doc = normDoc(legacy());
    const b = doc.boards[0] as unknown as Record<string, unknown>;
    expect(b.talk).toBeUndefined();
    expect(b.optional).toBeUndefined();
    expect(b.talks).toEqual({ grandpa: [{ topic: 'The pipe?', lines: [{ who: 'hero', text: 'Mine.' }] }] });
    expect(b.reactions).toEqual([{ action: 'Push gnome', lines: [{ who: 'hero', text: 'It wobbles.' }] }]);
  });

  it('gives a panel without id or title empty strings, and a document without boards an empty list', () => {
    expect(normDoc(legacy()).boards[0]?.panels[1]).toMatchObject({ id: '', title: '' });
    expect(normDoc(null).boards).toEqual([]);
    expect(normDoc({ boards: 'nope' }).boards).toEqual([]);
    expect(normDoc({ boards: [{ id: 'x', title: 'x' }] }).boards[0]?.panels).toEqual([]);
  });
});

describe('move', () => {
  it('swaps an item with its neighbour and reports it', () => {
    const list = ['a', 'b', 'c'];
    expect(move(list, 0, 1)).toBe(true);
    expect(list).toEqual(['b', 'a', 'c']);
    expect(move(list, 2, -1)).toBe(true);
    expect(list).toEqual(['b', 'c', 'a']);
  });

  it('refuses a move out of range and leaves the list as it was', () => {
    const list = ['a', 'b'];
    expect(move(list, 0, -1)).toBe(false);
    expect(move(list, 1, 1)).toBe(false);
    expect(list).toEqual(['a', 'b']);
  });
});

describe('ids', () => {
  const doc = normDoc({
    boards: [
      {
        id: 'board-1',
        title: 'A',
        panels: [
          { id: 'a-1', title: '' },
          { id: 'a-1-copy', title: '' },
        ],
      },
      { id: 'board-3', title: 'B', panels: [{ id: 'board-3-1', title: '' }] },
    ],
  });

  it('lists the panels in play order with their board, and finds one by id', () => {
    expect(panelList(doc)).toEqual([
      ['a-1', '', 'A'],
      ['a-1-copy', '', 'A'],
      ['board-3-1', '', 'B'],
    ]);
    expect(panelList(undefined)).toEqual([]);
    expect(findPanel(doc, 'board-3-1')).toEqual({ bi: 1, pi: 0 });
    expect(findPanel(doc, 'nope')).toBeUndefined();
  });

  it('picks ids nobody has for a new board, a new panel and a duplicated panel', () => {
    expect(nextBoardId(doc)).toBe('board-4');
    expect(nextPanelId(doc, doc.boards[1] as NonNullable<(typeof doc.boards)[0]>)).toBe('board-3-2');
    expect(uniquePanelId(doc, 'fresh')).toBe('fresh');
    expect(uniquePanelId(doc, 'a-1')).toBe('a-12');
    const copy = duplicatePanel(doc, { id: 'a-1', title: 'The pipe', lines: [{ who: 'hero', text: 'x' }] });
    expect(copy).toEqual({ id: 'a-1-copy2', title: 'The pipe (copy)', lines: [{ who: 'hero', text: 'x' }] });
  });

  it('refuses to save duplicated or empty panel ids with the message the toast shows', () => {
    expect(idProblem(doc)).toBeUndefined();
    expect(idProblem(normDoc({ boards: [{ panels: [{ id: 'a' }, { id: 'a' }] }] }))).toBe(
      'Two panels have the id "a": notes are attached to panel ids, make them unique.',
    );
    expect(idProblem(normDoc({ boards: [{ panels: [{ id: ' ' }] }] }))).toBe('A panel has no id.');
  });
});

describe('speakers and coverage', () => {
  it('offers the hero, the stage speakers, the other characters, and the current speaker when unknown', () => {
    expect(speakerOptions(info, 'grandpa')).toEqual([
      ['hero', 'hero (Pixel)'],
      ['action', 'action'],
      ['stage', 'stage'],
      ['grandpa', 'Grandpa (grandpa)'],
      ['cat', 'cat'],
    ]);
    expect(speakerOptions(info, 'ghost').at(-1)).toEqual(['ghost', 'ghost (unknown)']);
    expect(colorOf(info, 'hero')).toBe('#f80');
    expect(colorOf(info, 'stage')).toBeUndefined();
    expect(colorOf(info, 'ghost')).toBeUndefined();
  });

  it('finds a panel in the coverage and keeps only its checks that are not fully in the game', () => {
    const cov: CoverageData = {
      ms: 1,
      markdown: '',
      coverage: {
        score: 0.5,
        totals: { ok: 1, partial: 1, missing: 1, unknown: 0 },
        boards: [
          {
            id: 'garden',
            title: 'The garden',
            status: 'partial',
            score: 0.5,
            panels: [
              {
                id: 'garden-1',
                title: 'The pipe',
                status: 'partial',
                score: 0.5,
                action: { what: 'Pick up pipe', status: 'ok' },
                lines: [{ what: 'A pipe!', status: 'missing' }],
                sfx: [{ what: 'metal', status: 'partial', detail: 'close' }],
              },
            ],
          },
        ],
      } as CoverageData['coverage'],
    };
    const pc = panelCov(cov, 'garden-1');
    expect(pc?.title).toBe('The pipe');
    expect(panelCov(cov, 'nope')).toBeUndefined();
    expect(panelCov(null, 'garden-1')).toBeUndefined();
    expect(panelIssues(pc).map((x) => x.what)).toEqual(['A pipe!', 'metal']);
    expect(panelIssues(undefined)).toEqual([]);
  });
});
