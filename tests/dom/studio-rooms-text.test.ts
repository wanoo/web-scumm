// The Rooms tab's model (src/studio/rooms-text.ts, 4.1.8): readable conditions and commands, an entity's name and
// whether it is clickable, the value at a content path. Pure: no DOM, no backend.
import { describe, expect, it } from 'vitest';
import type { Cmd, RoomDef } from '@engine/core/types';
import type { GameInfo } from '../../src/studio/api';
import {
  chipText,
  condText,
  entityDef,
  entityName,
  isInteractive,
  ruleHead,
  speaker,
  valueAt,
} from '../../src/studio/rooms-text';

const info: GameInfo = {
  id: 'g',
  title: 'G',
  rooms: [{ id: 'kitchen', name: 'Kitchen', decor: 'kitchen' }],
  characters: { lou: { name: 'Lou', color: '#f00' }, grandma: { name: 'Grandma', color: '#0f0' } },
  items: {},
  verbs: [
    { id: 'look', label: 'Look at', color: '#fff' },
    { id: 'use', label: 'Use', color: '#fff' },
  ],
  checkpoints: {},
  hero: 'lou',
  images: {},
};

const room: RoomDef = {
  id: 'kitchen',
  name: 'Kitchen',
  decor: 'kitchen',
  props: { piano: { name: 'piano' }, dust: {} },
  actors: { gm: { char: 'grandma' }, cat: { char: 'cat', name: 'Minou', interactive: false } },
  hotspots: { door: { name: 'door' } },
  on: [{ verb: 'use', a: 'key', b: 'door', do: [{ say: ['lou', 'Click.'] }] }],
};

describe('condText', () => {
  it('reads a flag, a negated flag and an item as words', () => {
    expect(condText(undefined)).toBe('');
    expect(condText('door_open')).toBe('door_open');
    expect(condText('!door_open')).toBe('not door_open');
    expect(condText({ has: 'key' })).toBe('has key');
  });

  it('joins all/any with and/or and wraps a not in parentheses', () => {
    expect(condText({ all: [{ has: 'key' }, 'awake'] })).toBe('has key and awake');
    expect(condText({ any: [{ visited: 'attic' }, { room: 'cellar' }] })).toBe('visited attic or in cellar');
    expect(condText({ not: { all: [{ has: 'key' }, { seen: 'intro' }] } })).toBe('not (has key and heard intro)');
  });

  it('reads a prop state, an unlocked place and a flag compared to a value', () => {
    expect(condText({ prop: ['door', 'open'] })).toBe('door is open');
    expect(condText({ unlocked: 'garden' })).toBe('garden unlocked');
    expect(condText({ flag: 'coins', eq: 3 })).toBe('coins = 3');
    expect(condText({ flag: 'coins', gte: 2 })).toBe('coins ≥ 2');
    expect(condText({ flag: 'coins', lt: 5 })).toBe('coins < 5');
    expect(condText({ flag: 'coins' })).toBe('coins set');
  });

  it('falls back to JSON for a shape it does not know', () => {
    expect(condText({ actorIn: ['gm', 'kitchen'] })).toBe('{"actorIn":["gm","kitchen"]}');
  });
});

describe('chipText', () => {
  it('shows the command, its value and the other fields in parentheses, without nested command lists', () => {
    expect(chipText({ give: 'key', to: 'grandma' } as unknown as Exclude<Cmd, string>)).toBe('give key (to grandma)');
    expect(chipText({ wait: 500 })).toBe('wait 500');
    expect(chipText({ minigame: 'lock', then: [{ say: ['lou', 'Done'] }] } as Exclude<Cmd, string>)).toBe(
      'minigame lock',
    );
  });

  it('drops a `true` value and cuts a long chip at 68 characters with an ellipsis', () => {
    expect(chipText({ pause: true } as unknown as Exclude<Cmd, string>)).toBe('pause');
    const long = chipText({ emit: 'x'.repeat(100) } as unknown as Exclude<Cmd, string>);
    expect(long).toHaveLength(69);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('ruleHead and speaker', () => {
  it('labels the verbs from the game and joins lists of targets', () => {
    expect(ruleHead(info, room.on![0]!)).toBe('Use key → door');
    expect(ruleHead(info, { verb: ['look', 'open'], a: ['door', 'gate'], do: [] })).toBe('Look at / open door / gate');
  });

  it('names the hero and a known character with its colour, and leaves an unknown id as is', () => {
    expect(speaker(info, 'hero')).toEqual({ label: 'Lou', color: '#f00' });
    expect(speaker(info, 'grandma')).toEqual({ label: 'Grandma', color: '#0f0' });
    expect(speaker(info, 'ghost')).toEqual({ label: 'ghost', color: undefined });
  });
});

describe('entities', () => {
  it("finds an entity's definition by kind, or nothing", () => {
    expect(entityDef(room, { kind: 'prop', id: 'piano' })).toEqual({ name: 'piano' });
    expect(entityDef(room, { kind: 'actor', id: 'piano' })).toBeUndefined();
    expect(entityDef(undefined, { kind: 'hotspot', id: 'door' })).toBeUndefined();
  });

  it("names an actor after its own name, then its character's, then its character id", () => {
    expect(entityName(room, info.characters, 'actor', 'gm')).toBe('Grandma');
    expect(entityName(room, info.characters, 'actor', 'cat')).toBe('Minou');
    expect(entityName({ ...room, actors: { x: { char: 'nobody' } } }, info.characters, 'actor', 'x')).toBe('nobody');
    expect(entityName(room, info.characters, 'prop', 'dust')).toBe('');
    expect(entityName(room, info.characters, 'hotspot', 'door')).toBe('door');
  });

  it('calls a hotspot, a named prop and a willing actor interactive, a nameless prop and a decor actor not', () => {
    expect(isInteractive(room, 'hotspot', 'door')).toBe(true);
    expect(isInteractive(room, 'prop', 'piano')).toBe(true);
    expect(isInteractive(room, 'prop', 'dust')).toBe(false);
    expect(isInteractive(room, 'actor', 'gm')).toBe(true);
    expect(isInteractive(room, 'actor', 'cat')).toBe(false);
  });

  it('reads the value at a content path, undefined past a missing segment', () => {
    expect(valueAt(room, 'on[0].do[0]')).toEqual({ say: ['lou', 'Click.'] });
    expect(valueAt(room, 'props.piano.name')).toBe('piano');
    expect(valueAt(room, 'talk.gm[0]')).toBeUndefined();
    expect(valueAt(undefined, 'name')).toBeUndefined();
  });
});
