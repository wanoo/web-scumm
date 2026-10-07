// Small random games for the differential tests of the proof's abstractions (tests/audit.test.ts): a few rooms,
// items, flags and props, rules whose conditions and commands are drawn from the whole state-changing part of the DSL
// (negative `has`, consumption, transfers between two characters, counters, `once` / `nth` / `cycle`, nested `if`),
// and an ending somewhere. Deterministic: the same seed gives the same game. Many are unsolvable or have softlocks,
// which is the point: the abstractions must give the explicit search's verdict either way.
import type { Cmd, Cond, GameDef, Layout, RoomDef } from '@engine/core/types';

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
