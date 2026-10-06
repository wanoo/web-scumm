// Every branch of the condition evaluator, its explanation, and the flags and atoms it reads (core/cond.ts).
import { describe, expect, it } from 'vitest';
import { check, condAtoms, condFlags, explainCond } from '@engine/core/cond';
import type { Cond, GameState } from '@engine/core/types';

const state = (over: Partial<GameState> = {}): GameState => ({
  v: 1,
  room: 'hall',
  inventory: ['key'],
  flags: { lit: true, zero: 0, n: 3, word: 'yes', off: false },
  props: { 'hall.door': 'open', 'cellar.box': 'shut' },
  actors: {},
  hero: {},
  unlocked: ['park'],
  visited: { hall: 2, attic: 0 },
  counters: {},
  seen: { 'topic.t1': 1 },
  started: 0,
  ...over,
});

describe('check', () => {
  const s = state();
  it('holds for no condition', () => {
    expect(check(undefined, s)).toBe(true);
  });
  it('reads a flag by name, and its negation', () => {
    expect(check('lit', s)).toBe(true);
    expect(check('off', s)).toBe(false);
    expect(check('missing', s)).toBe(false);
    expect(check('!lit', s)).toBe(false);
    expect(check('!off', s)).toBe(true);
    expect(check('!missing', s)).toBe(true);
  });
  it('reads the bag', () => {
    expect(check({ has: 'key' }, s)).toBe(true);
    expect(check({ has: 'coin' }, s)).toBe(false);
  });
  it('compares a flag with eq, gte, lt, or tests it', () => {
    expect(check({ flag: 'n', eq: 3 }, s)).toBe(true);
    expect(check({ flag: 'n', eq: 4 }, s)).toBe(false);
    expect(check({ flag: 'word', eq: 'yes' }, s)).toBe(true);
    expect(check({ flag: 'n', eq: '3' }, s)).toBe(false);
    // eq present but undefined falls through to the other comparisons
    expect(check({ flag: 'n', eq: undefined, gte: 3 }, s)).toBe(true);
    expect(check({ flag: 'n', eq: undefined }, s)).toBe(true);
    expect(check({ flag: 'zero', eq: undefined }, s)).toBe(false);
    expect(check({ flag: 'n', gte: 3 }, s)).toBe(true);
    expect(check({ flag: 'n', gte: 4 }, s)).toBe(false);
    expect(check({ flag: 'word', gte: 0 }, s)).toBe(false);
    expect(check({ flag: 'n', lt: 4 }, s)).toBe(true);
    expect(check({ flag: 'n', lt: 3 }, s)).toBe(false);
    expect(check({ flag: 'word', lt: 0 }, s)).toBe(true);
    expect(check({ flag: 'missing', lt: 0 }, s)).toBe(true);
    expect(check({ flag: 'lit' }, s)).toBe(true);
    expect(check({ flag: 'zero' }, s)).toBe(false);
    expect(check({ flag: 'missing' }, s)).toBe(false);
  });
  it('combines with not, all, any', () => {
    expect(check({ not: 'lit' }, s)).toBe(false);
    expect(check({ not: 'off' }, s)).toBe(true);
    expect(check({ all: ['lit', { has: 'key' }] }, s)).toBe(true);
    expect(check({ all: ['lit', 'off'] }, s)).toBe(false);
    expect(check({ all: [] }, s)).toBe(true);
    expect(check({ any: ['off', 'lit'] }, s)).toBe(true);
    expect(check({ any: ['off', 'missing'] }, s)).toBe(false);
    expect(check({ any: [] }, s)).toBe(false);
  });
  it('passes the room down through not, all and any', () => {
    expect(check({ not: { prop: ['box', 'shut'] } }, s, 'cellar')).toBe(false);
    expect(check({ all: [{ prop: ['box', 'shut'] }] }, s, 'cellar')).toBe(true);
    expect(check({ any: [{ prop: ['box', 'shut'] }] }, s, 'cellar')).toBe(true);
    expect(check({ any: [{ prop: ['box', 'shut'] }] }, s)).toBe(false);
  });
  it('reads visits, the current room, unlocked places and seen topics', () => {
    expect(check({ visited: 'hall' }, s)).toBe(true);
    expect(check({ visited: 'attic' }, s)).toBe(false);
    expect(check({ visited: 'nowhere' }, s)).toBe(false);
    expect(check({ room: 'hall' }, s)).toBe(true);
    expect(check({ room: 'attic' }, s)).toBe(false);
    expect(check({ unlocked: 'park' }, s)).toBe(true);
    expect(check({ unlocked: 'zoo' }, s)).toBe(false);
    expect(check({ seen: 'topic.t1' }, s)).toBe(true);
    expect(check({ seen: 'topic.t2' }, s)).toBe(false);
  });
  it('reads a prop in the current room, a given room, or a prefixed one', () => {
    expect(check({ prop: ['door', 'open'] }, s)).toBe(true);
    expect(check({ prop: ['door', 'shut'] }, s)).toBe(false);
    expect(check({ prop: ['box', 'shut'] }, s)).toBe(false);
    expect(check({ prop: ['box', 'shut'] }, s, 'cellar')).toBe(true);
    expect(check({ prop: ['cellar.box', 'shut'] }, s, 'hall')).toBe(true);
    expect(check({ prop: ['cellar.box', 'open'] }, s)).toBe(false);
  });
  it('reads where a character is and who is playing', () => {
    expect(check({ actorIn: ['ann', 'hall'] }, s)).toBe(false);
    const w = state({ where: { ann: 'hall' }, active: 'bea' });
    expect(check({ actorIn: ['ann', 'hall'] }, w)).toBe(true);
    expect(check({ actorIn: ['ann', 'attic'] }, w)).toBe(false);
    expect(check({ player: 'bea' }, w)).toBe(true);
    expect(check({ player: 'ann' }, w)).toBe(false);
    expect(check({ player: 'ann' }, s)).toBe(false);
  });
  it('is false for an unknown shape', () => {
    expect(check({ weird: 1 } as unknown as Cond, s)).toBe(false);
  });
});

describe('explainCond', () => {
  const s = state({ where: { ann: 'hall' }, active: 'bea' });
  it('explains every kind of condition with its current value', () => {
    expect(explainCond(undefined, s)).toEqual({ text: 'always', ok: true });
    expect(explainCond('!off', s)).toEqual({ text: 'flag off is false', ok: true });
    expect(explainCond('!lit', s)).toEqual({ text: 'flag lit is false', ok: false });
    expect(explainCond('lit', s)).toEqual({ text: 'flag lit is true (true)', ok: true });
    expect(explainCond('missing', s)).toEqual({ text: 'flag missing is true (false)', ok: false });
    expect(explainCond({ has: 'key' }, s)).toEqual({ text: 'has key', ok: true });
    expect(explainCond({ has: 'coin' }, s)).toEqual({ text: 'has coin', ok: false });
    expect(explainCond({ flag: 'word', eq: 'yes' }, s)).toEqual({ text: 'flag word = "yes" ("yes")', ok: true });
    expect(explainCond({ flag: 'n', gte: 2 }, s)).toEqual({ text: 'flag n ≥ 2 (3)', ok: true });
    expect(explainCond({ flag: 'n', lt: 2 }, s)).toEqual({ text: 'flag n < 2 (3)', ok: false });
    expect(explainCond({ flag: 'lit' }, s)).toEqual({ text: 'flag lit is true (true)', ok: true });
    expect(explainCond({ flag: 'missing' }, s)).toEqual({ text: 'flag missing is true (null)', ok: false });
    expect(explainCond({ visited: 'hall' }, s)).toEqual({ text: 'visited hall', ok: true });
    expect(explainCond({ room: 'attic' }, s)).toEqual({ text: 'in room attic (now hall)', ok: false });
    expect(explainCond({ unlocked: 'park' }, s)).toEqual({ text: 'unlocked park', ok: true });
    expect(explainCond({ seen: 'topic.t2' }, s)).toEqual({ text: 'seen topic.t2', ok: false });
    expect(explainCond({ actorIn: ['ann', 'hall'] }, s)).toEqual({ text: 'ann in hall (now hall)', ok: true });
    expect(explainCond({ actorIn: ['bob', 'hall'] }, s)).toEqual({ text: 'bob in hall (now ?)', ok: false });
    expect(explainCond({ actorIn: ['ann', 'hall'] }, state())).toEqual({ text: 'ann in hall (now ?)', ok: false });
    expect(explainCond({ player: 'bea' }, s)).toEqual({ text: 'player is bea (now bea)', ok: true });
    expect(explainCond({ player: 'bea' }, state())).toEqual({ text: 'player is bea (now ?)', ok: false });
    expect(explainCond({ weird: 1 } as unknown as Cond, s)).toEqual({ text: '{"weird":1}', ok: false });
  });
  it('labels eq even when it is undefined', () => {
    expect(explainCond({ flag: 'n', eq: undefined }, s)).toEqual({ text: 'flag n = undefined (3)', ok: true });
  });
  it('explains a prop in the current room, a given room, or a prefixed one', () => {
    expect(explainCond({ prop: ['door', 'open'] }, s)).toEqual({ text: 'prop door is open (now open)', ok: true });
    expect(explainCond({ prop: ['box', 'open'] }, s)).toEqual({ text: 'prop box is open (now ?)', ok: false });
    expect(explainCond({ prop: ['box', 'shut'] }, s, 'cellar')).toEqual({
      text: 'prop box is shut (now shut)',
      ok: true,
    });
    expect(explainCond({ prop: ['cellar.box', 'open'] }, s)).toEqual({
      text: 'prop cellar.box is open (now shut)',
      ok: false,
    });
  });
  it('explains not, all and any with their parts, passing the room down', () => {
    expect(explainCond({ not: 'lit' }, s)).toEqual({
      text: 'not',
      ok: false,
      parts: [{ text: 'flag lit is true (true)', ok: true }],
    });
    expect(explainCond({ all: ['lit', { has: 'coin' }] }, s)).toEqual({
      text: 'all of',
      ok: false,
      parts: [
        { text: 'flag lit is true (true)', ok: true },
        { text: 'has coin', ok: false },
      ],
    });
    expect(explainCond({ any: [{ prop: ['box', 'shut'] }] }, s, 'cellar')).toEqual({
      text: 'any of',
      ok: true,
      parts: [{ text: 'prop box is shut (now shut)', ok: true }],
    });
    expect(explainCond({ not: { prop: ['box', 'shut'] } }, s, 'cellar').parts?.[0]?.ok).toBe(true);
    expect(explainCond({ all: [{ prop: ['box', 'shut'] }] }, s, 'cellar').parts?.[0]?.ok).toBe(true);
  });
});

describe('condFlags', () => {
  it('lists the flags a condition reads, through not, all and any', () => {
    expect(condFlags(undefined)).toEqual(new Set());
    expect([...condFlags('!a')]).toEqual(['a']);
    expect([...condFlags('a')]).toEqual(['a']);
    expect([...condFlags({ flag: 'b', gte: 1 })]).toEqual(['b']);
    expect([...condFlags({ not: '!c' })]).toEqual(['c']);
    expect([...condFlags({ all: ['d', { has: 'x' }, { any: ['e', { not: { flag: 'f' } }] }] })]).toEqual([
      'd',
      'e',
      'f',
    ]);
    expect([...condFlags({ has: 'x' })]).toEqual([]);
  });
  it('adds to the given set', () => {
    const out = new Set(['z']);
    expect(condFlags('a', out)).toBe(out);
    expect([...out]).toEqual(['z', 'a']);
  });
});

describe('condAtoms', () => {
  it('is empty for no condition', () => {
    expect(condAtoms(undefined)).toEqual([]);
  });
  it('lists flags with their sign, flipped under not', () => {
    expect(condAtoms('a')).toEqual([{ kind: 'flag', id: 'a' }]);
    expect(condAtoms('!a')).toEqual([{ kind: 'flag', id: 'a', neg: true }]);
    expect(condAtoms({ not: 'a' })).toEqual([{ kind: 'flag', id: 'a', neg: true }]);
    expect(condAtoms({ not: '!a' })).toEqual([{ kind: 'flag', id: 'a' }]);
    expect(condAtoms({ not: { not: { has: 'k' } } })).toEqual([{ kind: 'has', id: 'k' }]);
  });
  it('details flag comparisons', () => {
    expect(condAtoms({ flag: 'n', eq: 2 })).toEqual([{ kind: 'flag', id: 'n', detail: '= 2' }]);
    expect(condAtoms({ flag: 'n', eq: 'x' })).toEqual([{ kind: 'flag', id: 'n', detail: '= "x"' }]);
    expect(condAtoms({ flag: 'n', gte: 2 })).toEqual([{ kind: 'flag', id: 'n', detail: '≥ 2' }]);
    expect(condAtoms({ flag: 'n', lt: 2 })).toEqual([{ kind: 'flag', id: 'n', detail: '< 2' }]);
    expect(condAtoms({ flag: 'n' })).toEqual([{ kind: 'flag', id: 'n', detail: undefined }]);
    expect(condAtoms({ not: { flag: 'n' } })).toEqual([{ kind: 'flag', id: 'n', detail: undefined, neg: true }]);
  });
  it('lists every other kind, negated under not', () => {
    const c: Cond = {
      all: [
        { has: 'k' },
        { visited: 'v' },
        { room: 'r' },
        { unlocked: 'u' },
        { seen: 's' },
        { actorIn: ['ann', 'hall'] },
        { player: 'bea' },
        { any: [{ not: { has: 'h' } }] },
        { weird: 1 } as unknown as Cond,
      ],
    };
    expect(condAtoms(c)).toEqual([
      { kind: 'has', id: 'k' },
      { kind: 'visited', id: 'v' },
      { kind: 'room', id: 'r' },
      { kind: 'unlocked', id: 'u' },
      { kind: 'seen', id: 's' },
      { kind: 'actorIn', id: 'ann@hall' },
      { kind: 'player', id: 'bea' },
      { kind: 'has', id: 'h', neg: true },
    ]);
    expect(condAtoms({ not: { all: [{ seen: 's' }, { any: [{ room: 'r' }] }] } })).toEqual([
      { kind: 'seen', id: 's', neg: true },
      { kind: 'room', id: 'r', neg: true },
    ]);
  });
  it('prefixes an unprefixed prop with the given room only', () => {
    expect(condAtoms({ prop: ['door', 'open'] }, 'hall')).toEqual([{ kind: 'prop', id: 'hall.door', detail: 'open' }]);
    expect(condAtoms({ prop: ['door', 'open'] })).toEqual([{ kind: 'prop', id: 'door', detail: 'open' }]);
    expect(condAtoms({ prop: ['cellar.box', 'shut'] }, 'hall')).toEqual([
      { kind: 'prop', id: 'cellar.box', detail: 'shut' },
    ]);
    expect(condAtoms({ all: [{ prop: ['door', 'open'] }] }, 'hall')[0]?.id).toBe('hall.door');
  });
  it('appends to the given list', () => {
    const out = [{ kind: 'seen' as const, id: 'x' }];
    expect(condAtoms('a', undefined, out)).toBe(out);
    expect(out).toHaveLength(2);
    expect(condAtoms({ has: 'k' }, undefined, [], true)).toEqual([{ kind: 'has', id: 'k', neg: true }]);
  });
});
