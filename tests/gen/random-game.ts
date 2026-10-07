// Small random games for the differential tests of the proof's abstractions (tests/audit.test.ts): a few rooms,
// items, flags and props, rules whose conditions and commands are drawn from the whole state-changing part of the DSL
// (negative `has`, consumption, transfers between two characters, counters, `once` / `nth` / `cycle`, nested `if`),
// and an ending somewhere. Deterministic: the same seed gives the same game. Many are unsolvable or have softlocks,
// which is the point: the abstractions must give the explicit search's verdict either way.
import type { Cmd, Cond, GameDef, Layout, RoomDef } from '@engine/core/types';
import { must } from '@engine/core/must';

/** mulberry32: a tiny seeded generator, the same numbers on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

export interface RandomGameOptions {
  rooms?: number;
  items?: number;
  flags?: number;
  players?: 1 | 2 | 3;
  rules?: number;
  /**
   * Free items (the canonical owner's audit, 3.5): two characters, and every other item in no condition and lost or
   * moved only by an action on it, so a proof may pool who holds it (solve.ts `poolableItems`).
   */
  free?: boolean;
}

export function randomGame(
  seed: number,
  o: RandomGameOptions = {},
): { game: GameDef; layouts: Record<string, Layout> } {
  const r = rng(seed);
  const R = o.rooms ?? 2 + r.int(3),
    I = o.items ?? 2 + r.int(3),
    F = o.flags ?? 2 + r.int(3),
    P = o.free ? (o.players ?? 2) : (o.players ?? (r.chance(0.5) ? 2 : 1));
  const rooms = [...Array(R).keys()].map((i) => `room${i}`);
  const items = [...Array(I).keys()].map((i) => `item${i}`);
  const flags = [...Array(F).keys()].map((i) => `f${i}`);
  const players = ['ann', 'bob', 'cid'].slice(0, P);
  const spots = (i: number) => [`spot${i}a`, `spot${i}b`];
  // With `free`: the odd items are free (no condition reads them), the even ones stay as before.
  const isFree = (it: string) => !!o.free && Number(it.slice(4)) % 2 === 1;
  const bound = items.filter((it) => !isFree(it));
  const anyItem = () => r.pick(items);
  const boundItem = () => (bound.length ? r.pick(bound) : r.pick(items));

  const atom = (room: number): Cond => {
    switch (r.int(9)) {
      case 0:
        return r.pick(flags);
      case 1:
        return `!${r.pick(flags)}`;
      case 2:
        return o.free && !bound.length ? r.pick(flags) : { has: o.free ? boundItem() : r.pick(items) };
      case 3:
        return o.free && !bound.length ? `!${r.pick(flags)}` : { not: { has: o.free ? boundItem() : r.pick(items) } };
      case 4:
        return { prop: [spots(room)[0], r.pick(['open', 'shut'])] };
      case 5:
        return { flag: 'n', lt: 2 };
      case 6:
        return { visited: r.pick(rooms) };
      case 7:
        return P > 1 ? { player: r.pick(players) } : { flag: 'n', gte: 1 };
      default:
        return { flag: r.pick(flags), eq: true };
    }
  };
  const cond = (room: number, depth = 0): Cond | undefined => {
    const k = r.int(depth ? 3 : 6);
    if (k === 0) return undefined;
    if (k === 4 && depth < 1) return { all: [cond(room, 1) ?? atom(room), atom(room)] };
    if (k === 5 && depth < 1) return { any: [atom(room), atom(room)] };
    return atom(room);
  };
  let onceId = 0;
  const cmd = (room: number, depth = 0, acting?: string): Cmd => {
    switch (r.int(depth ? 9 : 13)) {
      case 0:
        return { gain: anyItem() };
      case 1:
        return { lose: o.free ? (acting && isFree(acting) && r.chance(0.5) ? acting : boundItem()) : r.pick(items) };
      case 2:
        return { set: r.pick(flags) };
      case 3:
        return { unset: r.pick(flags) };
      case 4:
        return { prop: [spots(room)[0], r.pick(['open', 'shut'])] };
      case 5:
        return { used: r.pick(items) };
      case 6:
        return P > 1 ? { transfer: [o.free ? boundItem() : r.pick(items), r.pick(players)] } : { set: r.pick(flags) };
      case 7:
        return { if: { flag: 'n', lt: 2 }, then: [{ inc: 'n' }] };
      case 8:
        return `A line in room ${room}.`;
      case 9:
        return { if: atom(room), then: [cmd(room, 1, acting)], else: [cmd(room, 1, acting)] };
      case 10:
        return { once: [cmd(room, 1, acting), cmd(room, 1, acting)], id: `once${onceId++}` };
      case 11:
        return { nth: [[cmd(room, 1, acting)], [cmd(room, 1, acting)]], id: `nth${onceId++}` };
      default:
        return { cycle: [[cmd(room, 1, acting)], [cmd(room, 1, acting)]], id: `cycle${onceId++}` };
    }
  };
  const roomDefs: RoomDef[] = rooms.map((id, i) => {
    const [a, b] = spots(i);
    const on: NonNullable<RoomDef['on']> = [];
    const n = o.rules ?? 2 + r.int(3);
    for (let k = 0; k < n; k++) {
      const useItem = r.chance(o.free ? 0.6 : 0.4);
      const it = useItem ? r.pick(items) : undefined;
      on.push({
        verb: useItem ? 'use' : r.pick(['take', 'look'] as const),
        a: it ?? r.pick([a, b]),
        ...(useItem ? { b: r.pick([a, b]) } : {}),
        if: cond(i),
        do: [cmd(i, 0, it), ...(r.chance(0.5) ? [cmd(i, 0, it)] : [])],
      });
    }
    // Every item can be found somewhere, once.
    items.forEach((it, j) => {
      if (j % R === i)
        on.push({
          verb: 'take',
          a: b,
          if: isFree(it) ? `!took_${it}` : { all: [`!took_${it}`, { not: { has: it } }] },
          do: [{ gain: it }, { set: `took_${it}` }],
        });
    });
    if (i === R - 1) on.push({ verb: 'use', a: a, if: cond(i) ?? r.pick(flags), do: [{ end: true }] });
    const exits: NonNullable<RoomDef['exits']> = {};
    if (i + 1 < R) exits.next = { name: 'next', to: rooms[i + 1], ...(r.chance(0.5) ? { if: atom(i) } : {}) };
    if (i > 0) exits.back = { name: 'back', to: rooms[i - 1] };
    return {
      id,
      name: `Room ${i}`,
      decor: `d/${id}`,
      hotspots: { [a]: { name: a }, [b]: { name: b } },
      look: { [a]: `A ${a}.`, [b]: `A ${b}.` },
      props: {},
      on,
      exits,
    };
  });
  const game: GameDef = {
    id: `gen${seed}`,
    title: `Generated ${seed}`,
    saveVersion: 1,
    hero: 'ann',
    ...(P > 1
      ? {
          players: {
            ids: players,
            start: { bob: { room: rooms[R - 1] }, ...(P > 2 ? { cid: { room: rooms[Math.floor(R / 2)] } } : {}) },
          },
        }
      : {}),
    verbs: [
      { id: 'look', label: 'Look', color: '#fff' },
      { id: 'take', label: 'Take', color: '#fff' },
      { id: 'use', label: 'Use', color: '#fff', join: 'with' },
      { id: 'give', label: 'Give', color: '#fff', join: 'to' },
    ],
    characters: Object.fromEntries(players.map((p) => [p, { name: p, color: '#fff', sprites: { idle: [`${p}/1`] } }])),
    items: Object.fromEntries(items.map((it) => [it, { name: it, icon: `i/${it}`, look: `A ${it}.` }])),
    rooms: roomDefs,
    rules: { fallbacks: { look: ['Nothing.'], take: ['No.'], use: ['No.'], give: ['No.'], use2: ['No.'] } },
    start: { room: rooms[0] },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
  const layouts = Object.fromEntries(rooms.map((id) => [id, { entries: { default: [320, 360] } } as Layout]));
  return { game, layouts };
}

/**
 * The reference matrix of 4.1.13 "Solver Research" (docs/dev/PROOF-MATRIX.md): one family of games, open to three
 * playable characters. `characters: 3` and `rooms: [20, 40]` are the family's two parameters; the seed draws the
 * rest. The rooms are a chain cut in three zones, one per character (ann, bob, cid), each starting in its own zone.
 * Locks close the way every few rooms; their keys lie earlier in the zone or in the zone before (a crossed puzzle:
 * the key has to reach the next character, through a pneumatic tube or, in the open variant, by walking over and
 * giving it). In each zone a keeper answers two topics (the second one gives the code a lock of the zone reads), a
 * bell rings by itself (a room script emits an event, a listener of the game sets the flag a key's drawer reads), and
 * trinkets that no condition reads go from hand to hand. A furnace destroys whatever is put in it: some instances
 * burn a key the game needs (a real softlock), others only a trinket. The ending needs the seals of the three zones.
 * `open: false` (constrained): walls between the zones, the tubes are the only way across. `open: true`: doors between
 * the zones, so the characters can meet; the tubes stay.
 */
export interface MatrixOptions {
  characters?: 3;
  /** The number of rooms, or the range the seed draws it from (both ends included). */
  rooms?: number | [number, number];
  open?: boolean;
}

/**
 * The twelve instances of the matrix (frozen with docs/dev/PROOF-MATRIX.md: change both, with a LOG entry), and the
 * verdict each one is expected to get: the 4.1.8 proof's within the budget, `unknown` where it did not finish.
 */
export const MATRIX: readonly {
  id: string;
  seed: number;
  open: boolean;
  expected: 'proved' | 'softlock' | 'unsolvable' | 'unknown';
}[] = [
  { id: 'c11', seed: 11, open: false, expected: 'proved' },
  { id: 'c12', seed: 12, open: false, expected: 'softlock' },
  { id: 'c13', seed: 13, open: false, expected: 'softlock' },
  { id: 'c14', seed: 14, open: false, expected: 'proved' },
  { id: 'c15', seed: 15, open: false, expected: 'proved' },
  { id: 'c16', seed: 16, open: false, expected: 'softlock' },
  { id: 'o21', seed: 21, open: true, expected: 'proved' },
  { id: 'o22', seed: 22, open: true, expected: 'unknown' },
  { id: 'o23', seed: 23, open: true, expected: 'unknown' },
  { id: 'o24', seed: 24, open: true, expected: 'unknown' },
  { id: 'o25', seed: 25, open: true, expected: 'unknown' },
  { id: 'o26', seed: 26, open: true, expected: 'softlock' },
];

export function matrixGame(
  seed: number,
  o: MatrixOptions = {},
): { game: GameDef; layouts: Record<string, Layout>; rooms: number; softlock: boolean } {
  const r = rng(seed * 7919 + 13);
  const span = o.rooms ?? [20, 40];
  const R = typeof span === 'number' ? span : span[0] + r.int(span[1] - span[0] + 1);
  const open = !!o.open;
  const players = ['ann', 'bob', 'cid'];
  const zoneStart = [0, Math.floor(R / 3), Math.floor((2 * R) / 3)];
  const zoneOf = (i: number) => (i >= zoneStart[2] ? 2 : i >= zoneStart[1] ? 1 : 0);
  const zoneEnd = (z: number) => (z < 2 ? zoneStart[z + 1] - 1 : R - 1);
  const rid = (i: number) => `room${i}`;
  const rooms: RoomDef[] = [...Array(R).keys()].map((i) => ({
    id: rid(i),
    name: `Room ${i}`,
    decor: `d/${rid(i)}`,
    hotspots: { crate: { name: 'crate' } },
    look: { crate: 'A crate.' },
    props: {},
    on: [],
    exits: {},
  }));
  const room = (i: number) => must(rooms[i], 'matrix room');
  const spot = (i: number, id: string) => {
    room(i).hotspots![id] = { name: id };
    room(i).look![id] = `A ${id}.`;
  };
  const items: GameDef['items'] = {};
  const item = (id: string) => (items[id] = { name: id, icon: `i/${id}`, look: `A ${id}.` });
  const characters: GameDef['characters'] = Object.fromEntries(
    players.map((p) => [p, { name: p, color: '#fff', sprites: { idle: [`${p}/1`] } }]),
  );
  const events: NonNullable<GameDef['events']> = [];
  // Locks: every 3 or 4 rooms of a zone, the way on needs a key used on the door (and, for one lock per zone, the
  // keeper's code). The key lies earlier in the same zone, or in the zone before (crossed).
  for (let z = 0; z < 3; z++) {
    const s = zoneStart[z],
      e = zoneEnd(z);
    const step = 3 + r.int(2);
    let coded = false;
    for (let i = s + step - 1; i < e; i += step) {
      const key = `key${i}`;
      item(key);
      // Where the key lies: the zone before for some locks (a crossed puzzle), else a room of this zone before the lock.
      const cross = z > 0 && r.chance(0.4);
      const at = cross ? zoneStart[z - 1] + r.int(zoneEnd(z - 1) - zoneStart[z - 1] + 1) : s + r.int(i - s + 1);
      spot(at, `drawer_${key}`);
      // One drawer per zone opens only once the zone's bell has rung (the script and its event).
      const bell = !cross && r.chance(0.3) ? `rang${z}` : undefined;
      room(at).on!.push({
        verb: 'take',
        a: `drawer_${key}`,
        if: bell ? { all: [`!took_${key}`, bell] } : `!took_${key}`,
        do: [{ gain: key }, { set: `took_${key}` }],
      });
      spot(i, `door${i}`);
      const code = !coded && r.chance(0.5) ? `code${z}` : undefined;
      if (code) coded = true;
      room(i).on!.push({
        verb: 'use',
        a: key,
        b: `door${i}`,
        if: code ? { all: [`!open${i}`, code] } : `!open${i}`,
        do: [{ lose: key }, { set: `open${i}` }],
      });
      room(i).exits!.next = { name: 'next', to: rid(i + 1), if: `open${i}` };
    }
    // The zone's keeper: two topics, the second one gives the code. It stands before the zone's first lock, as does
    // the bell: both are within reach of the character who needs them.
    const k = s + r.int(Math.min(step, e - s + 1));
    const keeper = `keeper${z}`;
    characters[keeper] = { name: keeper, color: '#0f0', room: rid(k), sprites: { idle: [`${keeper}/1`] } };
    room(k).actors = { [keeper]: { char: keeper } };
    room(k).look![keeper] = `The ${keeper}.`;
    room(k).talk = {
      [keeper]: [
        { topic: 'Hello?', if: `!met${z}`, do: [{ say: [keeper, 'Hello.'] }, { set: `met${z}` }] },
        {
          topic: 'The code?',
          if: { all: [`met${z}`, `!code${z}`] },
          do: [{ say: [keeper, 'Here.'] }, { set: `code${z}` }],
        },
      ],
    };
    // The zone's bell: a script of one room rings once, a listener of the game remembers it.
    const b = s + r.int(Math.min(step, e - s + 1));
    room(b).scripts = [{ id: `bell${z}`, do: [{ wait: 3000 }, { emit: `bell${z}` }] }];
    events.push({ on: `bell${z}`, once: true, do: [{ set: `rang${z}` }] });
    // The zone's seal, at its far end: the ending needs the three.
    spot(e, `seal${z}`);
    room(e).on!.push({ verb: 'take', a: `seal${z}`, if: `!sealed${z}`, do: [{ set: `sealed${z}` }] });
  }
  // The trinkets: taken once, read by nothing, carried and given freely (the canonical owner's ground).
  const trinkets = 2 + r.int(3);
  for (let t = 0; t < trinkets; t++) {
    const id = `trinket${t}`;
    item(id);
    const at = r.int(R);
    spot(at, `shelf${t}`);
    room(at).on!.push({ verb: 'take', a: `shelf${t}`, if: `!took_${id}`, do: [{ gain: id }, { set: `took_${id}` }] });
  }
  // The furnace: destroys what goes in. Half the instances can burn a key the game needs.
  const burnsKey = r.chance(0.5) && Object.keys(items).some((i) => i.startsWith('key'));
  const furnaceAt = r.int(R);
  spot(furnaceAt, 'furnace');
  const burnable = Object.keys(items).filter((i) => (burnsKey ? true : i.startsWith('trinket')));
  for (const it of burnable)
    room(furnaceAt).on!.push({ verb: 'use', a: it, b: 'furnace', do: [{ lose: it }, `The ${it} burns.`] });
  // A pneumatic tube at the end of each zone sends anything to the next character (the last zone's back to ann).
  for (let z = 0; z < 3; z++) {
    const e = zoneEnd(z);
    spot(e, 'tube');
    for (const it of Object.keys(items))
      room(e).on!.push({ verb: 'use', a: it, b: 'tube', do: [{ transfer: [it, must(players[(z + 1) % 3], 'next')] }] });
  }
  // Decor: a few looks that set flags nothing reads, and repeated lines.
  for (let i = 0; i < R; i++)
    if (r.chance(0.4))
      room(i).on!.push({ verb: 'look', a: 'crate', if: `!peek${i}`, do: [{ set: `peek${i}` }, 'Dust.'] });
  // The chain: back everywhere; forward between the zones only in the open variant (a lock-free door).
  for (let i = 0; i < R; i++) {
    if (i > 0 && (open || zoneOf(i - 1) === zoneOf(i))) room(i).exits!.back = { name: 'back', to: rid(i - 1) };
    if (i + 1 < R && !room(i).exits!.next && (open || zoneOf(i + 1) === zoneOf(i)))
      room(i).exits!.next = { name: 'next', to: rid(i + 1) };
  }
  // The ending: the altar of the last room, once the three seals are taken.
  spot(R - 1, 'altar');
  room(R - 1).on!.push({
    verb: 'use',
    a: 'altar',
    if: { all: ['sealed0', 'sealed1', 'sealed2'] },
    do: [{ end: true }],
  });
  const game: GameDef = {
    id: `matrix${seed}`,
    title: `Matrix ${seed}${open ? ' (open)' : ''}`,
    saveVersion: 1,
    hero: 'ann',
    players: {
      ids: players,
      start: { bob: { room: rid(must(zoneStart[1], 'zone')) }, cid: { room: rid(must(zoneStart[2], 'zone')) } },
    },
    verbs: [
      { id: 'look', label: 'Look', color: '#fff' },
      { id: 'take', label: 'Take', color: '#fff' },
      { id: 'use', label: 'Use', color: '#fff', join: 'with' },
      { id: 'give', label: 'Give', color: '#fff', join: 'to' },
      { id: 'talk', label: 'Talk', color: '#fff' },
    ],
    characters,
    items,
    rooms,
    events,
    rules: {
      fallbacks: { look: ['Nothing.'], take: ['No.'], use: ['No.'], give: ['No.'], talk: ['...'], use2: ['No.'] },
    },
    start: { room: rid(0) },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
  const layouts = Object.fromEntries(
    rooms.map((x) => [
      x.id,
      {
        entries: { default: [320, 360] },
        actors: Object.fromEntries(Object.keys(x.actors ?? {}).map((a) => [a, { x: 200, y: 330, h: 100 }])),
      } as Layout,
    ]),
  );
  return { game, layouts, rooms: R, softlock: burnsKey };
}
