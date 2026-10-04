// Solver: explores every possible action from "New game" (best-first: the state that has progressed
// the most — unlocked places, flags, inventory — is explored first) to prove the game can be finished, and to spot dead
// ends and unused items. States only differ by what matters: props and counters that nothing reads
// (a "2nd time" gag, opening/closing a cupboard with no consequence) don't create a new state.
// Uses the real engine with a silent presenter: whatever the solver finds, the player can do.
import { Engine, type Action, type Source } from '../core/engine';
import type { CustomCommands } from '../core/custom';
import { FakePresenter, MemoryStore } from '../core/ports';
import { check } from '../core/cond';
import { changesState, cmdLists, eachCmd } from '../core/cmds';
import { extraReads, liveness, puzzleGraph } from './puzzle';
import { atomDim, diffDims, independent, readDims, staticTransitions, stubbornKeys, type RW, type Tx } from './por';
import { condAtoms } from '../core/cond';
import type { Cond, GameDef, GameState, Id, Layout, SessionEntry, VerbId } from '../core/types';
import { compileGame } from '../core/define';
import { ruleActionId } from '../core/content-ids';
import { Frontier } from './frontier';

export interface Step { label: string }

/** What the solver measured: where the states come from, what the search cost (`npm run solve -- --profile`). */
export interface SolveProfile {
  ms: number;
  states: number;
  /** Engine runs (one per candidate action per expanded state). */
  tries: number;
  /** Tries that changed nothing (a fallback line, decor): cost time, not states. */
  noops: number;
  /** Candidate actions not even run: no written rule could answer them. */
  skipped: number;
  /** Actions not run because an independent one was tried before them on the way (`por: 'sleep'`). */
  slept: number;
  /** States reached but left to a commuting order (`por: 'stubborn'`). */
  postponed: number;
  /** Tries that landed on a state already seen. */
  hashHits: number;
  maxQueue: number;
  branching: { avg: number; max: number; worst?: { room: string; inventory: string[]; tries: number; effective: number; byVerb: Record<string, number> } };
  /** Per room (summed over its expansions): candidate use/give pairs, how many a written rule answered, how many could only fall to the fallback line. */
  fallbackByRoom: Record<string, { candidates: number; rules: number; fallback: number }>;
  /** The dimensions of the state that split it most: how many states would merge if that one were dropped. */
  dims: { key: string; split: number; values: number }[];
  perRoom: Record<string, number>;
  /** Times each rule, topic, listener or script step answered a try that changed the state (puzzle graph ids). */
  perAction: Record<string, number>;
  /** Times each one answered a try at all, whether or not the state changed: reachability reads this, not `perAction`. */
  attempted: Record<string, number>;
  /** Flags never unset or lowered, items never lost: once gained, kept (what dominance pruning could use). */
  monotonic: { flags: string[]; items: string[] };
  /** Boolean dimensions that evolve independently: their combinations multiply the states (a checkpoint between them helps). */
  independent: { dims: string[]; combos: number; product: number }[];
  /**
   * Where the search's time went, in ms: listing the tries of a state (`tries`), building engines (`engine`), copying
   * states (`clone`), running the engine on a try (`run`), turning states into hashes (`hash`), the queue (`queue`),
   * the rest of the loop (`other`), and after the loop the softlock classification (`classify`).
   */
  timing: Record<'tries' | 'engine' | 'clone' | 'run' | 'hash' | 'queue' | 'other' | 'classify', number>;
  /** Positions of the playable characters among the states: distinct (active, room per character) combinations. */
  positions: number;
  /** The canonical character (`canonicalPlayers`): whether it applied, switches folded into the next action, switches kept explicit. */
  canonical: { applied: boolean; folded: number; explicit: number; reason?: string };
}

export interface SolveResult {
  /** Honest outcome of the requested search. `solved` in witness mode means that at least one path exists. */
  status: 'solved' | 'unsolved' | 'softlocks' | 'truncated' | 'error';
  /** Search contract used for this result. */
  mode: 'witness' | 'prove';
  /** The game reaches the sealed ending or the ending. */
  finished: boolean;
  /** Path found to the ending (or to the last explored state). Not necessarily the shortest. */
  path: string[];
  /** The same path as session entries: `replay()` plays it, the e2e harness taps it. */
  steps: SessionEntry[];
  states: number;
  truncated: boolean;
  flagsReached: string[];
  unlockedReached: string[];
  roomsReached: string[];
  /** Game items that never trigger a written reaction (neither gained nor used). */
  unusedItems: string[];
  /** Items obtained that are never used in a rule. */
  itemsNeverUsed: string[];
  /** States with no action that changes anything (other than the ending). */
  deadEnds: { path: string[]; room: string; inventory: string[] }[];
  /** Reachable states that cannot reach the goal (only complete in `prove` mode). */
  softlocks: { path: string[]; room: string; inventory: string[] }[];
  /** Modelling assumptions made by the solver. */
  assumptions: string[];
  errors: string[];
  /** Invariants that became true (index in `game.invariants`), with the path that broke them. */
  broken: { invariant: number; path: string[] }[];
  /** Proof mode: how many reachable states cannot reach the goal any more (`softlocks` holds at most 20 samples). */
  softlockCount: number;
  /** Proof mode: the softlocks grouped by the step that lost the game (the first action from a safe state into an unsafe one). */
  softlockCauses: { action: string; room: Id; count: number; sample: string[] }[];
  /** Proof mode with a `goal`: every reachable state where the goal holds (a chapter's boundary; `proveChapters` starts the next chapter from each). */
  boundaries: GameState[];
  profile: SolveProfile;
}

export interface SolveOptions {
  maxStates?: number;
  /** `witness` stops at the first solution; `prove` explores the whole reachable graph and finds softlocks. */
  mode?: 'witness' | 'prove';
  /** Where the search starts: a new game, a checkpoint, or a state (a chapter's boundary state, `proveChapters`). */
  start?: 'new' | { checkpoint: Id } | { state: GameState };
  /** Stop when all these conditions hold (a chapter's goals), instead of at the ending. */
  goal?: Cond[];
  /** The game's custom commands: their `effects` apply (their `run` never does here). */
  commands?: CustomCommands;
  /**
   * Partial-order reduction (src/engine/tools/por.ts). `sleep`: two actions that touch different things commute, so
   * after one of them the other is not tried again on the way back (fewer engine runs, the same states). `stubborn`:
   * explores one of several commuting actions at a time (fewer states too). Off by default.
   */
  por?: 'sleep' | 'stubborn' | false;
  /**
   * Lets `por` apply in proof mode. The reductions have no proof of equivalence for softlock detection (the edges
   * they drop feed the reverse reachability): only `tests/por.test.ts` (the differential suite) sets this.
   */
  unsafeReduction?: boolean;
  /**
   * Several playable characters: states that differ only by who is active are one state, and each state offers the
   * actions of every character (`Switch to X › action`). Applies when switching changes nothing the solver reads
   * (checked on every switch: a switch that does change something stays an explicit step) and no invariant or goal
   * (the goal) reads `{ player }`; invariants are checked on every character's view. Default: on in proof mode, off for a witness (whose printed path then stays the same).
   */
  canonicalPlayers?: boolean;
}

interface Node {
  state: GameState; dims: Dims;
  /**
   * The way here, kept as a pointer and the last step only (a copied path per state cost memory and time in the long
   * proofs): `pathOf` / `stepsOf` rebuild it on demand. `len` is the path's length (the best-first score reads it).
   */
  prev?: Node; tail: string[]; tailSteps: SessionEntry[]; len: number;
  /** Sleep set: actions not to try here (an independent one was tried before them on the way), with what they read and wrote. */
  sleep: Map<string, RW>;
  expanded: boolean;
  /** A node seen again with a smaller sleep set: only these actions are still to try. */
  only?: Set<string>;
  /** How it was first reached: the parent's hash and the step's label (the softlock causes walk this). */
  parent?: string;
  via?: string;
}

/** Keys of once / nth blocks: their counter changes behaviour, so it's part of the state. */
function stateKeys(game: GameDef, commands?: CustomCommands, goal?: Cond[]) {
  // What can still change the outcome: a flag nobody but its setter reads, a clock nobody looks at, a walker nobody
  // waits for are left out of the state (and the solver does not spend actions on them).
  const extra = extraReads(game, goal);
  const live = liveness(puzzleGraph(game, { commands }), extra);
  const json = JSON.stringify(game);
  // `seen` only counts if a condition reads it
  const seenRead = new Set<string>();
  for (const m of json.matchAll(/"seen":"([^"]+)"/g)) seenRead.add(m[1]);
  // `visited` too (the room counter is otherwise decor)
  const visitedRead = new Set<string>();
  for (const m of json.matchAll(/"visited":"([^"]+)"/g)) visitedRead.add(m[1]);
  // A prop only counts if a condition reads its state ({ prop: [id, state] }): otherwise opening/closing it is just decor.
  const propRead = new Set<string>();
  const condProps = (c: unknown) => {
    if (!c || typeof c !== 'object') return;
    if (Array.isArray(c)) { c.forEach(condProps); return; }
    const o = c as Record<string, unknown>;
    if (Array.isArray(o.prop) && typeof o.prop[0] === 'string') propRead.add(o.prop[0]);
    Object.values(o).forEach(condProps);
  };
  const findConds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(findConds); return; }
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
  for (const { list } of cmdLists(game)) eachCmd(list, (c) => {
    if (typeof c === 'string') return;
    if ('once' in c) { if (c.key && changesState(c.once)) onceRead.add(c.key); }
    else if ('nth' in c) { if (c.key && changesState(c.nth.flat())) nthRead.set(c.key, c.nth.length - 1); }
    else if ('random' in c) { if (c.key && changesState(c.random.flat())) randomRead.add(c.key); }
  });
  // A counter only counts up to the highest value a condition compares it with: beyond, more `inc` change nothing.
  // A number nobody compares is just true: a script that counts forever doesn't create states forever.
  const flagBounds = new Map<string, number>();
  // …unless something lowers it or sets it to a number (a price haggled down): then the exact value matters.
  const exact = new Set<string>();
  for (const { list } of cmdLists(game)) eachCmd(list, (c) => {
    if (typeof c === 'string') return;
    if ('inc' in c && (c.by ?? 1) < 0) exact.add(c.inc);
    else if ('set' in c && Array.isArray(c.set) && typeof c.set[1] === 'number') exact.add(c.set[0]);
  });
  for (const [k, v] of Object.entries(game.start.flags ?? {})) if (typeof v === 'number') exact.add(k);
  const findBounds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(findBounds); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.flag === 'string') {
      for (const k of ['eq', 'gte', 'lt'] as const) if (typeof o[k] === 'number') flagBounds.set(o.flag, Math.max(flagBounds.get(o.flag) ?? -Infinity, o[k] as number));
    }
    Object.values(o).forEach(findBounds);
  };
  findBounds(game);
  for (const k of exact) flagBounds.delete(k);
  return { once: onceRead, nth: nthRead, random: randomRead, seenRead, visitedRead, propRead, flagBounds, exact, live };
}

/**
 * The state as the solver sees it: one (dimension, value) pair per thing that matters (live items, flags, read props…),
 * sorted. Two states with the same pairs are the same state. The profile counts which dimensions split states.
 */
export type Dims = [string, string][];
function stateDims(s: GameState, keys: ReturnType<typeof stateKeys>): Dims {
  const d: Dims = [['room', s.room]];
  for (const i of s.inventory) if (keys.live.items.has(i)) d.push([`item:${i}`, '1']);
  for (const [k, v] of Object.entries(s.flags)) {
    if (!keys.live.flags.has(k)) continue;
    if (typeof v !== 'number') { if (v) d.push([`flag:${k}`, JSON.stringify(v)]); continue; }
    const b = keys.flagBounds.get(k);
    const x = keys.exact.has(k) ? v : b === undefined ? (v ? 1 : 0) : Math.min(v, b + 1);
    if (x) d.push([`flag:${k}`, String(x)]);
  }
  for (const [k, v] of Object.entries(s.props)) if (keys.propRead.has(k.includes('.') ? k.slice(k.indexOf('.') + 1) : k) || keys.propRead.has(k)) d.push([`prop:${k}`, v]);
  for (const u of s.unlocked) d.push([`place:${u}`, '1']);
  for (const [k, a] of Object.entries(s.actors)) if (a.visible !== undefined) d.push([`visible:${k}`, a.visible ? '1' : '0']);
  for (const [k, v] of Object.entries(s.counters)) {
    if (keys.once.has(k)) { if (v) d.push([`once:${k}`, '1']); }
    else if (keys.nth.has(k)) d.push([`nth:${k}`, String(Math.min(v, keys.nth.get(k)!))]);
    else if (keys.random.has(k)) d.push([`random:${k}`, String(v)]);
  }
  // `once` listeners (`event.*`) change what the next emit does: they are part of the state.
  for (const k of Object.keys(s.seen)) if (keys.seenRead.has(k) || k.startsWith('event.')) d.push([`seen:${k}`, '1']);
  for (const [k, n] of Object.entries(s.visited)) if (n && keys.visitedRead.has(k)) d.push([`visited:${k}`, '1']);
  if (s.done) d.push(['done', '1']);
  for (const u of s.used ?? []) if (keys.live.items.has(u)) d.push([`used:${u}`, '1']);
  for (const [k, r] of Object.entries(s.where ?? {})) if (keys.live.actors.has(k)) d.push([`where:${k}`, r]);
  for (const [k, st] of Object.entries(s.scripts ?? {})) if (keys.live.actions.has(k)) d.push([`script:${k}`, `${st.pc}${st.done ? 'd' : ''}${st.off ? 'x' : ''}`]);
  if (s.active) d.push(['active', s.active]);
  for (const [k, p] of Object.entries(s.players ?? {})) d.push([`player:${k}`, `${p.room} ${p.inventory.filter((i) => keys.live.items.has(i)).sort().join(',')} ${(p.used ?? []).filter((i) => keys.live.items.has(i)).sort().join(',')}`]);
  return d.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

function hashState(s: GameState, keys: ReturnType<typeof stateKeys>): string { return JSON.stringify(stateDims(s, keys)); }

/**
 * The same dimensions with nobody active: every playable character's room and bag (`pos:<id>`), whoever holds the
 * controls. Two states that differ only by the active character get the same dimensions.
 */
function canonicalDims(d: Dims, s: GameState, keys: ReturnType<typeof stateKeys>, hero: Id, shared: boolean): Dims {
  const live = (xs: Id[] | undefined) => (xs ?? []).filter((i) => keys.live.items.has(i)).sort().join(',');
  const out = d.filter(([k]) => k !== 'active' && k !== 'room' && !k.startsWith('player:') && (shared || (!k.startsWith('item:') && !k.startsWith('used:'))));
  out.push([`pos:${s.active ?? hero}`, shared ? s.room : `${s.room} ${live(s.inventory)} ${live(s.used)}`]);
  for (const [k, p] of Object.entries(s.players ?? {})) out.push([`pos:${k}`, shared ? p.room : `${p.room} ${live(p.inventory)} ${live(p.used)}`]);
  return out.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

/** The labelled path to a node, rebuilt from its parents. */
function pathOf(n: Node): string[] {
  const parts: string[][] = [];
  for (let x: Node | undefined = n; x; x = x.prev) parts.push(x.tail);
  return parts.reverse().flat();
}
/** The session entries to a node, rebuilt from its parents. */
function stepsOf(n: Node): SessionEntry[] {
  const parts: SessionEntry[][] = [];
  for (let x: Node | undefined = n; x; x = x.prev) parts.push(x.tailSteps);
  return parts.reverse().flat();
}

/** Flags never unset or lowered, items never lost, transferred or used up: once gained, kept. */
export function monotonicThings(game: GameDef): { flags: string[]; items: string[] } {
  const flagsSet = new Set<string>(), flagsDown = new Set<string>(), itemsGained = new Set<string>(), itemsLost = new Set<string>();
  for (const { list } of cmdLists(game)) eachCmd(list, (c) => {
    if (typeof c === 'string') return;
    if ('set' in c) { const [k, v] = Array.isArray(c.set) ? c.set : [c.set, true]; (v === false ? flagsDown : flagsSet).add(k); }
    else if ('unset' in c) flagsDown.add(c.unset);
    else if ('inc' in c) ((c.by ?? 1) < 0 ? flagsDown : flagsSet).add(c.inc);
    else if ('gain' in c) itemsGained.add(c.gain);
    else if ('lose' in c) itemsLost.add(c.lose);
    else if ('used' in c) (Array.isArray(c.used) ? c.used : [c.used]).forEach((u) => itemsLost.add(u));
    else if ('transfer' in c) itemsLost.add(c.transfer[0]);
  });
  for (const k of Object.keys(game.start.flags ?? {})) flagsSet.add(k);
  for (const i of game.start.inventory ?? []) itemsGained.add(i);
  return { flags: [...flagsSet].filter((k) => !flagsDown.has(k)).sort(), items: [...itemsGained].filter((i) => !itemsLost.has(i)).sort() };
}

/** A 32-bit hash of a string. */
function h32(str: string): number { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

/**
 * Which dimensions split the states: for each one, how many states would merge if it were dropped (two states that
 * differ only by it count as one). Each state is the XOR of its pairs' hashes; dropping a pair is one more XOR.
 */
function splits(all: Dims[]): { key: string; split: number; values: number }[] {
  const pair = new Map<string, number>();
  const ph = (k: string, v: string) => { const key = `${k}\u0000${v}`; let x = pair.get(key); if (x === undefined) { x = h32(key); pair.set(key, x); } return x; };
  const H = all.map((d) => d.reduce((acc, [k, v]) => acc ^ ph(k, v), 0));
  const byDim = new Map<string, { states: number[]; ph: number[]; values: Set<string> }>();
  all.forEach((d, i) => { for (const [k, v] of d) { let b = byDim.get(k); if (!b) { b = { states: [], ph: [], values: new Set() }; byDim.set(k, b); } b.states.push(i); b.ph.push(ph(k, v)); b.values.add(v); } });
  const out: { key: string; split: number; values: number }[] = [];
  for (const [key, b] of byDim) {
    if (b.states.length === all.length && b.values.size === 1) continue; // a constant never splits
    const set = new Set(H);
    for (let j = 0; j < b.states.length; j++) { set.delete(H[b.states[j]]); set.add(H[b.states[j]] ^ b.ph[j]); }
    out.push({ key, split: all.length - set.size, values: b.values.size + (b.states.length < all.length ? 1 : 0) });
  }
  return out.sort((a, b) => b.split - a.split || a.key.localeCompare(b.key));
}

/** Groups of two-valued dimensions whose observed combinations fill (nearly) the whole product: they evolve independently. */
function independentGroups(all: Dims[], dims: { key: string; values: number }[]): { dims: string[]; combos: number; product: number }[] {
  const cand = dims.filter((d) => d.values === 2).slice(0, 12).map((d) => d.key);
  if (cand.length < 2) return [];
  const value = (d: Dims, k: string) => d.find(([x]) => x === k)?.[1] ?? '';
  const combos = (keys: string[]) => new Set(all.map((d) => keys.map((k) => value(d, k)).join('\u0001'))).size;
  const groups: string[][] = [];
  const taken = new Set<string>();
  for (const k of cand) {
    if (taken.has(k)) continue;
    const g = [k];
    for (const k2 of cand) { if (k2 === k || taken.has(k2)) continue; if (combos([...g, k2]) >= 0.8 * 2 ** (g.length + 1)) g.push(k2); }
    if (g.length >= 3) { g.forEach((x) => taken.add(x)); groups.push(g); }
  }
  return groups.map((g) => ({ dims: g, combos: combos(g), product: 2 ** g.length }));
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Waits for an engine promise to settle, playing the guided-tutorial steps whenever one is pending.
 * `onGuide` receives the action played (for the path).
 */
async function drive(engine: Engine, p: Promise<unknown>, onGuide: (a: Action) => void): Promise<void> {
  let done = false;
  let error: unknown;
  const settled = p.then(() => { done = true; }, (e) => { done = true; error = e; });
  for (let guard = 0; !done && guard < 500; guard++) {
    // The silent presenter resolves everything in microtasks: without a tutorial, we never wait on the timer.
    await Promise.race([settled, tick()]);
    const g = engine.guiding;
    if (g && !done) {
      const act: Action = { verb: g.verb, a: g.target };
      onGuide(act);
      await engine.act(act);
    }
  }
  if (!done) throw new Error('the engine never yields control back (tutorial or stuck choice?)');
  if (error) throw error;
}

function label(game: GameDef, a: Action): string {
  const v = game.verbs.find((x) => x.id === a.verb);
  return a.b ? `${v?.label ?? a.verb} ${a.a} ${v?.join ?? '→'} ${a.b}` : `${v?.label ?? a.verb} ${a.a}`;
}

/**
 * What a chapter reads of a state, as a key: two boundary states with the same key are the same start for that
 * chapter (its rules, hints, scripts and goal read nothing else). `proveChapters` dedupes the previous chapter's
 * boundaries by it.
 */
export function projectState(gameIn: GameDef, layouts: Record<string, Layout>, state: GameState, opts: Pick<SolveOptions, 'commands' | 'goal' | 'canonicalPlayers'> = {}): string {
  const game = compileGame(gameIn) as GameDef;
  const keyed = new Engine(game, layouts, new FakePresenter(), new MemoryStore(), { commands: opts.commands });
  const keys = stateKeys(keyed.game, opts.commands, opts.goal);
  const d = stateDims(state, keys);
  // The same canonical character as the proof that starts from it: the active character does not split boundaries.
  const canonical = (opts.canonicalPlayers ?? true) && (game.players?.ids.length ?? 1) > 1 && !JSON.stringify(opts.goal ?? []).includes('"player"');
  return JSON.stringify(canonical ? canonicalDims(d, state, keys, game.hero, !!game.players?.sharedInventory) : d);
}

export async function solve(gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions = {}): Promise<SolveResult> {
  const maxStates = opts.maxStates ?? 20000;
  const mode = opts.mode ?? 'witness';
  const game = compileGame(gameIn) as GameDef;
  const keys0 = new Engine(game, layouts, new FakePresenter(), new MemoryStore(), { commands: opts.commands }); // assigns the keys
  const keys = stateKeys(keys0.game, opts.commands, opts.goal);
  const playerIds = game.players?.ids ?? [game.hero];
  // A goal that reads `{ player }` makes the active character part of the question: no canonical character then.
  // Invariants are checked on every variant of a state instead (each one is a concrete state the player can reach).
  const readsPlayer = JSON.stringify(opts.goal ?? []).includes('"player"');
  const canonical = (opts.canonicalPlayers ?? mode === 'prove') && playerIds.length > 1 && !readsPlayer;
  const canonInfo: SolveProfile['canonical'] = { applied: canonical, folded: 0, explicit: 0, ...(playerIds.length > 1 && (opts.canonicalPlayers ?? mode === 'prove') && readsPlayer ? { reason: 'the goal reads { player }' } : {}) };
  const shared = !!game.players?.sharedInventory;
  const dimsOf = (st: GameState): Dims => canonical ? canonicalDims(stateDims(st, keys), st, keys, game.hero, shared) : stateDims(st, keys);
  const errors: string[] = [];
  const itemsInRules = new Set<string>();
  const itemsSeen = new Set<string>();
  const flags = new Set<string>();
  const unlocked = new Set<string>();
  const roomsReached = new Set<string>();
  const deadEnds: SolveResult['deadEnds'] = [];
  const gained = new Set<string>();
  // The profile
  const t0 = Date.now();
  let tries_total = 0, skipped = 0, slept = 0, postponed = 0, noops = 0, hashHits = 0, maxQueue = 0, expansions = 0, triesSum = 0, triesMax = 0;
  let worst: SolveProfile['branching']['worst'];
  const perRoom = new Map<string, number>(), perAction = new Map<string, number>(), attempted = new Map<string, number>();
  const fallbackByRoom = new Map<string, { candidates: number; rules: number; fallback: number }>();
  const timing: SolveProfile['timing'] = { tries: 0, engine: 0, clone: 0, run: 0, hash: 0, queue: 0, other: 0, classify: 0 };
  const now = () => performance.now();
  const timed = <T>(k: keyof SolveProfile['timing'], f: () => T): T => { const t = now(); try { return f(); } finally { timing[k] += now() - t; } };
  const loopStart = { t: 0 };

  const randomBranchValues = [...new Set(cmdLists(game).flatMap(({ list }) => {
    const sizes: number[] = [];
    eachCmd(list, (c) => { if (typeof c !== 'string' && 'random' in c && c.random.length) sizes.push(c.random.length); });
    return sizes.flatMap((n) => Array.from({ length: n }, (_, i) => (i + 0.5) / n));
  }))].sort((a, b) => a - b);
  const makeEngine = (rnd: number[] = []) => {
    const t = now();
    const ui = new FakePresenter();
    const e = new Engine(game, layouts, ui, new MemoryStore(), { commands: opts.commands });
    timing.engine += now() - t;
    const draws = [...rnd];
    e.random = () => draws.shift() ?? 0;
    return { e, ui };
  };

  // Starting state
  const { e: e0, ui: ui0 } = makeEngine();
  const startPath: string[] = [];
  if (opts.start && typeof opts.start === 'object') { if ('checkpoint' in opts.start) await e0.checkpoint(opts.start.checkpoint); else await e0.load(structuredClone(opts.start.state)); }
  else await drive(e0, e0.newGame(), (a) => startPath.push(`(tutorial) ${label(game, a)}`));
  const reached = (ui: FakePresenter, s: GameState) => opts.goal ? opts.goal.every((c) => check(c, s)) : (s.done || ui.log.includes('ENDING'));
  const broken: SolveResult['broken'] = [];
  const brokenSeen = new Set<number>();
  const checkInvariants = (s: GameState, path: () => string[]) => {
    (game.invariants ?? []).forEach((c, i) => { if (!brokenSeen.has(i) && check(c, s)) { brokenSeen.add(i); broken.push({ invariant: i, path: path() }); } });
  };

  const seen = new Map<string, Node>();
  // A reduction must not remove a losing branch from a proof. Keep proof mode deliberately conservative until the
  // reductions themselves have a model-equivalence proof.
  const por = mode === 'prove' && !opts.unsafeReduction ? false : (opts.por ?? false);
  const stx = por === 'stubborn' ? staticTransitions(puzzleGraph(game, { commands: opts.commands })) : null;
  // What the search looks for: an action that changes it is never postponed by the reduction.
  const goalDims = new Set<string>(['done', ...(opts.goal ?? []).flatMap((c) => condAtoms(c).map(atomDim))]);
  const start: Node = { state: structuredClone(e0.state), tail: startPath, tailSteps: e0.session?.log ?? [], len: startPath.length, dims: dimsOf(e0.state), sleep: new Map(), expanded: false };
  // Best-first: the more a state has progressed, the earlier it's explored. At equal progress, the shortest path first.
  const score = (n: Node) => n.state.unlocked.length * 20 + Object.values(n.state.flags).filter(Boolean).length * 3 + n.state.inventory.length * 2 - n.len * 0.01;
  // A heap in the order of the old sorted list (score, then arrival): same witnesses, O(log n) instead of O(n).
  const queue = new Frontier<Node>(score);
  queue.push(start);
  const enqueue = (n: Node) => queue.push(n);
  seen.set(JSON.stringify(start.dims), start);
  let finish: Node | null = reached(ui0, e0.state) ? start : null;
  const startHash = JSON.stringify(start.dims);
  const goals = new Set<string>(finish ? [startHash] : []);
  // A proof from "New game" branches over the intro's choices too (the silent presenter picks the last option by
  // default): each choice met during the start is varied one at a time, the others at their default. Without this,
  // a flag the intro sets from a choice would be "proved" on one value only.
  if (mode === 'prove' && (opts.start === undefined || opts.start === 'new')) {
    for (let j = 0; j < ui0.asked.length; j++) for (let o = 0; o < ui0.asked[j].n - 1; o++) {
      const { e, ui } = makeEngine();
      ui.picks = [...ui0.asked.slice(0, j).map((a) => a.n - 1), o];
      const path: string[] = [`New game › "${ui0.asked[j].texts[o]}"`];
      await drive(e, e.newGame(), (a) => path.push(`(tutorial) ${label(game, a)}`));
      const dims = dimsOf(e.state);
      const h = JSON.stringify(dims);
      if (seen.has(h)) continue;
      const alt: Node = { state: structuredClone(e.state), tail: path, tailSteps: e.session?.log ?? [], len: path.length, dims, sleep: new Map(), expanded: false };
      seen.set(h, alt);
      enqueue(alt);
      if (reached(ui, e.state)) { goals.add(h); finish ??= alt; }
    }
  }
  const edges = new Map<string, Set<string>>();
  let limitReached = false;
  let last: Node = start;
  checkInvariants(start.state, () => pathOf(start));

  loopStart.t = now();
  while (queue.size && (mode === 'prove' || !finish)) {
    if (seen.size >= maxStates) { limitReached = true; break; }
    const node = timed('queue', () => queue.pop()!);
    const tTries = now(), engineBefore = timing.engine, cloneBefore = timing.clone;
    last = node;
    const s = node.state;
    roomsReached.add(s.room);
    perRoom.set(s.room, (perRoom.get(s.room) ?? 0) + 1);
    Object.entries(s.flags).forEach(([k, v]) => v && flags.add(k));
    s.unlocked.forEach((u) => unlocked.add(u));
    s.inventory.forEach((i) => itemsSeen.add(i));

    // List of actions to try
    // `picks`: the answers given to the choices met on the way (a topic index first, then nested `choice` prompts);
    // whatever is not given defaults to the last option. After a run, every other option of a prompt is a new try.
    type Try = { label: string; run: (e: Engine) => Promise<Source | null | void>; items: string[]; picks: number[]; rnd: number[]; pair?: true; /** The content actions that could answer (puzzle graph ids). */ candidates: string[] };
    const keyOf = (t: Try) => `${t.label}|p=${t.picks.join(',')}|r=${t.rnd.join(',')}`;
    const tries: Try[] = [];
    const tryKeys = new Set<string>();
    const addTry = (t: Try) => { const k = keyOf(t); if (!tryKeys.has(k)) { tryKeys.add(k); tries.push(t); } };
    // The canonical character: the same state seen from each other character it can switch to without changing
    // anything the solver reads (`canonicalPlayers`); their actions are tried from here, prefixed by the switch.
    const h0 = JSON.stringify(node.dims);
    const variants: { st: GameState; via?: Id }[] = [{ st: s }];
    const explicitSwitch: Id[] = [];
    if (canonical) for (const pid of playerIds) {
      if (pid === (s.active ?? game.hero)) continue;
      const { e } = makeEngine();
      e.state = timed('clone', () => structuredClone(s));
      try { await drive(e, e.switchTo(pid), () => {}); } catch { explicitSwitch.push(pid); continue; }
      if (JSON.stringify(dimsOf(e.state)) === h0) { variants.push({ st: e.state, via: pid }); canonInfo.folded++; checkInvariants(e.state, () => [...pathOf(node), `Switch to ${pid}`]); }
      else { explicitSwitch.push(pid); canonInfo.explicit++; }
    }
    for (const variant of variants) {
      const s = variant.st;
      const add = (t: Try) => addTry(variant.via ? { ...t, label: `Switch to ${variant.via} › ${t.label}`, run: async (e) => { await e.switchTo(variant.via!); return t.run(e); } } : t);
      const probe = makeEngine().e;
      probe.state = timed('clone', () => structuredClone(s));
      const room = probe.room();
      const targets = probe.targets(room);
      const inv = s.inventory;
      const verbs = game.verbs.map((v) => v.id) as VerbId[];
      // An action no written rule can answer (whatever the conditions) falls to a look line, a kind reaction or the
      // fallback line: nothing changes, so the engine is not even run. The exceptions that do change something without
      // a rule: talking to the hint item, giving to another playable character (the topics are tries of their own).
      const rules = [...(room.on ?? []).map((r, i) => ({ r, id: ruleActionId(room.id, i, r) })), ...(game.rules.on ?? []).map((r, i) => ({ r, id: ruleActionId('game', i, r) }))];
      const hasId = (x: Id | Id[] | undefined, v: Id | undefined) => x === undefined ? v === undefined : v !== undefined && (Array.isArray(x) ? x.includes(v) : x === v);
      const answers = (v: VerbId, a: Id, b?: Id) => rules.filter(({ r }) => (Array.isArray(r.verb) ? r.verb.includes(v) : r.verb === v) &&
        ((hasId(r.a, a) && hasId(r.b, b)) || (!!b && inv.includes(a) && inv.includes(b) && hasId(r.a, b) && hasId(r.b, a)))).map((x) => x.id);
      const answered = (v: VerbId, a: Id, b?: Id) => answers(v, a, b).length > 0;
      const fb = fallbackByRoom.get(s.room) ?? { candidates: 0, rules: 0, fallback: 0 };
      fallbackByRoom.set(s.room, fb);
      for (const t of [...targets, ...inv]) for (const v of verbs) {
        if (v === 'talk' && room.talk?.[t]) continue; // handled by topics
        if (!answered(v, t) && !(v === 'talk' && t === game.hintItem && inv.includes(t))) { skipped++; continue; }
        add({ label: label(game, { verb: v, a: t }), run: (e) => e.act({ verb: v, a: t }), items: inv.includes(t) ? [t] : [], picks: [], rnd: [], candidates: answers(v, t) });
      }
      for (const it of inv) for (const t of [...targets, ...inv.filter((x) => x !== it)]) for (const v of ['use', 'give'] as VerbId[]) {
        if (v === 'give' && inv.includes(t)) continue;
        fb.candidates++;
        if (!answered(v, it, t) && !(v === 'give' && probe.isPlayer(t) && t !== probe.heroId())) { fb.fallback++; skipped++; continue; }
        add({ label: label(game, { verb: v, a: it, b: t }), run: (e) => e.act({ verb: v, a: it, b: t }), items: inv.includes(t) ? [it, t] : [it], picks: [], rnd: [], pair: true, candidates: answers(v, it, t) });
      }
      for (const [actor, topics] of Object.entries(room.talk ?? {})) {
        if (!targets.includes(actor)) continue;
        // the engine numbers visible topics: the label must follow the same list (otherwise the printed path would lie)
        topics.map((tp, orig) => ({ tp, orig })).filter(({ tp }) => check(tp.if, s, room.id)).forEach(({ tp, orig }, i) => add({
          label: `Talk ${actor}: "${tp.topic}"`, run: (e) => e.act({ verb: 'talk', a: actor }), items: [], picks: [i], rnd: [], candidates: [`topic:${tp.id ?? `${room.id}/${actor}[${orig}]`}`],
        }));
      }
      for (const [pid, p] of Object.entries(game.map?.places ?? {})) {
        if (!s.unlocked.includes(pid) || p.room === s.room || !game.rooms.some((r) => r.id === p.room)) continue;
        add({ label: `Map → ${p.name}`, run: (e) => e.travel(pid), items: [], picks: [], rnd: [], candidates: [] });
      }
      // Several playable characters: taking control of another one.
      for (const pid of probe.playerIds()) if (pid !== probe.heroId() && (!canonical || explicitSwitch.includes(pid))) add({ label: `Switch to ${pid}`, run: (e) => e.switchTo(pid).then(() => undefined), items: [], picks: [], rnd: [], candidates: [] });
      // The world's scripts: letting one run until its next wait (or its end) is something the player can do by waiting.
      for (const sc of probe.scriptsHere()) {
        const st = s.scripts?.[sc.id];
        if (st?.done || st?.off || !keys.live.actions.has(sc.id)) continue;
        add({ label: `Script ${sc.id}`, run: (e) => e.runScript(sc.id, true).then(() => undefined), items: [], picks: [], rnd: [], candidates: [`script:${sc.id}`] });
      }
    }

    timing.tries += now() - tTries - (timing.engine - engineBefore) - (timing.clone - cloneBefore);
    let progressed = false;
    const byVerb: Record<string, number> = {};
    let effective = 0;
    const only = node.only;
    node.only = undefined;
    // The effective actions tried here so far, with what they read and wrote: the later ones sleep them in their children.
    const done: { key: string; rw: RW }[] = [];
    // Stubborn mode: every try as a transition (what it read and wrote, whether it changed anything), the children
    // kept aside until the set to expand is known.
    const txs: Tx[] = [];
    const children: { key: string; next: Node; h: string; ui: FakePresenter }[] = [];
    let anyHit = false;
    for (let ti = 0; ti < tries.length; ti++) {
      const t = tries[ti];
      const key = keyOf(t);
      if (por === 'sleep' && node.sleep.has(key)) { slept++; progressed = true; continue; }
      if (only && !only.has(key)) continue;
      tries_total++;
      const { e, ui } = makeEngine(t.rnd);
      e.state = timed('clone', () => structuredClone(s));
      if (por) e.reads = new Set();
      ui.picks = [...t.picks];
      const path: string[] = []; // this step's tutorial moves, then its label
      let src: Source | null | void = null;
      const tRun = now();
      try {
        await drive(e, t.run(e).then((r) => { src = r; }), (a) => path.push(`(tutorial) ${label(game, a)}`));
      } catch (err) {
        errors.push(`${t.label} (${s.room}): ${(err as Error).message}`);
        continue;
      } finally { timing.run += now() - tRun; }
      // Other answers to every nested `choice` prompt. There is deliberately no hidden variant ceiling: maxStates is
      // the one explicit search budget, and reaching it returns `truncated`.
      for (let j = t.picks.length; j < ui.asked.length; j++) {
        const q = ui.asked[j];
        if (q.topic || q.n < 2) continue;
        const prefix = [...t.picks, ...ui.asked.slice(t.picks.length, j).map((a) => a.n - 1)];
        for (let o = 0; o < q.n - 1; o++) {
          const base = t.label.replace(/ › ".*$/, '');
          const chosen = [...prefix.slice(t.picks.length), o].map((pick, k) => ui.asked[t.picks.length + k].texts[pick]);
          addTry({ ...t, label: `${base} › ${chosen.map((x) => `"${x}"`).join(' › ')}`, picks: [...prefix, o] });
        }
      }
      // The engine records every random draw in the session. Expand every newly observed draw with representative
      // values for every random block arity in the game; state hashing removes duplicates. This explores nested
      // random blocks just like nested dialogue choices, instead of forcing branch zero.
      const drawn = (e.session?.log ?? []).flatMap((entry) => entry.rnd ?? []);
      for (let j = t.rnd.length; j < drawn.length; j++) {
        const prefix = [...t.rnd, ...drawn.slice(t.rnd.length, j)];
        for (const value of randomBranchValues) if (value !== drawn[j]) addTry({ ...t, rnd: [...prefix, value] });
      }
      if (src === 'rule' || src === 'hint') t.items.forEach((i) => itemsInRules.add(i));
      if (t.pair) { const fb = fallbackByRoom.get(s.room); if (fb) { if (src === 'rule') fb.rules++; else if (src === 'fallback') fb.fallback++; } }
      // Reported even when the state is not worth exploring (a flag nobody reads, a trinket no gate needs): it did happen.
      Object.entries(e.state.flags).forEach(([k, v]) => v && flags.add(k));
      e.state.inventory.forEach((i) => gained.add(i));
      // What answered this try, even when nothing changed: a topic that only talks is reachable all the same.
      for (const en of e.session?.log ?? []) for (const id of en.ran ?? []) attempted.set(id, (attempted.get(id) ?? 0) + 1);
      const tHash = now();
      const dims = dimsOf(e.state);
      const h = JSON.stringify(dims);
      timing.hash += now() - tHash;
      const hitGoal = reached(ui, e.state);
      if (hitGoal) goals.add(h);
      const rw: RW | null = por ? { reads: readDims(e.reads!), writes: diffDims(node.dims, dims) } : null;
      if (h === h0) {
        noops++;
        if (stx && rw) {
          // A transition a condition holds back: what it would change, and the gates that hold it, from the content.
          const cands = t.candidates.map((c) => stx.byId.get(c)).filter((x) => !!x);
          cands.forEach((c) => c.writes.forEach((w) => rw.writes.add(w)));
          if (rw.writes.size) txs.push({ key, enabled: false, rw, candidates: t.candidates, gates: cands.map((c) => c.gates), visible: false });
        }
        continue;
      }
      progressed = true;
      (edges.get(h0) ?? (edges.set(h0, new Set()), edges.get(h0)!)).add(h);
      effective++;
      byVerb[t.label.split(' ')[0]] = (byVerb[t.label.split(' ')[0]] ?? 0) + 1;
      for (const en of e.session?.log ?? []) for (const id of en.ran ?? []) perAction.set(id, (perAction.get(id) ?? 0) + 1);
      const sleep = new Map<string, RW>();
      if (por === 'sleep' && rw) {
        for (const [k, r] of node.sleep) if (independent(r, rw)) sleep.set(k, r);
        for (const d of done) if (independent(d.rw, rw)) sleep.set(d.key, d.rw);
        done.push({ key, rw });
      }
      if (stx && rw) txs.push({ key, enabled: true, rw, candidates: t.candidates, gates: [], visible: [...rw.writes].some((w) => goalDims.has(w)) });
      if (seen.has(h) || children.some((c) => c.h === h)) {
        hashHits++;
        anyHit = true;
        if (por === 'sleep' && seen.has(h)) {
          // The same state, reached with a different sleep set: only what both paths sleep stays asleep; what this path
          // frees is still to be tried there.
          const stored = seen.get(h)!;
          const freed = [...stored.sleep.keys()].filter((k) => !sleep.has(k));
          if (freed.length) {
            for (const k of freed) stored.sleep.delete(k);
            if (stored.expanded) { if (stored.only) freed.forEach((k) => stored.only!.add(k)); else { stored.only = new Set(freed); enqueue(stored); } }
          }
        }
        continue;
      }
      const tClone = now();
      const next: Node = { state: structuredClone(e.state), prev: node, tail: [...path, t.label], tailSteps: e.session?.log ?? [], len: node.len + path.length + 1, dims, sleep, expanded: false, parent: h0, via: t.label };
      timing.clone += now() - tClone;
      checkInvariants(next.state, () => pathOf(next));
      if (hitGoal) {
        seen.set(h, next);
        finish ??= next;
        if (mode === 'witness') break;
        // The ending is terminal. Keep trying the other actions from the source state, but do not expand past it.
        continue;
      }
      children.push({ key, next, h, ui });
    }
    if (mode === 'prove' || !finish) {
      // Stubborn mode: of the commuting actions, one at a time. The content's actions no try stands for (a hidden
      // topic, a rule on something not shown yet) count as held-back transitions too.
      let keep: Set<string> | null = null;
      if (stx) {
        const covered = new Set(txs.flatMap((t) => t.candidates));
        for (const st of stx.forRoom(s.room)) if (!covered.has(st.id)) txs.push({ key: st.id, enabled: false, rw: { reads: new Set([...st.reads, ...st.gates.map(atomDim)]), writes: new Set(st.writes) }, candidates: [st.id], gates: [st.gates], visible: false });
        keep = stubbornKeys(txs, stx, s, s.room, { all: anyHit });
        postponed += children.filter((c) => !keep!.has(c.key)).length;
      }
      for (const c of children) {
        if (keep && !keep.has(c.key)) continue;
        seen.set(c.h, c.next);
        timed('queue', () => enqueue(c.next));
        maxQueue = Math.max(maxQueue, queue.size);
        if (seen.size >= maxStates) { if (queue.size) limitReached = true; break; }
      }
    }
    node.expanded = true;
    expansions++;
    triesSum += tries.length;
    if (tries.length > triesMax) { triesMax = tries.length; worst = { room: s.room, inventory: [...s.inventory], tries: tries.length, effective, byVerb }; }
    if (!progressed && deadEnds.length < 20) deadEnds.push({ path: pathOf(node), room: s.room, inventory: [...s.inventory] });
  }
  const loopMs = now() - loopStart.t;
  timing.other = Math.max(0, loopMs - timing.tries - timing.engine - timing.clone - timing.run - timing.hash - timing.queue);
  const all = seen.size <= 50000 ? [...seen.values()].map((n) => n.dims) : [];
  const dims = splits(all).slice(0, 30);
  const positions = new Set([...seen.values()].map((n) => `${n.state.active ?? ''}|${n.state.room}|${Object.entries(n.state.players ?? {}).map(([k, p]) => `${k}:${p.room}`).sort().join(',')}`)).size;
  const profile: SolveProfile = {
    ms: Date.now() - t0, states: seen.size, tries: tries_total, skipped, slept, postponed, noops, hashHits, maxQueue,
    branching: { avg: expansions ? triesSum / expansions : 0, max: triesMax, ...(worst ? { worst } : {}) },
    fallbackByRoom: Object.fromEntries(fallbackByRoom), dims, perRoom: Object.fromEntries(perRoom), perAction: Object.fromEntries(perAction), attempted: Object.fromEntries(attempted),
    monotonic: monotonicThings(game), independent: independentGroups(all, dims), timing, positions, canonical: canonInfo,
  };

  const tClassify = now();
  // In proof mode, a state is safe iff a goal is reachable from it. Reverse reachability classifies cycles as well as
  // immediate dead ends, which the old `progressed` test could not do.
  const canReachGoal = new Set<string>();
  if (mode === 'prove' && !limitReached && goals.size) {
    const reverse = new Map<string, Set<string>>();
    for (const [from, tos] of edges) for (const to of tos) (reverse.get(to) ?? (reverse.set(to, new Set()), reverse.get(to)!)).add(from);
    const todo = [...goals];
    while (todo.length) {
      const h = todo.pop()!;
      if (canReachGoal.has(h)) continue;
      canReachGoal.add(h);
      for (const p of reverse.get(h) ?? []) todo.push(p);
    }
  }
  const unsafe = mode === 'prove' && !limitReached && finish ? [...seen.entries()].filter(([h]) => !canReachGoal.has(h)) : [];
  const softlocks = [...unsafe].sort(([, a], [, b]) => a.len - b.len).slice(0, 20).map(([, n]) => ({ path: pathOf(n), room: n.state.room, inventory: [...n.state.inventory] }));
  // The step that lost the game: walk each unsafe state up to the first unsafe one whose parent is safe (or the start).
  const causes = new Map<string, { action: string; room: Id; count: number; len: number; node: Node }>();
  for (const [, n] of unsafe) {
    let cur: Node = n;
    while (cur.parent && !canReachGoal.has(cur.parent) && seen.has(cur.parent)) cur = seen.get(cur.parent)!;
    const action = cur.via ?? '(start)';
    const room = cur.parent ? seen.get(cur.parent)!.state.room : cur.state.room;
    const key = `${room}\u0000${action}`;
    const c = causes.get(key);
    if (c) { c.count++; if (cur.len < c.len) { c.len = cur.len; c.node = cur; } } else causes.set(key, { action, room, count: 1, len: cur.len, node: cur });
  }
  const softlockCauses = [...causes.values()].sort((a, b) => b.count - a.count || a.action.localeCompare(b.action)).map(({ action, room, count, node }) => ({ action, room, count, sample: pathOf(node) }));
  timing.classify = now() - tClassify;
  const boundaries = mode === 'prove' && opts.goal && !limitReached ? [...goals].map((h) => seen.get(h)!).filter(Boolean).map((n) => structuredClone(n.state)) : [];
  const assumptions = new Set<string>();
  for (const { list } of cmdLists(game)) eachCmd(list, (c) => { if (typeof c !== 'string' && 'minigame' in c) assumptions.add(`minigame:${c.minigame}:success`); });
  const uniqueErrors = [...new Set(errors)].slice(0, 50);
  const status: SolveResult['status'] = uniqueErrors.length ? 'error'
    : limitReached ? 'truncated'
      : !finish ? 'unsolved'
        : softlocks.length ? 'softlocks'
          : 'solved';

  for (const n of seen.values()) n.state.inventory.forEach((i) => gained.add(i));
  return {
    status,
    mode,
    finished: !!finish,
    path: pathOf(finish ?? last),
    steps: stepsOf(finish ?? last),
    states: seen.size,
    truncated: limitReached,
    flagsReached: [...flags].sort(),
    unlockedReached: [...unlocked].sort(),
    roomsReached: [...roomsReached].sort(),
    unusedItems: Object.keys(game.items).filter((i) => !gained.has(i)).sort(),
    itemsNeverUsed: [...gained].filter((i) => !itemsInRules.has(i)).sort(),
    deadEnds: deadEnds.slice(0, 20),
    softlocks,
    softlockCount: unsafe.length,
    softlockCauses,
    boundaries,
    assumptions: [...assumptions].sort(),
    errors: uniqueErrors,
    broken,
    profile,
  };
}

/** The profile as text (`npm run solve -- --profile`, the Studio, the `solve` tool). */
export function profileText(p: SolveProfile, game?: GameDef): string {
  const out: string[] = [];
  const pct = (n: number, of: number) => of ? `${Math.round((100 * n) / of)}%` : '0%';
  const name = (key: string) => {
    if (!key.includes(':')) return key;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (!game) return key;
    if (kind === 'item') return `item ${game.items[id]?.name ?? id}`;
    if (kind === 'place') return `place ${game.map?.places[id]?.name ?? id}`;
    return `${kind} ${id}`;
  };
  out.push('SOLVER PROFILE', `  states explored       ${p.states}`, `  engine runs           ${p.tries}  (${p.noops} changed nothing, ${p.hashHits} landed on a known state)`,
    `  actions not run       ${p.skipped}  (no rule could answer them)${p.slept ? `, ${p.slept} asleep (an independent one came first)` : ''}${p.postponed ? `, ${p.postponed} states left to a commuting order` : ''}`, `  max queue             ${p.maxQueue}`, `  time                  ${(p.ms / 1000).toFixed(1)} s`,
    `  actions per state     ${p.branching.avg.toFixed(1)} on average, ${p.branching.max} at most${p.branching.worst ? ` (${p.branching.worst.room}, ${p.branching.worst.inventory.length} items in the bag: ${Object.entries(p.branching.worst.byVerb).map(([v, n]) => `${n} ${v}`).join(', ')} changed something)` : ''}`);
  if (p.dims.length) {
    out.push('', 'What splits the states (states that would merge without it):');
    for (const d of p.dims.filter((x) => x.split > 0).slice(0, 15)) out.push(`  ${String(d.split).padStart(6)}  ${name(d.key)}  (${d.values} values)`);
  }
  const rooms = Object.entries(p.perRoom).sort((a, b) => b[1] - a[1]);
  if (rooms.length) out.push('', 'States by room:', ...rooms.slice(0, 12).map(([r, n]) => `  ${String(n).padStart(6)}  ${r}  (${pct(n, p.states)})`));
  const acts = Object.entries(p.perAction).sort((a, b) => b[1] - a[1]);
  if (acts.length) out.push('', 'What answered most (rules, topics, listeners, script steps):', ...acts.slice(0, 12).map(([a, n]) => `  ${String(n).padStart(6)}  ${a}`));
  const fbs = Object.entries(p.fallbackByRoom).filter(([, f]) => f.candidates).sort((a, b) => b[1].fallback - a[1].fallback);
  if (fbs.length) out.push('', 'Use / give combinations per room (over its expansions):', ...fbs.slice(0, 12).map(([r, f]) => `  ${r}: ${f.candidates} candidates, ${f.rules} answered by a rule, ${f.fallback} could only fall back (${pct(f.fallback, f.candidates)} useless)`));
  if (p.independent.length) {
    out.push('', 'Independent dimensions (their combinations multiply the states; a checkpoint between them would cut it):');
    for (const g of p.independent) out.push(`  ⚠ ${g.dims.map(name).join(', ')}: ${g.combos} of ${g.product} combinations seen`);
  }
  out.push('', `Monotonic (never lost once gained): ${p.monotonic.flags.length} flags, ${p.monotonic.items.length} items${p.monotonic.items.length ? ` (${p.monotonic.items.slice(0, 8).join(', ')}${p.monotonic.items.length > 8 ? '…' : ''})` : ''}`);
  return out.join('\n');
}
