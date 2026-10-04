// Mobility regions: the rooms a character can walk between without changing anything the solver reads. Moving inside
// a region is silent and reversible, so the proof keeps the region instead of the exact room, and offers the actions
// of every room of the region as macro steps ("Go to <room> › action", the route kept for the replay).
//
// A move is silent when it is a generated exit (`exits` in the content: a `goto` and maybe a sound) or a map trip,
// to a room without `onEnter`, whose `visited` count nothing reads, and when neither end is a room some condition
// names (`{ room }`, in the content, the invariants or the goal). The region is the strongly connected part of those
// moves around the character's room, under the conditions of its own view (its bag, the flags). The solver checks
// every hop it plays against this claim and falls back to exact rooms when one is not silent.
import { check, condAtoms } from '../core/cond';
import type { Cond, GameDef, GameState, Id, VerbId } from '../core/types';

export type Hop = { kind: 'exit'; from: Id; verb: VerbId; a: Id; to: Id } | { kind: 'map'; from: Id; place: Id; to: Id };

export interface MobilityModel {
  /** Rooms some condition names: never merged with another. */
  observed: Set<Id>;
  /** The silent moves out of `room` for this view. */
  hops(view: GameState, room: Id): Hop[];
  /** The region of the view's room, and the route to each of its rooms. */
  region(view: GameState): { rooms: Id[]; key: string; route: (to: Id) => Hop[] };
}

/** Every room a condition names, anywhere a condition can be (content, invariants, a goal). */
export function observedRooms(game: GameDef, extra: (Cond | undefined)[] = []): Set<Id> {
  const out = new Set<Id>();
  const fromCond = (c: unknown) => { for (const a of condAtoms(c as Cond)) if (a.kind === 'room') out.add(a.id); };
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'if' || k === 'visible' || k === 'until' || k === 'news' || k === 'goals') { if (Array.isArray(x) && k === 'goals') x.forEach(fromCond); else fromCond(x); }
      walk(x);
    }
  };
  walk(game);
  (game.invariants ?? []).forEach(fromCond);
  extra.forEach(fromCond);
  return out;
}

export function mobilityModel(game: GameDef, visitedRead: Set<string>, goal?: Cond[]): MobilityModel {
  const observed = observedRooms(game, goal ?? []);
  const rooms = new Map(game.rooms.map((r) => [r.id, r]));
  const silentTarget = (from: Id, to: Id) => from !== to && !observed.has(from) && !observed.has(to) && !rooms.get(to)?.onEnter?.length && !visitedRead.has(to) && rooms.has(to);
  // The generated exit rules of each room (normalizeExits): rule id `exit.<room>.<exit>.go`, do: [sfx?, { goto }].
  const exits = new Map<Id, { verb: VerbId; a: Id; to: Id; cond: Cond | undefined; visible: Cond | undefined }[]>();
  for (const r of game.rooms) {
    const list: { verb: VerbId; a: Id; to: Id; cond: Cond | undefined; visible: Cond | undefined }[] = [];
    for (const rule of r.on ?? []) {
      if (!rule.exit || !rule.id?.endsWith('.go')) continue;
      const go = rule.do.find((c) => typeof c !== 'string' && 'goto' in c) as { goto: Id } | undefined;
      const silent = rule.do.every((c) => typeof c !== 'string' && ('goto' in c || 'sfx' in c));
      if (!go || !silent) continue;
      const verb = (Array.isArray(rule.verb) ? rule.verb[0] : rule.verb) as VerbId;
      list.push({ verb, a: rule.exit, to: go.goto, cond: rule.if, visible: r.hotspots?.[rule.exit]?.visible });
    }
    exits.set(r.id, list);
  }
  const hops = (view: GameState, room: Id): Hop[] => {
    const out: Hop[] = [];
    for (const x of exits.get(room) ?? []) if (silentTarget(room, x.to) && check(x.visible, view, room) && check(x.cond, view, room)) out.push({ kind: 'exit', from: room, verb: x.verb, a: x.a, to: x.to });
    for (const [pid, p] of Object.entries(game.map?.places ?? {})) if (view.unlocked.includes(pid) && silentTarget(room, p.room)) out.push({ kind: 'map', from: room, place: pid, to: p.room });
    return out;
  };
  const region = (view: GameState) => {
    const start = view.room;
    if (observed.has(start)) return { rooms: [start], key: start, route: () => [] as Hop[] };
    // forward, with the hop that first reached each room (routes); then the rooms that can come back
    const via = new Map<Id, Hop | null>([[start, null]]);
    const adj = new Map<Id, Hop[]>();
    const todo = [start];
    while (todo.length) {
      const r = todo.shift()!;
      const hs = hops(view, r);
      adj.set(r, hs);
      for (const h of hs) if (!via.has(h.to)) { via.set(h.to, h); todo.push(h.to); }
    }
    const back = new Map<Id, Id[]>();
    for (const [r, hs] of adj) for (const h of hs) (back.get(h.to) ?? back.set(h.to, []).get(h.to)!).push(r);
    const comes = new Set<Id>([start]);
    const q = [start];
    while (q.length) for (const p of back.get(q.shift()!) ?? []) if (!comes.has(p)) { comes.add(p); q.push(p); }
    const members = [...via.keys()].filter((r) => comes.has(r)).sort();
    const route = (to: Id) => { const out: Hop[] = []; for (let r = to; r !== start;) { const h = via.get(r)!; out.unshift(h); r = h.from; } return out; };
    return { rooms: members, key: members.join('+'), route };
  };
  return { observed, hops, region };
}

/** A character's view of a state: its room and bag in the active slots (the others' fields as they are). */
export function viewOf(s: GameState, who: Id, hero: Id, shared: boolean): GameState {
  if ((s.active ?? hero) === who) return s;
  const p = s.players?.[who];
  if (!p) return s;
  return { ...s, active: who, room: p.room, inventory: shared ? s.inventory : p.inventory, used: shared ? s.used : p.used };
}
