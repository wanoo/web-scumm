// Partial-order reduction for the solver: which of the actions possible in a state are worth exploring. Two actions
// that touch different things commute; exploring every order of k of them costs 2^k states for nothing. `sleep` sets
// skip the orders already covered (fewer engine runs); `stubborn` sets explore one action at a time when the others
// can wait (fewer states). Everything here reads the state's dimensions (`stateDims` in solve.ts): what an action
// read and wrote while it ran, and, for the actions a condition still holds back, what the puzzle graph says they need.
import { check, type CondAtom } from '../core/cond';
import type { Cond, GameState, Id } from '../core/types';
import { STATE_KINDS, type PuzzleGraph, type PuzzleNode } from './puzzle';
import { must } from '../core/must';

/** What one action read and changed, in the state's dimensions: the independence relation of the reduction. */
export type RW = { reads: Set<string>; writes: Set<string> };

export const independent = (a: RW, b: RW): boolean => {
  for (const w of a.writes) if (b.reads.has(w) || b.writes.has(w)) return false;
  for (const w of b.writes) if (a.reads.has(w) || a.writes.has(w)) return false;
  return true;
};

/** The engine's `reads` (`kind:id` condition atoms and explicit keys) as the dimensions of `stateDims`. */
export function readDims(reads: Iterable<string>): Set<string> {
  const out = new Set<string>(['room', 'active']);
  for (const r of reads) {
    const i = r.indexOf(':');
    const kind = r.slice(0, i),
      id = r.slice(i + 1);
    if (kind === 'has') out.add(`item:${id}`);
    else if (kind === 'room') out.add('room');
    else if (kind === 'unlocked') out.add(`place:${id}`);
    else if (kind === 'actorIn') out.add(`where:${id.slice(0, id.indexOf('@'))}`);
    else if (kind === 'player') out.add('active');
    else if (kind === 'players') out.add(`player:${id}`);
    else out.add(r); // flag, prop, visited, seen, item, where, visible, script, once, nth, random
  }
  return out;
}

/** The dimensions whose value differs between two states. */
export function diffDims(a: [string, string][], b: [string, string][]): Set<string> {
  const out = new Set<string>();
  const A = new Map(a),
    B = new Map(b);
  for (const [k, v] of A) if (B.get(k) !== v) out.add(k);
  for (const [k, v] of B) if (A.get(k) !== v) out.add(k);
  return out;
}

/** A condition atom as a dimension. */
export function atomDim(a: CondAtom): string {
  switch (a.kind) {
    case 'has':
      return `item:${a.id}`;
    case 'flag':
      return `flag:${a.id}`;
    case 'seen':
      return `seen:${a.id}`;
    case 'prop':
      return `prop:${a.id}`;
    case 'visited':
      return `visited:${a.id}`;
    case 'room':
      return 'room';
    case 'unlocked':
      return `place:${a.id}`;
    case 'actorIn':
      return `where:${a.id.slice(0, a.id.indexOf('@'))}`;
    case 'player':
      return 'active';
  }
}

/** A state node of the puzzle graph as the dimension it changes (null: an event, folded into its listeners). */
function nodeDim(id: string): string | null {
  const i = id.indexOf(':');
  const kind = id.slice(0, i),
    rest = id.slice(i + 1);
  switch (kind) {
    case 'item':
    case 'prop':
    case 'place':
    case 'script':
      return id;
    case 'flag':
      return rest.startsWith('seen:') ? `seen:${rest.slice(5)}` : id;
    case 'room':
      return 'room';
    case 'actor':
      return `where:${rest.slice(0, rest.indexOf('@'))}`;
    case 'player':
      return 'active';
    case 'end':
      return 'done';
    default:
      return null;
  }
}

/** The condition atom an incoming `requires` edge stands for (the node it comes from, its detail). */
function edgeAtom(from: PuzzleNode, detail: string | undefined): CondAtom | null {
  let d = detail ?? '';
  const neg = d.startsWith('not');
  if (neg) d = d.slice(3).trim();
  const name = from.id.slice(from.kind.length + 1);
  const base = (a: CondAtom): CondAtom => (neg ? { ...a, neg: true } : a);
  switch (from.kind) {
    case 'item':
      return base({ kind: 'has', id: name });
    case 'flag':
      return name.startsWith('seen:')
        ? base({ kind: 'seen', id: name.slice(5) })
        : base({ kind: 'flag', id: name, ...(d ? { detail: d } : {}) });
    case 'prop':
      return base({ kind: 'prop', id: name, detail: d });
    case 'room':
      return base(d.startsWith('visited') ? { kind: 'visited', id: name } : { kind: 'room', id: name });
    case 'place':
      return base({ kind: 'unlocked', id: name });
    case 'actor':
      return base({ kind: 'actorIn', id: name });
    case 'player':
      return base({ kind: 'player', id: name });
    default:
      return null;
  }
}

/** Does the atom hold in the state? */
export function atomHolds(a: CondAtom, s: GameState, room: Id): boolean {
  let c: Cond;
  switch (a.kind) {
    case 'has':
      c = { has: a.id };
      break;
    case 'flag': {
      const d = a.detail ?? '';
      c = d.startsWith('=')
        ? { flag: a.id, eq: JSON.parse(d.slice(1).trim()) }
        : d.startsWith('≥')
          ? { flag: a.id, gte: Number(d.slice(1)) }
          : d.startsWith('<')
            ? { flag: a.id, lt: Number(d.slice(1)) }
            : { flag: a.id };
      break;
    }
    case 'seen':
      c = { seen: a.id };
      break;
    case 'prop':
      c = { prop: [a.id, a.detail ?? ''] };
      break;
    case 'visited':
      c = { visited: a.id };
      break;
    case 'room':
      c = { room: a.id };
      break;
    case 'unlocked':
      c = { unlocked: a.id };
      break;
    case 'actorIn':
      c = { actorIn: [a.id.slice(0, a.id.indexOf('@')), a.id.slice(a.id.indexOf('@') + 1)] };
      break;
    case 'player':
      c = { player: a.id };
      break;
  }
  const v = check(c, s, room);
  return a.neg ? !v : v;
}

/** An action of the content as a transition: what it needs (gates), reads inside, and changes; where it applies. */
export interface STx {
  id: string;
  where?: string;
  gates: CondAtom[];
  reads: Set<string>;
  writes: Set<string>;
}

export interface StaticTx {
  /** The transitions that apply in a room: its rules, topics and scripts, plus the game's. */
  forRoom(room: Id): STx[];
  byId: Map<string, STx>;
  /** Every action of the game that changes a dimension (listeners folded into what emits them, arrival effects into what enters the room). */
  producers(dim: string): STx[];
}

/** The content's actions as transitions, from the puzzle graph. */
export function staticTransitions(g: PuzzleGraph): StaticTx {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const byId = new Map<string, STx>();
  const emits = new Map<string, string[]>(); // action → events it produces
  const listeners = new Map<string, string[]>(); // event → listener actions
  for (const n of g.nodes)
    if (!STATE_KINDS.has(n.kind) && n.kind !== 'goal')
      byId.set(n.id, { id: n.id, where: n.where, gates: [], reads: new Set(['room', 'active']), writes: new Set() });
  for (const e of g.edges) {
    if (e.kind === 'requires' || e.kind === 'reads') {
      const tx = byId.get(e.to),
        from = nodes.get(e.from);
      if (!tx || !from) continue;
      if (from.kind === 'event') {
        (listeners.get(e.from) ?? listeners.set(e.from, []).get(e.from)!).push(e.to);
        continue;
      }
      const a = edgeAtom(from, e.detail);
      if (!a) continue;
      if (e.kind === 'requires') tx.gates.push(a);
      tx.reads.add(atomDim(a));
    } else {
      const tx = byId.get(e.from),
        to = nodes.get(e.to);
      if (!tx || !to) continue;
      if (to.kind === 'event') {
        (emits.get(e.from) ?? emits.set(e.from, []).get(e.from)!).push(e.to);
        continue;
      }
      const d = nodeDim(e.to);
      if (d) tx.writes.add(d);
      if (to.kind === 'room') tx.writes.add(`visited:${to.id.slice(5)}`);
    }
  }
  // Listeners fold into what emits their event; a room's arrival effects into whatever goes there.
  const fold = (into: STx, from: STx) => {
    from.writes.forEach((w) => into.writes.add(w));
    from.reads.forEach((r) => into.reads.add(r));
    from.gates.forEach((a) => into.reads.add(atomDim(a)));
  };
  for (let guard = 0; guard < 8; guard++)
    for (const [action, evs] of emits)
      for (const ev of evs)
        for (const l of listeners.get(ev) ?? []) {
          const a = byId.get(action),
            b = byId.get(l);
          if (a && b && a !== b) fold(a, b);
        }
  const enters = [...byId.values()].filter((t) => /^rule:.*\/enter$/.test(t.id));
  for (const t of byId.values()) if (t.writes.has('room') && !enters.includes(t)) for (const en of enters) fold(t, en);
  const isTx = (t: STx) => !enters.includes(t) && !/^listener:/.test(t.id) && t.id !== 'rule:game/start';
  const byRoom = new Map<string, STx[]>();
  const forRoom = (room: Id) => {
    let l = byRoom.get(room);
    if (!l) {
      l = [...byId.values()].filter((t) => isTx(t) && (t.where === room || t.where === 'game'));
      byRoom.set(room, l);
    }
    return l;
  };
  const prodCache = new Map<string, STx[]>();
  const producers = (dim: string) => {
    let l = prodCache.get(dim);
    if (!l) {
      l = [...byId.values()].filter((t) => isTx(t) && t.writes.has(dim));
      prodCache.set(dim, l);
    }
    return l;
  };
  return { forRoom, byId, producers };
}

/** A transition at the state being expanded: one of the solver's tries, or a content action no try stands for. */
export interface Tx {
  key: string;
  /** It ran and changed the state. */
  enabled: boolean;
  rw: RW;
  /** The content actions it stands for (a rule, a topic, a script); their gates, per candidate. */
  candidates: string[];
  gates: CondAtom[][];
  /** It changes what the search looks for (the end, a goal): never postponed. */
  visible: boolean;
}

/**
 * The stubborn set to expand: a set of transitions closed under dependence, where every disabled member has the
 * transitions that could enable it (through one of its false gates) inside too. Among the enabled ones, only those in
 * the set lead somewhere new; the others commute with them and are explored from the children. Returns the keys of
 * the enabled transitions to expand, or every enabled key when no smaller safe set exists.
 */
export function stubbornKeys(
  txs: Tx[],
  stx: StaticTx,
  s: GameState,
  room: Id,
  opts: { all?: boolean } = {},
): Set<string> {
  const enabled = txs.map((t, i) => (t.enabled ? i : -1)).filter((i) => i >= 0);
  const every = new Set(enabled.map((i) => must(txs[i], 'enabled tx').key));
  if (opts.all || enabled.length <= 1 || enabled.some((i) => must(txs[i], 'enabled tx').visible)) return every;
  const n = txs.length;
  const dep: boolean[][] = txs.map((a) => txs.map((b) => a === b || !independent(a.rw, b.rw)));
  const roomWriters = txs.map((t, i) => (t.rw.writes.has('room') ? i : -1)).filter((i) => i >= 0);
  const local = new Map<string, number>(); // content action id → transition index
  txs.forEach((t, i) => t.candidates.forEach((c) => local.set(c, i)));
  /** The transitions that could enable a disabled one: the producers of one false gate of each of its candidates. */
  const enabling = (t: Tx): number[] | null => {
    if (!t.candidates.length) return [];
    const out = new Set<number>();
    for (const [ci, gates] of t.gates.entries()) {
      const falseGates = gates.filter((a) => !atomHolds(a, s, room));
      if (!falseGates.length) return null; // held back by something the graph does not show
      let best: number[] | null = null;
      for (const a of falseGates) {
        const dim = atomDim(a);
        const prods = stx.producers(dim);
        const here: number[] = [];
        let elsewhere = false;
        for (const p of prods) {
          const i = local.get(p.id);
          if (i !== undefined) here.push(i);
          else elsewhere = true;
        }
        txs.forEach((x, i) => {
          if (x.rw.writes.has(dim) && !here.includes(i)) here.push(i);
        });
        const cand = elsewhere ? [...here, ...roomWriters] : here;
        if (best === null || cand.length < best.length) best = cand;
      }
      void ci;
      best!.forEach((i) => out.add(i));
    }
    return [...out];
  };
  let best: Set<string> | null = null;
  for (const seed of enabled) {
    const T = new Set<number>([seed]);
    const queue = [seed];
    let ok = true;
    while (queue.length && ok) {
      const i = queue.shift()!;
      const tx = must(txs[i], 'tx');
      // An enabled member brings in everything dependent on it; a disabled one only what could enable it.
      if (tx.enabled) {
        const row = must(dep[i], 'dependency row');
        for (let j = 0; j < n; j++)
          if (!T.has(j) && row[j]) {
            T.add(j);
            queue.push(j);
          }
      } else {
        const nes = enabling(tx);
        if (nes === null) {
          ok = false;
          break;
        }
        for (const j of nes)
          if (!T.has(j)) {
            T.add(j);
            queue.push(j);
          }
      }
    }
    if (!ok) continue;
    const keys = new Set(
      [...T]
        .map((i) => must(txs[i], 'tx'))
        .filter((t) => t.enabled)
        .map((t) => t.key),
    );
    if (!best || keys.size < best.size) best = keys;
    if (best.size === 1) break;
  }
  return best ?? every;
}
