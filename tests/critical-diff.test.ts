// The logical state, its flat lines, the diff and the digest of two states (core/diff.ts).
import { describe, expect, it } from 'vitest';
import { flatState, logicalState, stateDiff, stateDigest } from '@engine/core/diff';
import type { GameState } from '@engine/core/types';

const bare = (): GameState => ({
  v: 1,
  room: 'hall',
  inventory: [],
  flags: {},
  props: {},
  actors: {},
  hero: {},
  unlocked: [],
  visited: {},
  counters: {},
  seen: {},
  started: 0,
});

const full = (): GameState => ({
  ...bare(),
  inventory: ['b', 'a'],
  flags: { z: 1, a: 'x' },
  props: { 'hall.door': 'open' },
  actors: { 'hall.ann': { visible: false, x: 3 }, 'hall.bob': { x: 1 } },
  hero: { hall: [1, 2] },
  unlocked: ['q', 'p'],
  visited: { hall: 2 },
  counters: { c: 4 },
  seen: { y: 1, x: 1 },
  used: ['k', 'j'],
  where: { ann: 'hall' },
  scripts: { s1: { pc: 2 }, s2: { pc: 0, step: 's2.go', done: true, off: true } },
  active: 'bea',
  players: {
    ann: { room: 'cellar', inventory: ['n', 'm'], hero: {}, used: ['n'] },
    bob: { room: 'hall', inventory: [], hero: {} },
  },
  done: true,
  camera: { x: 5, follow: true },
});

describe('logicalState', () => {
  it('defaults the optional fields of a bare state', () => {
    expect(logicalState(bare())).toEqual({
      room: 'hall',
      inventory: [],
      flags: [],
      props: [],
      visible: [],
      unlocked: [],
      visited: [],
      counters: [],
      seen: [],
      used: [],
      where: [],
      scripts: [],
      active: '',
      players: [],
      done: false,
    });
  });
  it('sorts every field and keeps only what a replay must reproduce', () => {
    expect(logicalState(full())).toEqual({
      room: 'hall',
      inventory: ['a', 'b'],
      flags: [
        ['a', 'x'],
        ['z', 1],
      ],
      props: [['hall.door', 'open']],
      visible: [['hall.ann', false]],
      unlocked: ['p', 'q'],
      visited: [['hall', 2]],
      counters: [['c', 4]],
      seen: ['x', 'y'],
      used: ['j', 'k'],
      where: [['ann', 'hall']],
      scripts: [
        ['s1', 2, false, false],
        ['s2', 's2.go', true, true],
      ],
      active: 'bea',
      players: [
        ['ann', 'cellar', ['m', 'n'], ['n']],
        ['bob', 'hall', [], []],
      ],
      done: true,
    });
  });
  it('does not sort the state in place', () => {
    const s = full();
    logicalState(s);
    expect(s.inventory).toEqual(['b', 'a']);
  });
});

describe('flatState', () => {
  it('writes one line per key', () => {
    expect(flatState(bare())).toEqual({
      room: 'hall',
      inventory: '',
      unlocked: '',
      seen: '',
      used: '',
      active: '',
      done: 'false',
    });
    expect(flatState(full())).toEqual({
      room: 'hall',
      inventory: 'a,b',
      unlocked: 'p,q',
      seen: 'x,y',
      used: 'j,k',
      active: 'bea',
      done: 'true',
      'flags.a': '"x"',
      'flags.z': '1',
      'props.hall.door': 'open',
      'visible.hall.ann': 'false',
      'visited.hall': '2',
      'counters.c': '4',
      'where.ann': 'hall',
      'scripts.s1': '2',
      'scripts.s2': 's2.go done off',
      'players.ann': 'cellar [m,n] used n',
      'players.bob': 'hall []',
    });
  });
  it('marks a script that is only done, or only off', () => {
    const s = bare();
    s.scripts = { a: { pc: 1, done: true }, b: { pc: 1, off: true } };
    expect(flatState(s)).toMatchObject({ 'scripts.a': '1 done', 'scripts.b': '1 off' });
  });
});

describe('stateDiff and stateDigest', () => {
  it('lists the keys that differ, sorted, and ignores positions and camera', () => {
    const a = full(),
      b = full();
    b.hero.hall = [9, 9];
    b.camera = { x: 0, follow: false };
    b.started = 99;
    expect(stateDiff(a, b)).toEqual([]);
    b.flags.z = 2;
    b.inventory.push('c');
    delete b.flags.a;
    b.room = 'cellar';
    expect(stateDiff(a, b)).toEqual(['flags.a', 'flags.z', 'inventory', 'room']);
  });
  it('digests the logical state as 8 hex digits (FNV-1a)', () => {
    expect(stateDigest(bare())).toMatch(/^[0-9a-f]{8}$/);
    expect(stateDigest(bare())).toBe(stateDigest({ ...bare(), hero: { hall: [1, 1] }, started: 5 }));
    expect(stateDigest(bare())).not.toBe(stateDigest({ ...bare(), room: 'cellar' }));
    expect(stateDigest(full())).toBe(stateDigest(full()));
  });
  it('is FNV-1a over the JSON of the logical state, padded to 8 digits', () => {
    expect(stateDigest(bare())).toBe('70574c22');
    expect(stateDigest({ ...bare(), room: 'r10' })).toBe('03aa9d2c');
  });
});
