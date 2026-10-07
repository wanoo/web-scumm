// The search's states, stored (4.1.13 "Solver Research", docs/dev/adr/0015-compact-state.md). A state seen is an index;
// what the search keeps of it lives in typed arrays by index: its parent's index, its path length, its last step and
// session entries (interned), its room and bag (interned). Its key is its (dimension, value) pairs, each interned to a
// number, sorted, written as a short string: two states have the same key exactly when they have the same dimensions,
// so the key decides as the old JSON did, with no hash collision to fear. The engine state itself is kept only while
// the node waits in the frontier (and for the goals, whose states start the next chapter). `representation: 'objects'`
// keeps everything of every state as 4.1.8 did (the JSON key, the engine state, the dimensions, the copied steps): the
// reference the differential tests compare with, and the "before" of the benchmark.
import type { GameState, Id, SessionEntry } from '../../../core/types';
import { must } from '../../../core/must';
import type { Dims } from '../abstractions';

/** Strings to small integers and back. */
export class Interner {
  private ids = new Map<string, number>();
  readonly list: string[] = [];

  constructor(list: string[] = []) {
    for (const s of list) this.id(s);
  }

  id(s: string): number {
    let i = this.ids.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.ids.set(s, i);
      this.list.push(s);
    }
    return i;
  }

  str(i: number): string {
    return must(this.list[i], 'interned string');
  }
}

/** An Int32Array that grows (doubling). */
export class Ints {
  a: Int32Array;
  n = 0;

  constructor(from?: ArrayLike<number>) {
    this.a = new Int32Array(Math.max(16, from?.length ?? 0));
    if (from) {
      this.a.set(from);
      this.n = from.length;
    }
  }

  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }

  at(i: number): number {
    return must(this.a[i], 'int');
  }

  set(i: number, v: number) {
    this.a[i] = v;
  }

  slice(): Int32Array {
    return this.a.slice(0, this.n);
  }
}

/** Sorted ids as a string: an id below 0x8000 is one UTF-16 unit, a larger one two (0x8000 | high 15 bits, low 16). */
export function encodeIds(ids: number[]): string {
  let s = '';
  for (const i of ids) s += i < 0x8000 ? String.fromCharCode(i) : String.fromCharCode(0x8000 | (i >>> 16), i & 0xffff);
  return s;
}

export function decodeIds(key: string): number[] {
  const out: number[] = [];
  for (let k = 0; k < key.length; k++) {
    const c = key.charCodeAt(k);
    out.push(c < 0x8000 ? c : ((c & 0x7fff) << 16) | key.charCodeAt(++k));
  }
  return out;
}

/**
 * FNV-1a 64 of a string, as [high 32 bits, low 32 bits]: a unit below 0x100 is one byte (so an ASCII string hashes as
 * the standard FNV-1a 64 of its bytes), a larger one two (low, high). Four 16-bit limbs keep every product exact.
 */
export function fnv64(s: string): [number, number] {
  // offset basis 0xcbf29ce484222325; prime 0x100000001b3 = 2^40 + 0x1b3
  let h0 = 0x2325,
    h1 = 0x8422,
    h2 = 0x9ce4,
    h3 = 0xcbf2;
  const byte = (b: number) => {
    h0 ^= b;
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + (t1 >>> 16) + ((h0 << 8) & 0xffff);
    const t3 = h3 * 0x1b3 + (t2 >>> 16) + (h0 >>> 8) + ((h1 & 0xff) << 8);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  };
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    byte(c & 0xff);
    if (c > 0xff) byte(c >>> 8);
  }
  return [((h3 << 16) | h2) >>> 0, ((h1 << 16) | h0) >>> 0];
}

/** A 64-bit value as two uint32 halves added modulo 2^64. */
export function add64(a: [number, number], b: [number, number]): [number, number] {
  const lo = a[1] + b[1];
  return [(a[0] + b[0] + (lo > 0xffffffff ? 1 : 0)) >>> 0, lo >>> 0];
}

export function sub64(a: [number, number], b: [number, number]): [number, number] {
  const lo = a[1] - b[1];
  return [(a[0] - b[0] - (lo < 0 ? 1 : 0)) >>> 0, lo >>> 0];
}

/** One (dimension, value) pair as the store interns it. */
const pairOf = (k: string, v: string) => `${k}\u0001${v}`;

/**
 * The 64-bit hash of a state: the sum of its pairs' FNV-1a 64, so the order does not matter and a transition updates
 * it by what it changed (`rehash`). The workers' shared visited table (partition.ts) keys on it; the store does not
 * (its keys are exact).
 */
export function stateHash(d: Dims): [number, number] {
  let h: [number, number] = [0, 0];
  for (const [k, v] of d) h = add64(h, fnv64(pairOf(k, v)));
  return h;
}

/** The hash of `to` from the hash of `from`: only the pairs that differ are hashed (both sorted by dimension). */
export function rehash(h: [number, number], from: Dims, to: Dims): [number, number] {
  const a = new Set(from.map(([k, v]) => pairOf(k, v)));
  const b = new Set(to.map(([k, v]) => pairOf(k, v)));
  for (const p of a) if (!b.has(p)) h = sub64(h, fnv64(p));
  for (const p of b) if (!a.has(p)) h = add64(h, fnv64(p));
  return h;
}

/** What a node is when it is stored: where it comes from and what it is. */
export interface NodeMeta {
  parent: number;
  len: number;
  tail: string[];
  tailSteps: SessionEntry[];
  via?: string;
  state: GameState;
  dims: Dims;
}

/** The serialisable content of a store (checkpoint.ts). */
export interface StoreSnapshot {
  compact: boolean;
  keys: string[];
  pairs: string[];
  tails: string[];
  steps: string[];
  labels: string[];
  places: string[];
  parent: number[];
  len: number[];
  tail: number[];
  stepsOf: number[];
  via: number[];
  place: number[];
  seen: number[];
  order: number[];
  edgeFrom: number[];
  edgeTo: number[];
  goals: number[];
  goalStates: [number, GameState][];
  positions: string[];
  /** `objects` only: the whole of every state. */
  objects?: { states: (GameState | null)[]; dims: Dims[]; tails: string[][]; tailSteps: SessionEntry[][] };
}

/**
 * The states a search has seen, by index. `ref` gives a key its index (a transition may point at a state not stored
 * yet: the partial-order reduction postpones it); `insert` stores it; `isSeen` / `seenCount` / `order` are what
 * the search calls `seen`. Edges (from a state to the states its tries reached) are two Int32 columns.
 */
export class StateStore {
  private index = new Map<string, number>();
  private keys: string[] = [];
  private pairs = new Interner();
  private tails = new Interner();
  private stepsI = new Interner();
  private labels = new Interner();
  private places = new Interner();
  private parent = new Ints();
  private len = new Ints();
  private tail = new Ints();
  private stepsOf = new Ints();
  private via = new Ints();
  private place = new Ints();
  private seen = new Ints();
  readonly order = new Ints();
  readonly edgeFrom = new Ints();
  readonly edgeTo = new Ints();
  /** The goal states, in the order they were met (by index), and their engine states (a chapter's boundaries). */
  readonly goals = new Set<number>();
  readonly goalStates = new Map<number, GameState>();
  private positionSet = new Set<string>();
  // `objects`: the 4.1.8 way, everything of every state.
  private states: (GameState | null)[] = [];
  private dimsList: Dims[] = [];
  private tailList: string[][] = [];
  private stepsList: SessionEntry[][] = [];

  constructor(readonly compact: boolean) {}

  /** Every index given (stored or only referred to). */
  get size(): number {
    return this.keys.length;
  }

  get seenCount(): number {
    return this.order.n;
  }

  get positions(): number {
    return this.positionSet.size;
  }

  /** The key of a state's dimensions: interned pairs (compact) or the JSON (objects, as 4.1.8). */
  keyOf(d: Dims): string {
    if (!this.compact) return JSON.stringify(d);
    const ids: number[] = [];
    for (const [k, v] of d) ids.push(this.pairs.id(pairOf(k, v)));
    return encodeIds(ids.sort((a, b) => a - b));
  }

  /** The index of a key, given on first sight (stored or not). */
  ref(key: string): number {
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.keys.length;
      this.index.set(key, i);
      this.keys.push(key);
      for (const c of [this.parent, this.len, this.tail, this.stepsOf, this.via, this.place]) c.push(-1);
      this.seen.push(0);
    }
    return i;
  }

  find(key: string): number | undefined {
    return this.index.get(key);
  }

  isSeen(i: number): boolean {
    return this.seen.at(i) === 1;
  }

  /** Stores a node under index `i` (from `ref`). */
  insert(i: number, m: NodeMeta) {
    this.seen.set(i, 1);
    this.order.push(i);
    this.parent.set(i, m.parent);
    this.len.set(i, m.len);
    this.via.set(i, m.via === undefined ? -1 : this.labels.id(m.via));
    const s = m.state;
    this.place.set(i, this.places.id(`${s.room}\u0001${s.inventory.join(',')}`));
    this.positionSet.add(
      `${s.active ?? ''}|${s.room}|${Object.entries(s.players ?? {})
        .map(([k, p]) => `${k}:${p.room}`)
        .sort()
        .join(',')}`,
    );
    if (this.compact) {
      this.tail.set(i, this.tails.id(JSON.stringify(m.tail)));
      this.stepsOf.set(i, this.stepsI.id(JSON.stringify(m.tailSteps)));
    } else {
      this.states[i] = s;
      this.dimsList[i] = m.dims;
      this.tailList[i] = m.tail;
      this.stepsList[i] = m.tailSteps;
    }
  }

  parentOf(i: number): number {
    return this.parent.at(i);
  }

  lenOf(i: number): number {
    return this.len.at(i);
  }

  viaOf(i: number): string | undefined {
    const v = this.via.at(i);
    return v < 0 ? undefined : this.labels.str(v);
  }

  tailOf(i: number): string[] {
    return this.compact ? (JSON.parse(this.tails.str(this.tail.at(i))) as string[]) : must(this.tailList[i], 'tail');
  }

  stepsAt(i: number): SessionEntry[] {
    return this.compact
      ? (JSON.parse(this.stepsI.str(this.stepsOf.at(i))) as SessionEntry[])
      : must(this.stepsList[i], 'steps');
  }

  /** The labelled path to a stored node, rebuilt from its parents. */
  path(i: number): string[] {
    const parts: string[][] = [];
    for (let x = i; x >= 0; x = this.parent.at(x)) parts.push(this.tailOf(x));
    return parts.reverse().flat();
  }

  /** The session entries to a stored node. */
  steps(i: number): SessionEntry[] {
    const parts: SessionEntry[][] = [];
    for (let x = i; x >= 0; x = this.parent.at(x)) parts.push(this.stepsAt(x));
    return parts.reverse().flat();
  }

  /** Where a stored node stands: the active character's room and bag. */
  placeOf(i: number): { room: Id; inventory: Id[] } {
    const p = this.places.str(this.place.at(i));
    const j = p.indexOf('\u0001');
    const inv = p.slice(j + 1);
    return { room: p.slice(0, j), inventory: inv ? inv.split(',') : [] };
  }

  /** A node's dimensions, as the search computed them (decoded from the key when compact). */
  dimsOf(i: number): Dims {
    if (!this.compact) return must(this.dimsList[i], 'dims');
    return decodeIds(must(this.keys[i], 'key'))
      .map((id): [string, string] => {
        const p = this.pairs.str(id);
        const j = p.indexOf('\u0001');
        return [p.slice(0, j), p.slice(j + 1)];
      })
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** The 4.1.8 key (the JSON of the dimensions) of a stored node: what `keepReachable` lists. */
  jsonKey(i: number): string {
    return JSON.stringify(this.dimsOf(i));
  }

  /** `objects` only: the engine state of a node (the partial-order reduction expands a node again). */
  stateOf(i: number): GameState | null {
    return this.states[i] ?? null;
  }

  edge(from: number, to: number) {
    this.edgeFrom.push(from);
    this.edgeTo.push(to);
  }

  /** Memory held, roughly, in bytes: the typed arrays and the strings (two bytes a unit). Objects mode: not counted. */
  bytes(): number {
    const cols = [this.parent, this.len, this.tail, this.stepsOf, this.via, this.place, this.seen, this.order];
    let b = cols.reduce((n, c) => n + c.a.byteLength, 0) + this.edgeFrom.a.byteLength * 2;
    for (const k of this.keys) b += 2 * k.length + 16;
    for (const t of [this.pairs, this.tails, this.stepsI, this.labels, this.places])
      for (const s of t.list) b += 2 * s.length + 16;
    return b;
  }

  snapshot(): StoreSnapshot {
    const a = (c: Ints) => Array.from(c.slice());
    return {
      compact: this.compact,
      keys: this.keys,
      pairs: this.pairs.list,
      tails: this.tails.list,
      steps: this.stepsI.list,
      labels: this.labels.list,
      places: this.places.list,
      parent: a(this.parent),
      len: a(this.len),
      tail: a(this.tail),
      stepsOf: a(this.stepsOf),
      via: a(this.via),
      place: a(this.place),
      seen: a(this.seen),
      order: a(this.order),
      edgeFrom: a(this.edgeFrom),
      edgeTo: a(this.edgeTo),
      goals: [...this.goals],
      goalStates: [...this.goalStates],
      positions: [...this.positionSet],
      ...(this.compact
        ? {}
        : {
            objects: {
              states: this.states.map((s) => s ?? null),
              dims: this.dimsList,
              tails: this.tailList,
              tailSteps: this.stepsList,
            },
          }),
    };
  }

  static restore(s: StoreSnapshot): StateStore {
    const st = new StateStore(s.compact);
    s.keys.forEach((k, i) => {
      st.index.set(k, i);
      st.keys.push(k);
    });
    st.pairs = new Interner(s.pairs);
    st.tails = new Interner(s.tails);
    st.stepsI = new Interner(s.steps);
    st.labels = new Interner(s.labels);
    st.places = new Interner(s.places);
    st.parent = new Ints(s.parent);
    st.len = new Ints(s.len);
    st.tail = new Ints(s.tail);
    st.stepsOf = new Ints(s.stepsOf);
    st.via = new Ints(s.via);
    st.place = new Ints(s.place);
    st.seen = new Ints(s.seen);
    for (const i of s.order) st.order.push(i);
    for (const i of s.edgeFrom) st.edgeFrom.push(i);
    for (const i of s.edgeTo) st.edgeTo.push(i);
    for (const g of s.goals) st.goals.add(g);
    for (const [i, g] of s.goalStates) st.goalStates.set(i, g);
    for (const p of s.positions) st.positionSet.add(p);
    if (s.objects) {
      st.states = s.objects.states;
      st.dimsList = s.objects.dims;
      st.tailList = s.objects.tails;
      st.stepsList = s.objects.tailSteps;
    }
    return st;
  }
}
