// The puzzle graph (src/engine/tools/puzzle.ts): what each action needs and changes, derived from the content.
import { describe, expect, it } from 'vitest';
import { condAtoms } from '@engine/core/cond';
import { findNode, puzzleFor, puzzleGraph, puzzleIssues, puzzleMarkdown, toPuzzleDot, toPuzzleSvg } from '@engine/tools/puzzle';
import { validate } from '@engine/tools/validate';
import { grog, grogLayouts, mansion, stan } from './fixtures/classics';
import { scale } from './fixtures/scale';

describe('condAtoms', () => {
  it('lists what a condition reads, with negations', () => {
    expect(condAtoms({ all: ['a', '!b', { not: { has: 'key' } }, { flag: 'n', gte: 2 }, { prop: ['door', 'open'] }, { actorIn: ['cook', 'hall'] }] }, 'kitchen')).toEqual([
      { kind: 'flag', id: 'a' }, { kind: 'flag', id: 'b', neg: true }, { kind: 'has', id: 'key', neg: true },
      { kind: 'flag', id: 'n', detail: '≥ 2' }, { kind: 'prop', id: 'kitchen.door', detail: 'open' }, { kind: 'actorIn', id: 'cook@hall' },
    ]);
    expect(condAtoms({ not: '!x' })).toEqual([{ kind: 'flag', id: 'x' }]);
  });
});

describe('the puzzle graph', () => {
  it('links items, flags and actions', () => {
    const g = puzzleGraph(grog());
    const mug = puzzleFor(g, 'mug_grog')!;
    expect(mug.node).toMatchObject({ kind: 'item', label: 'mug of grog' });
    expect(mug.acquiredBy.map((a) => a.action.label).sort()).toEqual(['use barrel', 'use mug_holey + barrel']);
    expect(mug.consumedBy.map((a) => a.action.label).sort()).toEqual(['script mug_melts', 'use mug_grog + lock']);
    expect(mug.usedBy.map((u) => u.action.label)).toContain('use mug_grog + lock');
    expect(mug.unlocks.map((n) => n.id)).toEqual(expect.arrayContaining(['flag:free', 'end:end', 'item:mug_holey']));
    expect(findNode(g, 'item:mug_holey')).toBeDefined();
    expect(puzzleFor(g, 'nothing')).toBeUndefined();
    // the script's while is a gate, its effects are effects
    expect(g.edges).toContainEqual({ from: 'item:mug_grog', to: 'script:mug_melts', kind: 'requires' });
    expect(g.edges).toContainEqual({ from: 'script:mug_melts', to: 'item:mug_holey', kind: 'produces' });
  });

  it('sees events, moved characters, counters and goals', () => {
    const g = puzzleGraph(mansion());
    expect(g.edges).toContainEqual({ from: 'script:edna_patrols', to: 'event:edna_moved', kind: 'produces' });
    expect(g.edges).toContainEqual({ from: 'event:edna_moved', to: 'listener:game/events[0]', kind: 'requires' });
    expect(g.edges).toContainEqual({ from: 'actor:edna@hall', to: 'rule:hall/enter', kind: 'reads' });
    const s = puzzleGraph(stan());
    expect(s.edges).toContainEqual({ from: 'rule:game/start', to: 'flag:price', kind: 'produces', detail: '= 8000' });
    expect(s.edges.filter((e) => e.to === 'flag:price' && e.kind === 'produces').map((e) => e.detail)).toContain('-1000');
    const sc = puzzleGraph(scale());
    expect(sc.nodes.some((n) => n.kind === 'goal')).toBe(true);
  });

  it('renders as SVG, DOT and Markdown', () => {
    const g = puzzleGraph(grog());
    expect(toPuzzleSvg(g)).toContain('data-node="item:mug_grog"');
    expect(toPuzzleDot(g)).toContain('"item:mug_grog" -> "rule:jail/on[0]"');
    expect(puzzleMarkdown(g)).toContain('| item mug of grog |');
    expect(puzzleMarkdown(g, 'free')).toContain('**acquired by:** use mug_grog + lock (jail)');
    expect(puzzleMarkdown(g, 'nope')).toMatch(/^No item/);
  });

  it('finds the flag nobody can ever set, and the validator warns', () => {
    const g = grog();
    g.rooms[0].on!.push({ verb: 'use', a: 'door', if: 'locked', do: [{ set: 'locked' }] });
    expect(puzzleIssues(puzzleGraph(g)).selfLocked.map((n) => n.label)).toEqual(['locked']);
    expect(validate(g, grogLayouts).warnings.some((w) => /"locked" is only set by actions that already require it/.test(w))).toBe(true);
    expect(puzzleIssues(puzzleGraph(grog())).selfLocked).toEqual([]);
  });
});
