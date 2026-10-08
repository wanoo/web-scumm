// What a state is made of for the search: its dimensions, the canonical forms (mobility, ownership, players), monotone and dominated things, independent groups.

import { Engine } from '../../core/engine';
import type { CustomCommands } from '../../core/custom';
import { FakePresenter, MemoryStore } from '../../core/ports';
import { changesState, cmdLists, eachCmd } from '../../core/cmds';
import { extraReads, liveness, puzzleGraph } from '../puzzle';
import type { Cond, GameDef, GameState, Id, Layout } from '../../core/types';
import { compileGame } from '../../core/define';
import { viewOf, type MobilityModel } from '../mobility';
import { must } from '../../core/must';
import type { RealityPolicy, SolveOptions } from './model';

/** Keys of once / nth blocks: their counter changes behaviour, so it's part of the state. */
export function stateKeys(game: GameDef, commands?: CustomCommands, goal?: Cond[], reality?: RealityPolicy) {
  // What can still change the outcome: a flag nobody but its setter reads, a clock nobody looks at, a walker nobody
  // waits for are left out of the state (and the solver does not spend actions on them).
  const extra = extraReads(game, goal);
  const live = liveness(puzzleGraph(game, { commands }), extra);
  const json = JSON.stringify(game);
  // `seen` only counts if a condition reads it
  const seenRead = new Set<string>();
  for (const m of json.matchAll(/"seen":"([^"]+)"/g)) seenRead.add(must(m[1], 'seen id'));
  // `visited` too (the room counter is otherwise decor)
  const visitedRead = new Set<string>();
  for (const m of json.matchAll(/"visited":"([^"]+)"/g)) visitedRead.add(must(m[1], 'visited id'));
  // A prop only counts if a condition reads its state ({ prop: [id, state] }): otherwise opening/closing it is just decor.
  const propRead = new Set<string>();
  const condProps = (c: unknown) => {
    if (!c || typeof c !== 'object') return;
    if (Array.isArray(c)) {
      c.forEach(condProps);
      return;
    }
    const o = c as Record<string, unknown>;
    if (Array.isArray(o.prop) && typeof o.prop[0] === 'string') propRead.add(o.prop[0]);
    Object.values(o).forEach(condProps);
  };
  const findConds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(findConds);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'if' || k === 'visible' || k === 'until' || k === 'news') condProps(x);
      findConds(x);
    }
  };
  findConds(game);
  // A once/nth counter only counts if its block actually changes state (flag, item, prop, room…): repeat gags don't.
  const onceRead = new Set<string>();
  const nthRead = new Map<string, number>();
  // A `random` block alternates its branches from its counter under the solver's fixed draw: the counter is state too.
  const randomRead = new Set<string>();
  for (const { list } of cmdLists(game))
    eachCmd(list, (c) => {
      if (typeof c === 'string') return;
      if ('once' in c) {
        if (c.key && changesState(c.once)) onceRead.add(c.key);
      } else if ('nth' in c) {
        if (c.key && changesState(c.nth.flat())) nthRead.set(c.key, c.nth.length - 1);
      } else if ('random' in c) {
        if (c.key && changesState(c.random.flat())) randomRead.add(c.key);
      }
    });
  // A counter only counts up to the highest value a condition compares it with: beyond, more `inc` change nothing.
  // A number nobody compares is just true: a script that counts forever doesn't create states forever.
  const flagBounds = new Map<string, number>();
  // …unless something lowers it or sets it to a number (a price haggled down): then the exact value matters.
  const exact = new Set<string>();
  for (const { list } of cmdLists(game))
    eachCmd(list, (c) => {
      if (typeof c === 'string') return;
      if ('inc' in c && (c.by ?? 1) < 0) exact.add(c.inc);
      else if ('set' in c && Array.isArray(c.set) && typeof c.set[1] === 'number') exact.add(c.set[0]);
    });
  for (const [k, v] of Object.entries(game.start.flags ?? {})) if (typeof v === 'number') exact.add(k);
  const findBounds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(findBounds);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.flag === 'string') {
      for (const k of ['eq', 'gte', 'lt'] as const)
        if (typeof o[k] === 'number')
          flagBounds.set(o.flag, Math.max(flagBounds.get(o.flag) ?? -Infinity, o[k] as number));
    }
    Object.values(o).forEach(findBounds);
  };
  findBounds(game);
  for (const k of exact) flagBounds.delete(k);
  // Under a scenario the next signal to come is the one after the cursor: where the scenario stands is state (4.1.1).
  const realityCursor = typeof reality === 'object';
  return {
    once: onceRead,
    nth: nthRead,
    random: randomRead,
    seenRead,
    visitedRead,
    propRead,
    flagBounds,
    exact,
    live,
    realityCursor,
  };
}

/**
 * The state as the solver sees it: one (dimension, value) pair per thing that matters (live items, flags, read props…),
 * sorted. Two states with the same pairs are the same state. The profile counts which dimensions split states.
 */
export type Dims = [string, string][];

export function stateDims(s: GameState, keys: ReturnType<typeof stateKeys>): Dims {
  const d: Dims = [['room', s.room]];
  for (const i of s.inventory) if (keys.live.items.has(i)) d.push([`item:${i}`, '1']);
  for (const [k, v] of Object.entries(s.flags)) {
    if (!keys.live.flags.has(k)) continue;
    if (typeof v !== 'number') {
      if (v) d.push([`flag:${k}`, JSON.stringify(v)]);
      continue;
    }
    const b = keys.flagBounds.get(k);
    const x = keys.exact.has(k) ? v : b === undefined ? (v ? 1 : 0) : Math.min(v, b + 1);
    if (x) d.push([`flag:${k}`, String(x)]);
  }
  for (const [k, v] of Object.entries(s.props))
    if (keys.propRead.has(k.includes('.') ? k.slice(k.indexOf('.') + 1) : k) || keys.propRead.has(k))
      d.push([`prop:${k}`, v]);
  for (const u of s.unlocked) d.push([`place:${u}`, '1']);
  for (const [k, a] of Object.entries(s.actors))
    if (a.visible !== undefined) d.push([`visible:${k}`, a.visible ? '1' : '0']);
  for (const [k, v] of Object.entries(s.counters)) {
    if (keys.once.has(k)) {
      if (v) d.push([`once:${k}`, '1']);
    } else if (keys.nth.has(k)) d.push([`nth:${k}`, String(Math.min(v, keys.nth.get(k)!))]);
    else if (keys.random.has(k)) d.push([`random:${k}`, String(v)]);
  }
  // `once` listeners (`event.*`) change what the next emit does: they are part of the state.
  // A signal applied once per game (`reality.*`, 4.1.1) changes what its next delivery does: state too.
  for (const k of Object.keys(s.seen))
    if (keys.seenRead.has(k) || k.startsWith('event.') || k.startsWith('reality.')) d.push([`seen:${k}`, '1']);
  if (keys.realityCursor) d.push(['reality', String(s.reality?.cursor ?? 0)]);
  for (const [k, n] of Object.entries(s.visited)) if (n && keys.visitedRead.has(k)) d.push([`visited:${k}`, '1']);
  if (s.done) d.push(['done', '1']);
  for (const u of s.used ?? []) if (keys.live.items.has(u)) d.push([`used:${u}`, '1']);
  for (const [k, r] of Object.entries(s.where ?? {})) if (keys.live.actors.has(k)) d.push([`where:${k}`, r]);
  for (const [k, st] of Object.entries(s.scripts ?? {}))
    if (keys.live.actions.has(k)) d.push([`script:${k}`, `${st.pc}${st.done ? 'd' : ''}${st.off ? 'x' : ''}`]);
  if (s.active) d.push(['active', s.active]);
  for (const [k, p] of Object.entries(s.players ?? {}))
    d.push([
      `player:${k}`,
      `${p.room} ${p.inventory
        .filter((i) => keys.live.items.has(i))
        .sort()
        .join(',')} ${(p.used ?? [])
        .filter((i) => keys.live.items.has(i))
        .sort()
        .join(',')}`,
    ]);
  return d.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The same dimensions with nobody active: every playable character's room and bag (`pos:<id>`), whoever holds the
 * controls. Two states that differ only by the active character get the same dimensions.
 */
/** Replaces each character's exact room by its mobility region (the dims of `canonicalDims` or of `stateDims`). */
export function regionDims(d: Dims, s: GameState, model: MobilityModel, hero: Id, shared: boolean): Dims {
  const key = (who: Id) => model.region(viewOf(s, who, hero, shared)).key;
  return d.map(([k, v]): [string, string] => {
    if (k === 'room') return [k, key(s.active ?? hero)];
    if (k.startsWith('pos:') || k.startsWith('player:')) {
      const who = k.slice(k.indexOf(':') + 1);
      const i = v.indexOf(' ');
      return [k, i < 0 ? key(who) : key(who) + v.slice(i)];
    }
    return [k, v];
  });
}

/** A hop the mobility model called silent was not: the search restarts with exact rooms. */
export class MobilityError extends Error {}

/** A worker's mobility failure, raised again in the search (solve-pool.ts). */
export const mobilityError = (m: string): Error => new MobilityError(m);

export const isMobilityError = (e: unknown): boolean => e instanceof MobilityError;

export function canonicalDims(
  d: Dims,
  s: GameState,
  keys: ReturnType<typeof stateKeys>,
  hero: Id,
  shared: boolean,
  pool?: Set<Id> | null,
  groups: Id[][] = [],
): Dims {
  const live = (xs: Id[] | undefined) =>
    (xs ?? [])
      .filter((i) => keys.live.items.has(i))
      .sort()
      .join(',');
  const pooling = new Set(groups.flat());
  // The bags without the pooled items of a character in a pooling group (the `used` marks stay each character's own).
  const bag = (who: Id, xs: Id[] | undefined) => live((xs ?? []).filter((i) => !(pool?.has(i) && pooling.has(who))));
  const out = d.filter(
    ([k]) =>
      k !== 'active' &&
      k !== 'room' &&
      !k.startsWith('player:') &&
      (shared || (!k.startsWith('item:') && !k.startsWith('used:'))),
  );
  const me = s.active ?? hero;
  out.push([`pos:${me}`, shared ? s.room : `${s.room} ${bag(me, s.inventory)} ${live(s.used)}`]);
  for (const [k, p] of Object.entries(s.players ?? {}))
    out.push([`pos:${k}`, shared ? p.room : `${p.room} ${bag(k, p.inventory)} ${live(p.used)}`]);
  // The canonical owner (3.5; by group since 3.6): the pooled items a group of characters who can meet holds, whoever
  // of them holds each (a multiset: a copy gained twice stays two).
  const inv = (who: Id) => (who === me ? s.inventory : (s.players?.[who]?.inventory ?? []));
  if (pool)
    for (const g of groups)
      out.push([
        `pool:${g.join('+')}`,
        g
          .flatMap(inv)
          .filter((i) => pool.has(i) && keys.live.items.has(i))
          .sort()
          .join(','),
      ]);
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The items a proof may pool (the canonical owner, 3.5): which playable character holds one of them changes nothing
 * the search can tell, as long as the characters can meet and hand it over. Certified from the content: the item is
 * in no condition (so its absence decides nothing: no `else`, no rule shadowed by one that needs it), in no invariant
 * and no goal, is lost or moved only by an action on it (a `lose` elsewhere would remove it from whoever holds the
 * pool), and no rule or reaction by kind answers giving it (the engine's hand-over does). The hand-overs themselves
 * are played and checked during the search (`OwnershipError` otherwise).
 */
export function poolableItems(game: GameDef, goal?: Cond[]): { items: Set<Id>; reason?: string } {
  const none = (reason: string) => ({ items: new Set<Id>(), reason });
  if ((game.players?.ids.length ?? 1) < 2) return none('one playable character');
  if (game.players?.sharedInventory) return none('the characters share one bag');
  if (
    (game.rules.kinds ?? []).some(
      (k) => (Array.isArray(k.verb) ? k.verb : [k.verb]).includes('give') && k.item === undefined,
    )
  )
    return none('a reaction by kind answers giving any item');
  const out = new Set(Object.keys(game.items));
  const drop = (i: Id) => out.delete(i);
  // In a condition anywhere (the game, the invariants, the goal).
  const conds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(conds);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.has === 'string') drop(o.has);
    Object.values(o).forEach(conds);
  };
  conds(game);
  conds(goal ?? []);
  for (const k of game.rules.kinds ?? [])
    if ((Array.isArray(k.verb) ? k.verb : [k.verb]).includes('give'))
      (Array.isArray(k.item) ? k.item : [k.item!]).forEach(drop);
  const ids = (x: Id | Id[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const rules = [...game.rooms.flatMap((r) => r.on ?? []), ...(game.rules.on ?? [])];
  for (const r of rules)
    if ((Array.isArray(r.verb) ? r.verb : [r.verb]).includes('give')) [...ids(r.a), ...ids(r.b)].forEach(drop);
  // `lose` / `transfer` only inside a rule acting on that item.
  for (const { list } of cmdLists(game)) {
    const actingOn = rules.find((r) => r.do === list);
    eachCmd(list, (c) => {
      if (typeof c === 'string') return;
      const it = 'lose' in c ? c.lose : 'transfer' in c ? c.transfer[0] : undefined;
      if (it && !(actingOn && [...ids(actingOn.a), ...ids(actingOn.b)].includes(it))) drop(it);
    });
  }
  return out.size ? { items: out } : none('every item is read by a condition, lost elsewhere or given by a rule');
}

/** A hand-over of the canonical owner did not do what it was certified to: the search restarts without pooling. */
export class OwnershipError extends Error {}

export const ownershipError = (m: string): Error => new OwnershipError(m);

export const isOwnershipError = (e: unknown): boolean => e instanceof OwnershipError;

/**
 * The value of one thing a run read (`Engine.reads`: condition atoms and the engine's own keys), in the raw state.
 * Null: a read the memo cannot value, so that run is not kept.
 */
export function atomValue(s: GameState, key: string): string | null {
  const i = key.indexOf(':');
  const kind = key.slice(0, i),
    id = key.slice(i + 1);
  switch (kind) {
    case '@':
      return id === 'room' ? s.room : id === 'active' ? (s.active ?? '') : null;
    case 'has':
      return s.inventory.includes(id) ? '1' : '0';
    case 'item':
      return `${s.inventory.includes(id) ? 1 : 0}${s.used?.includes(id) ? 1 : 0}`;
    case 'flag':
      return JSON.stringify(s.flags[id] ?? null);
    case 'prop':
      return s.props[id] ?? '';
    case 'visited':
      return (s.visited[id] ?? 0) > 0 ? '1' : '0';
    case 'room':
      return s.room;
    case 'unlocked':
      return s.unlocked.includes(id) ? '1' : '0';
    case 'seen':
      return s.seen[id] ? '1' : '0';
    case 'actorIn':
      return s.where?.[id.slice(0, id.indexOf('@'))] ?? '';
    case 'where':
      return s.where?.[id] ?? '';
    case 'player':
      return s.active ?? '';
    case 'players': {
      // A parked character's room, bag and used items (4.1.17): not where it stands. The search's own dimensions
      // (`player:<id>`) leave the position out, so a no-op cannot depend on it here either; valued with it, the memo
      // kept one entry per pixel spot (`guests()` reads every parked player), and the demo's gain fell under two.
      const p = s.players?.[id];
      return p ? JSON.stringify([p.room, p.inventory, p.used ?? null]) : 'null';
    }
    case 'visible': {
      const v = s.actors[id]?.visible;
      return v === undefined ? '' : v ? '1' : '0';
    }
    case 'script':
      return JSON.stringify(s.scripts?.[id] ?? null);
    case 'once':
    case 'nth':
    case 'random':
      return String(s.counters[id] ?? '');
    default:
      return null;
  }
}

/** What a no-op run read, valued in the state it ran from (always its room and active character). */
export function valuation(s: GameState, reads: Set<string>): [string, string][] | null {
  const out: [string, string][] = [];
  for (const k of ['@:room', '@:active', ...reads]) {
    const v = atomValue(s, k);
    if (v === null) return null;
    out.push([k, v]);
  }
  return out;
}

/** Flags never unset or lowered, items never lost, transferred or used up: once gained, kept. */
export function monotonicThings(game: GameDef): { flags: string[]; items: string[] } {
  const flagsSet = new Set<string>(),
    flagsDown = new Set<string>(),
    itemsGained = new Set<string>(),
    itemsLost = new Set<string>();
  for (const { list } of cmdLists(game))
    eachCmd(list, (c) => {
      if (typeof c === 'string') return;
      if ('set' in c) {
        const [k, v] = Array.isArray(c.set) ? c.set : [c.set, true];
        (v === false ? flagsDown : flagsSet).add(k);
      } else if ('unset' in c) flagsDown.add(c.unset);
      else if ('inc' in c) ((c.by ?? 1) < 0 ? flagsDown : flagsSet).add(c.inc);
      else if ('gain' in c) itemsGained.add(c.gain);
      else if ('lose' in c) itemsLost.add(c.lose);
      else if ('used' in c) (Array.isArray(c.used) ? c.used : [c.used]).forEach((u) => itemsLost.add(u));
      else if ('transfer' in c) itemsLost.add(c.transfer[0]);
    });
  for (const k of Object.keys(game.start.flags ?? {})) flagsSet.add(k);
  for (const i of game.start.inventory ?? []) itemsGained.add(i);
  return {
    flags: [...flagsSet].filter((k) => !flagsDown.has(k)).sort(),
    items: [...itemsGained].filter((i) => !itemsLost.has(i)).sort(),
  };
}

/**
 * What witness dominance compares (3.5): monotonic items and boolean flags (gained or set, never lost or unset) whose
 * absence nothing reads: not under `!` or `not`, not in an `if` with an `else`, not in the condition of a rule that
 * would shadow a later one on the same action (then lacking it is what lets the later one answer).
 */
export function dominanceThings(game: GameDef): { flags: Set<string>; items: Set<string> } {
  const mono = monotonicThings(game);
  const flags = new Set(mono.flags),
    items = new Set(mono.items);
  const atomsOf = (c: unknown, out: { f: Set<string>; i: Set<string> } = { f: new Set(), i: new Set() }) => {
    if (typeof c === 'string') out.f.add(c.replace(/^!/, ''));
    else if (Array.isArray(c)) c.forEach((x) => atomsOf(x, out));
    else if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      if (typeof o.has === 'string') out.i.add(o.has);
      if (typeof o.flag === 'string') out.f.add(o.flag);
      for (const [k, v] of Object.entries(o)) if (k !== 'has' && k !== 'flag') atomsOf(v, out);
    }
    return out;
  };
  const drop = (c: unknown) => {
    const a = atomsOf(c);
    a.f.forEach((x) => flags.delete(x));
    a.i.forEach((x) => items.delete(x));
  };
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.startsWith('!')) flags.delete(v.slice(1));
      return;
    }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const o = v as Record<string, unknown>;
    if ('not' in o) drop(o.not);
    if ('if' in o && 'else' in o) drop(o.if);
    Object.values(o).forEach(walk);
  };
  walk(game);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  for (const list of [...game.rooms.map((r) => r.on ?? []), game.rules.on ?? []])
    list.forEach((r, i) => {
      if (r.if !== undefined && list.slice(i + 1).some((l) => same(l.verb, r.verb) && same(l.a, r.a) && same(l.b, r.b)))
        drop(r.if);
    });
  return { flags, items };
}

/** A 32-bit hash of a string. */
function h32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Which dimensions split the states: for each one, how many states would merge if it were dropped (two states that
 * differ only by it count as one). Each state is the XOR of its pairs' hashes; dropping a pair is one more XOR.
 */
export function splits(all: Dims[]): { key: string; split: number; values: number }[] {
  const pair = new Map<string, number>();
  const ph = (k: string, v: string) => {
    const key = `${k}\u0000${v}`;
    let x = pair.get(key);
    if (x === undefined) {
      x = h32(key);
      pair.set(key, x);
    }
    return x;
  };
  const H = all.map((d) => d.reduce((acc, [k, v]) => acc ^ ph(k, v), 0));
  const byDim = new Map<string, { states: number[]; ph: number[]; values: Set<string> }>();
  all.forEach((d, i) => {
    for (const [k, v] of d) {
      let b = byDim.get(k);
      if (!b) {
        b = { states: [], ph: [], values: new Set() };
        byDim.set(k, b);
      }
      b.states.push(i);
      b.ph.push(ph(k, v));
      b.values.add(v);
    }
  });
  const out: { key: string; split: number; values: number }[] = [];
  for (const [key, b] of byDim) {
    if (b.states.length === all.length && b.values.size === 1) continue; // a constant never splits
    const set = new Set(H);
    for (let j = 0; j < b.states.length; j++) {
      const h = must(H[must(b.states[j], 'dim state')], 'state hash');
      set.delete(h);
      set.add(h ^ must(b.ph[j], 'dim hash'));
    }
    out.push({ key, split: all.length - set.size, values: b.values.size + (b.states.length < all.length ? 1 : 0) });
  }
  return out.sort((a, b) => b.split - a.split || a.key.localeCompare(b.key));
}

/** Groups of two-valued dimensions whose observed combinations fill (nearly) the whole product: they evolve independently. */
export function independentGroups(
  all: Dims[],
  dims: { key: string; values: number }[],
): { dims: string[]; combos: number; product: number }[] {
  const cand = dims
    .filter((d) => d.values === 2)
    .slice(0, 12)
    .map((d) => d.key);
  if (cand.length < 2) return [];
  const value = (d: Dims, k: string) => d.find(([x]) => x === k)?.[1] ?? '';
  const combos = (keys: string[]) => new Set(all.map((d) => keys.map((k) => value(d, k)).join('\u0001'))).size;
  const groups: string[][] = [];
  const taken = new Set<string>();
  for (const k of cand) {
    if (taken.has(k)) continue;
    const g = [k];
    for (const k2 of cand) {
      if (k2 === k || taken.has(k2)) continue;
      if (combos([...g, k2]) >= 0.8 * 2 ** (g.length + 1)) g.push(k2);
    }
    if (g.length >= 3) {
      g.forEach((x) => taken.add(x));
      groups.push(g);
    }
  }
  return groups.map((g) => ({ dims: g, combos: combos(g), product: 2 ** g.length }));
}

/**
 * What a chapter reads of a state, as a key: two boundary states with the same key are the same start for that
 * chapter (its rules, hints, scripts and goal read nothing else). `proveChapters` dedupes the previous chapter's
 * boundaries by it.
 */
export function projectState(
  gameIn: GameDef,
  layouts: Record<string, Layout>,
  state: GameState,
  opts: Pick<SolveOptions, 'commands' | 'goal' | 'canonicalPlayers' | 'reality'> = {},
): string {
  const game = compileGame(gameIn) as GameDef;
  const keyed = new Engine(game, layouts, new FakePresenter(), new MemoryStore(), { commands: opts.commands });
  const keys = stateKeys(keyed.game, opts.commands, opts.goal, opts.reality);
  const d = stateDims(state, keys);
  // The same canonical character as the proof that starts from it: the active character does not split boundaries.
  const canonical =
    (opts.canonicalPlayers ?? true) &&
    (game.players?.ids.length ?? 1) > 1 &&
    !JSON.stringify(opts.goal ?? []).includes('"player"');
  return JSON.stringify(canonical ? canonicalDims(d, state, keys, game.hero, !!game.players?.sharedInventory) : d);
}
