// Dominance, symmetries and sub-puzzles (4.1.13 "Proof at Scale", docs/dev/PROOF-MATRIX.md). Each rule is measured
// against the explicit search on small generated games (tests/dominance.test.ts) and a rule that changes a verdict
// there stays off in proofs; the profile says which ones applied and why the others did not.
// - Dominance (3.5, moved here): a state with no more progress than one already seen (the same everything else, its
//   monotonic items and flags a subset) is not explored. Sound for a witness (solve() runs again without it when it
//   finds nothing); not for a proof, where a dominated state may be the softlock: off in proofs (measured).
// - Symmetric items: two items the game treats alike (every rule, command and condition that names one has its exact
//   counterpart naming the other, and nothing names both) are one item counted twice. The game is the same game with
//   the two swapped, so a state and its swapped twin have the same future: a proof may keep one of them.
// - Sub-puzzles: the live dimensions split into groups no transition of the content links (from the static
//   transitions, rooms and characters left out): independent puzzles whose combinations multiply the states. Reported,
//   not applied: proving each one alone needs a product argument the search does not make (said in the profile).
import type { Cond, GameDef, Id } from '../../../core/types';
import { staticTransitions } from '../../por';
import { puzzleGraph } from '../../puzzle';
import type { CustomCommands } from '../../../core/custom';
import type { Dims } from '../abstractions';

/** Witness dominance: states indexed by everything but their dominance things. */
export class Dominance {
  private index = new Map<string, Set<string>[]>();
  pruned = 0;

  constructor(private things: { flags: Set<string>; items: Set<string> }) {}

  private split(d: Dims) {
    const mono = new Set<string>();
    const rest: Dims = [];
    for (const [k, v] of d)
      (k.startsWith('flag:') && v === 'true' && this.things.flags.has(k.slice(5))) ||
      (k.startsWith('item:') && this.things.items.has(k.slice(5)))
        ? mono.add(k)
        : rest.push([k, v]);
    return { key: JSON.stringify(rest), mono };
  }

  /** Some state seen has all of this one's progress (`strict`: and more), everything else equal. */
  dominated(d: Dims, strict = false): boolean {
    const { key, mono } = this.split(d);
    return !!this.index
      .get(key)
      ?.some((m) => m.size >= mono.size + (strict ? 1 : 0) && [...mono].every((x) => m.has(x)));
  }

  remember(d: Dims) {
    const { key, mono } = this.split(d);
    (this.index.get(key) ?? (this.index.set(key, []), this.index.get(key)!)).push(mono);
  }
}

/** A rule list in a form where the order of rules answering different actions does not show (it changes nothing). */
function canonicalRules(list: unknown[]): unknown[] | null {
  const groups = new Map<string, unknown[]>();
  for (const r of list) {
    const o = r as { verb?: unknown; a?: unknown; b?: unknown };
    // A rule for several targets or none competes with others: keep the list as it is.
    if (typeof o.a !== 'string' || Array.isArray(o.verb) || (o.b !== undefined && typeof o.b !== 'string')) return null;
    const k = `${String(o.verb)}|${o.a}|${String(o.b ?? '')}`;
    (groups.get(k) ?? (groups.set(k, []), groups.get(k)!)).push(r);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flatMap(([, g]) => g);
}

/** The game as text, two ids swapped, object keys sorted and rule lists canonical. */
function gameText(v: unknown, swap?: [string, string]): string {
  const walk = (x: unknown, key?: string): unknown => {
    if (typeof x === 'string') return swap && x === swap[0] ? swap[1] : swap && x === swap[1] ? swap[0] : x;
    if (!x || typeof x !== 'object') return x;
    if (Array.isArray(x)) {
      const mapped = x.map((y) => walk(y));
      // A start bag's order decides only the order of the tries.
      if (key === 'inventory' && mapped.every((y) => typeof y === 'string')) return [...(mapped as string[])].sort();
      return key === 'on' ? (canonicalRules(mapped) ?? mapped) : mapped;
    }
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const nk = swap && k === swap[0] ? swap[1] : swap && k === swap[1] ? swap[0] : k;
      out[nk] = walk(o[k], k);
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  };
  return JSON.stringify(walk(v));
}

/**
 * Classes of symmetric items: the game (its rules, conditions, start, invariants, item definitions but their names and
 * lines) is the same text with the two ids swapped, and so is the goal. Read on the game as written (compiling gives
 * each rule an id from its place). Conservative: a line that names the item, a rule for several targets, an item named
 * by a topic, a script, a listener or a block the engine keys by its place keep two items apart.
 */
export function symmetricItems(game: GameDef, goal?: Cond[]): Id[][] {
  const ids = Object.keys(game.items).sort();
  if (ids.length < 2) return [];
  // The item definitions differ by their name, icon and look: those say nothing of the state.
  const bare = {
    ...game,
    items: Object.fromEntries(ids.map((i) => [i, { ...game.items[i], name: '', icon: '', look: '' }])),
  };
  const base = gameText(bare);
  const goalText = JSON.stringify(goal ?? []);
  const count = (i: string) => base.split(`"${i}"`).length;
  // The engine keys `once`, `nth`, `cycle` and `random` blocks, topics and listeners by their place in the game, which
  // a swap does not move: an item named in one of those, or outside the rules, stays apart (not a symmetry then).
  const rules = [...game.rooms.flatMap((r) => r.on ?? []), ...(game.rules.on ?? [])].map((r) => JSON.stringify(r));
  const elsewhere = JSON.stringify([
    game.rooms.map((r) => [r.talk, r.scripts, r.events, r.onEnter, r.props]),
    game.scripts,
    game.events,
    game.start.intro,
    game.checkpoints,
  ]);
  const keyed = (i: string) =>
    elsewhere.includes(`"${i}"`) || rules.some((r) => r.includes(`"${i}"`) && /"(once|nth|cycle|random)":/.test(r));
  const classes: Id[][] = [];
  const placed = new Set<string>(ids.filter(keyed));
  for (const i of ids) {
    if (placed.has(i)) continue;
    const cls = [i];
    for (const j of ids) {
      if (j <= i || placed.has(j) || count(i) !== count(j)) continue;
      if (goalText.includes(`"${i}"`) || goalText.includes(`"${j}"`)) continue;
      if (gameText(bare, [i, j]) === base) cls.push(j);
    }
    if (cls.length > 1) {
      cls.forEach((x) => placed.add(x));
      classes.push(cls);
    }
  }
  return classes;
}

/**
 * The dimensions with every member of a symmetric class written as its first member: a bag or a pool lists it as
 * many times as it holds members, `item:` counts them. A state and its swapped twin get the same dimensions.
 */
export function symmetryDims(d: Dims, classes: Id[][]): Dims {
  if (!classes.length) return d;
  const rep = new Map<string, string>();
  for (const c of classes) for (const x of c) rep.set(x, c[0]!);
  const list = (s: string) =>
    s
      ? s
          .split(',')
          .map((x) => rep.get(x) ?? x)
          .sort()
          .join(',')
      : s;
  const counts = new Map<string, number>();
  const out: Dims = [];
  for (const [k, v] of d) {
    const i = k.indexOf(':');
    const kind = k.slice(0, i),
      id = k.slice(i + 1);
    if ((kind === 'item' || kind === 'used') && rep.has(id)) {
      const nk = `${kind}:${rep.get(id)}`;
      counts.set(nk, (counts.get(nk) ?? 0) + 1);
      continue;
    }
    if (kind === 'pos' || kind === 'player') {
      const parts = v.split(' ');
      out.push([k, parts.map((p, n) => (n === 0 ? p : list(p))).join(' ')]);
    } else if (kind === 'pool') out.push([k, list(v)]);
    else out.push([k, v]);
  }
  for (const [k, n] of counts) out.push([k, String(n)]);
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The independent sub-puzzles: the dimensions the content's transitions read or write, grouped by the transitions
 * that touch several of them (rooms, characters and visits left out: every action reads where one stands).
 */
export function subPuzzles(game: GameDef, commands?: CustomCommands): { count: number; sizes: number[] } {
  const stx = staticTransitions(puzzleGraph(game, { commands }));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const positional = (d: string) => d === 'room' || d === 'active' || d.startsWith('visited:') || d === 'player';
  for (const tx of stx.byId.values()) {
    const dims = [...tx.reads, ...tx.writes].filter((d) => !positional(d));
    for (const d of dims) if (!parent.has(d)) parent.set(d, d);
    for (const d of dims.slice(1)) parent.set(find(d), find(dims[0]!));
  }
  const sizes = new Map<string, number>();
  for (const d of parent.keys()) sizes.set(find(d), (sizes.get(find(d)) ?? 0) + 1);
  const s = [...sizes.values()].sort((a, b) => b - a);
  return { count: s.length, sizes: s };
}
