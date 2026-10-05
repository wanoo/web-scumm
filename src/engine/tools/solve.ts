// Solver: explores every possible action from "New game" (best-first: the state that has progressed
// the most — unlocked places, flags, inventory — is explored first) to prove the game can be finished, and to spot dead
// ends and unused items. States only differ by what matters: props and counters that nothing reads
// (a "2nd time" gag, opening/closing a cupboard with no consequence) don't create a new state.
// Uses the real engine with a silent presenter: whatever the solver finds, the player can do.
import { exitOf, solveHeadline, type ExitCode, type SolveStatus } from './status';
import { Engine, type Action, type Source } from '../core/engine';
import type { CustomCommands } from '../core/custom';
import { FakePresenter, MemoryStore } from '../core/ports';
import { check } from '../core/cond';
import { changesState, cmdLists, eachCmd } from '../core/cmds';
import { extraReads, liveness, puzzleGraph } from './puzzle';
import { atomDim, diffDims, independent, readDims, staticTransitions, stubbornKeys, type RW, type Tx } from './por';
import { condAtoms } from '../core/cond';
import type { Cmd, Cond, GameDef, GameState, Id, Layout, SessionEntry, VerbId } from '../core/types';
import { compileGame } from '../core/define';
import { ruleActionId } from '../core/content-ids';
import { Frontier } from './frontier';
import { mobilityModel, viewOf, type Hop, type MobilityModel } from './mobility';
import type { ExpandPool } from './solve-pool';

/**
 * The worker pool, when a Node tool loaded it (`import '@engine/tools/solve-pool'` registers it): this file stays free
 * of worker threads, so the browser (the Studio's demo) bundles the solver without them.
 */
type PoolOpener = (w: number | 'auto', gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions, X: ReturnType<typeof makeExpander>) => Promise<ExpandPool>;
let poolOpener: PoolOpener | null = null;
export function registerPool(open: PoolOpener) { poolOpener = open; }
/** The expansions in this thread, in order (one worker, no pool, or a pool's fallback). */
export function threadPool(X: ReturnType<typeof makeExpander>, reason?: string): ExpandPool {
  return {
    size: 1, ...(reason ? { reason } : {}),
    async expand(inputs, deadline) { const out: (Expansion | null)[] = []; for (const i of inputs) out.push(Date.now() > deadline ? null : await X.expandNode(i)); return out; },
    async stats() { return null; },
    async close() {},
  };
}

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
  /** Mobility regions: whether they applied, macro moves offered, the largest region, why they were turned off. */
  mobility: { applied: boolean; moves: number; largest: number; reason?: string };
  /**
   * The no-op memo (`memo`): runs that wrote nothing, kept with what they read (`stored`); tries skipped because the
   * same action already wrote nothing on the same values (`hits`); hits run anyway and found identical (`verified`);
   * no-op runs not kept because they wrote something back or read something the memo cannot value (`refused`).
   */
  memo: { applied: boolean; stored: number; hits: number; verified: number; refused: number; reason?: string };
  /** Witness dominance: states not explored because one already seen had as much progress. */
  dominance?: { applied: boolean; pruned: number; reason?: string };
  /** The canonical owner: the items pooled, the hand-overs played, why it is off. */
  ownership?: { applied: boolean; items: Id[]; handovers: number; reason?: string };
  /** Proof workers (`workers`): how many expanded, the batch, and why this thread expanded instead when it did. */
  workers?: { workers: number; batch: number; reason?: string };
  /** Why the search stopped early: the state budget (`maxStates`) or the time (`timeLimitMs`). */
  stoppedBy?: 'states' | 'time';
}

export interface SolveResult {
  /** Honest outcome of the requested search. `solved` in witness mode means that at least one path exists. */
  status: SolveStatus;
  /** The status as an exit code and a sentence (`src/engine/tools/status.ts`): what every tool prints. */
  exit: ExitCode;
  headline: string;
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
  start?: 'new' | { checkpoint: Id } | { state: GameState } | { states: GameState[] };
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
   * The no-op memo: a try that wrote nothing at all (`Engine.writes`) is kept with the values it read
   * (`Engine.reads`); the same try on a state with the same values is a no-op too, so it is not run again. Exact as
   * long as the engine's read trace is complete: one hit in `memoVerify` (default 16) is run anyway and compared, and
   * a difference is an error, never a silent skip. Default: on, except with `por`.
   */
  memo?: boolean;
  /** Run one memo hit in this many anyway and compare (1: every hit, the differential tests). */
  memoVerify?: number;
  /**
   * Several playable characters: states that differ only by who is active are one state, and each state offers the
   * actions of every character (`Switch to X › action`). Applies when switching changes nothing the solver reads
   * (checked on every switch: a switch that does change something stays an explicit step) and no invariant or goal
   * (the goal) reads `{ player }`; invariants are checked on every character's view. Default: on in proof mode, off for a witness (whose printed path then stays the same).
   */
  canonicalPlayers?: boolean;
  /**
   * Mobility regions (src/engine/tools/mobility.ts): a character's exact room is replaced by the region of rooms it
   * can walk between silently, and the actions of every room of the region are offered as `Go to <room> › action`.
   * Every hop is checked when played; one that is not silent restarts the search with exact rooms
   * (`profile.mobility.reason`). Default: on in proof mode, off for a witness.
   */
  mobility?: boolean;
  /**
   * The canonical owner (3.5): items no condition reads (`poolableItems`) are one pool, whoever holds them, while every
   * playable character is in one mobility region (they can meet without changing anything); before a character's
   * actions are tried, the hand-overs that give it the pool are played and checked. Default: on in proof mode with the
   * canonical character and mobility regions; a hand-over that changes something restarts the search without it.
   */
  ownership?: boolean;
  /**
   * Witness dominance (3.5, witness searches only: it cannot prune a proof): a new state with no more progress than one
   * already seen (`dominanceThings`: the same everything else, its monotonic items and flags a subset) is not explored.
   * A witness search that finds nothing with it is run again without it, so it never reports `unsolved` by itself.
   */
  dominance?: boolean;
  /**
   * Proof workers (3.5, solve-pool.ts): the frontier expanded a batch at a time by this many worker threads (`auto`:
   * the cores but one, at most 8). The result depends on `batch`, never on the number of workers; without this option
   * the search expands one node at a time, as before. Not with a partial-order reduction.
   */
  workers?: number | 'auto';
  /** Nodes taken from the frontier at once with workers (default 64). */
  batch?: number;
  /** The game's module (its `commands` reach the workers from there; the game itself is sent as data). */
  gameModule?: string;
  /** Stop after this long (milliseconds): the result is `truncated`, `profile.stoppedBy` says why. */
  timeLimitMs?: number;
  /** Tests only: worker `worker` (or every one) stops after `after` expansions, by exiting or by an uncaught error (tests/workers.test.ts). */
  workerCrash?: { worker: number | 'all'; after: number; how: 'exit' | 'throw' };
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
/** Replaces each character's exact room by its mobility region (the dims of `canonicalDims` or of `stateDims`). */
function regionDims(d: Dims, s: GameState, model: MobilityModel, hero: Id, shared: boolean): Dims {
  const key = (who: Id) => model.region(viewOf(s, who, hero, shared)).key;
  return d.map(([k, v]): [string, string] => {
    if (k === 'room') return [k, key(s.active ?? hero)];
    if (k.startsWith('pos:') || k.startsWith('player:')) { const who = k.slice(k.indexOf(':') + 1); const i = v.indexOf(' '); return [k, i < 0 ? key(who) : key(who) + v.slice(i)]; }
    return [k, v];
  });
}

/** A hop the mobility model called silent was not: the search restarts with exact rooms. */
class MobilityError extends Error {}
/** A worker's mobility failure, raised again in the search (solve-pool.ts). */
export const mobilityError = (m: string): Error => new MobilityError(m);
export const isMobilityError = (e: unknown): boolean => e instanceof MobilityError;

function canonicalDims(d: Dims, s: GameState, keys: ReturnType<typeof stateKeys>, hero: Id, shared: boolean, pool?: Set<Id> | null): Dims {
  const live = (xs: Id[] | undefined) => (xs ?? []).filter((i) => keys.live.items.has(i)).sort().join(',');
  // The bags without the pooled items (the `used` marks stay each character's own).
  const bag = (xs: Id[] | undefined) => live((xs ?? []).filter((i) => !pool?.has(i)));
  const out = d.filter(([k]) => k !== 'active' && k !== 'room' && !k.startsWith('player:') && (shared || (!k.startsWith('item:') && !k.startsWith('used:'))));
  out.push([`pos:${s.active ?? hero}`, shared ? s.room : `${s.room} ${bag(s.inventory)} ${live(s.used)}`]);
  for (const [k, p] of Object.entries(s.players ?? {})) out.push([`pos:${k}`, shared ? p.room : `${p.room} ${bag(p.inventory)} ${live(p.used)}`]);
  // The canonical owner (3.5): the pooled items whoever holds them (a multiset: a copy gained twice stays two).
  if (pool) out.push(['pool', [s.inventory, ...Object.values(s.players ?? {}).map((p) => p.inventory)].flat().filter((i) => pool.has(i) && keys.live.items.has(i)).sort().join(',')]);
  return out.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
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
  if ((game.rules.kinds ?? []).some((k) => (Array.isArray(k.verb) ? k.verb : [k.verb]).includes('give') && k.item === undefined)) return none('a reaction by kind answers giving any item');
  const out = new Set(Object.keys(game.items));
  const drop = (i: Id) => out.delete(i);
  // In a condition anywhere (the game, the invariants, the goal).
  const conds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(conds); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.has === 'string') drop(o.has);
    Object.values(o).forEach(conds);
  };
  conds(game); conds(goal ?? []);
  for (const k of game.rules.kinds ?? []) if ((Array.isArray(k.verb) ? k.verb : [k.verb]).includes('give')) (Array.isArray(k.item) ? k.item : [k.item!]).forEach(drop);
  const ids = (x: Id | Id[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const rules = [...game.rooms.flatMap((r) => r.on ?? []), ...(game.rules.on ?? [])];
  for (const r of rules) if ((Array.isArray(r.verb) ? r.verb : [r.verb]).includes('give')) [...ids(r.a), ...ids(r.b)].forEach(drop);
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
class OwnershipError extends Error {}
export const ownershipError = (m: string): Error => new OwnershipError(m);
export const isOwnershipError = (e: unknown): boolean => e instanceof OwnershipError;

/**
 * The value of one thing a run read (`Engine.reads`: condition atoms and the engine's own keys), in the raw state.
 * Null: a read the memo cannot value, so that run is not kept.
 */
export function atomValue(s: GameState, key: string): string | null {
  const i = key.indexOf(':');
  const kind = key.slice(0, i), id = key.slice(i + 1);
  switch (kind) {
    case '@': return id === 'room' ? s.room : id === 'active' ? (s.active ?? '') : null;
    case 'has': return s.inventory.includes(id) ? '1' : '0';
    case 'item': return `${s.inventory.includes(id) ? 1 : 0}${s.used?.includes(id) ? 1 : 0}`;
    case 'flag': return JSON.stringify(s.flags[id] ?? null);
    case 'prop': return s.props[id] ?? '';
    case 'visited': return (s.visited[id] ?? 0) > 0 ? '1' : '0';
    case 'room': return s.room;
    case 'unlocked': return s.unlocked.includes(id) ? '1' : '0';
    case 'seen': return s.seen[id] ? '1' : '0';
    case 'actorIn': return s.where?.[id.slice(0, id.indexOf('@'))] ?? '';
    case 'where': return s.where?.[id] ?? '';
    case 'player': return s.active ?? '';
    case 'players': return JSON.stringify(s.players?.[id] ?? null);
    case 'visible': { const v = s.actors[id]?.visible; return v === undefined ? '' : v ? '1' : '0'; }
    case 'script': return JSON.stringify(s.scripts?.[id] ?? null);
    case 'once': case 'nth': case 'random': return String(s.counters[id] ?? '');
    default: return null;
  }
}

/** What a no-op run read, valued in the state it ran from (always its room and active character). */
function valuation(s: GameState, reads: Set<string>): [string, string][] | null {
  const out: [string, string][] = [];
  for (const k of ['@:room', '@:active', ...reads]) {
    const v = atomValue(s, k);
    if (v === null) return null;
    out.push([k, v]);
  }
  return out;
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

/**
 * What witness dominance compares (3.5): monotonic items and boolean flags (gained or set, never lost or unset) whose
 * absence nothing reads: not under `!` or `not`, not in an `if` with an `else`, not in the condition of a rule that
 * would shadow a later one on the same action (then lacking it is what lets the later one answer).
 */
export function dominanceThings(game: GameDef): { flags: Set<string>; items: Set<string> } {
  const mono = monotonicThings(game);
  const flags = new Set(mono.flags), items = new Set(mono.items);
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
  const drop = (c: unknown) => { const a = atomsOf(c); a.f.forEach((x) => flags.delete(x)); a.i.forEach((x) => items.delete(x)); };
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v.startsWith('!')) flags.delete(v.slice(1)); return; }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const o = v as Record<string, unknown>;
    if ('not' in o) drop(o.not);
    if ('if' in o && 'else' in o) drop(o.if);
    Object.values(o).forEach(walk);
  };
  walk(game);
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  for (const list of [...game.rooms.map((r) => r.on ?? []), game.rules.on ?? []]) list.forEach((r, i) => {
    if (r.if !== undefined && list.slice(i + 1).some((l) => same(l.verb, r.verb) && same(l.a, r.a) && same(l.b, r.b))) drop(r.if);
  });
  return { flags, items };
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
  const r = await solveAbstracted(gameIn, layouts, opts);
  // Dominance prunes on what the content says of absence, a heuristic: a witness search that found nothing after
  // pruning is run again without it, so `unsolved` and `truncated` are never its doing.
  if (r.profile.dominance?.applied && r.profile.dominance.pruned && !r.finished) {
    const again = await solveAbstracted(gameIn, layouts, { ...opts, dominance: false });
    again.profile.dominance = { applied: false, pruned: r.profile.dominance.pruned, reason: `no witness with it (${r.profile.dominance.pruned} pruned): run again without` };
    return again;
  }
  return r;
}

async function solveAbstracted(gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions): Promise<SolveResult> {
  try { return await solveOnce(gameIn, layouts, opts); }
  catch (e) {
    if (e instanceof OwnershipError) {
      // A hand-over the content certified did something else: no pooling for this game.
      const r = await solveAbstracted(gameIn, layouts, { ...opts, ownership: false });
      r.profile.ownership = { applied: false, items: [], handovers: 0, reason: e.message };
      return r;
    }
    if (!(e instanceof MobilityError)) throw e;
    // A hop the model called silent changed something: the regions are not sound for this game, exact rooms then.
    const r = await solveOnce(gameIn, layouts, { ...opts, mobility: false });
    r.profile.mobility = { applied: false, moves: 0, largest: 0, reason: e.message };
    return r;
  }
}

/** The node an expansion starts from: what it needs of it, nothing of the search around it (a worker gets this). */
export interface NodeInput { state: GameState; dims: Dims; sleep: Map<string, RW>; only?: Set<string> }

/**
 * One try that changed the state or reached the goal, in the order the tries ran. The merge (which reads `seen`, the
 * frontier and the goals) decides what becomes of it; the expansion never looks at them.
 */
export interface TryRecord {
  key: string; label: string; h: string; hitGoal: boolean;
  /** The state did not change (a goal state all the same: kept for the goals only). */
  noop: boolean;
  dims?: Dims; state?: GameState; path?: string[]; tailSteps?: SessionEntry[];
  rw?: RW | null; sleep?: Map<string, RW>;
}

/** What expanding one node found. */
export interface Expansion {
  records: TryRecord[];
  /** Stubborn mode's transitions (por.ts). */
  txs: Tx[];
  progressed: boolean;
  tries: number; effective: number; byVerb: Record<string, number>;
  /** Invariants broken on another character's view of the node: the step after the node's path. */
  broken: { invariant: number; suffix: string[] }[];
  errors: string[];
}

/** What expansions add up besides their records (summed over workers: union, sums, maxima). */
export interface ExpandStats {
  itemsInRules: Set<string>; itemsSeen: Set<string>; flags: Set<string>; gained: Set<string>; roomsReached: Set<string>;
  attempted: Map<string, number>; perAction: Map<string, number>;
  fallbackByRoom: Map<string, { candidates: number; rules: number; fallback: number }>;
  n: { memoHits: number; memoStored: number; memoVerified: number; memoRefused: number; tries: number; skipped: number; slept: number; noops: number };
  timing: SolveProfile['timing'];
  canon: { folded: number; explicit: number };
  mob: { moves: number; largest: number };
  own: { handovers: number };
}

/** Adds `b` into `a` (the coordinator's stats and a worker's). */
export function mergeStats(a: ExpandStats, b: ExpandStats) {
  for (const k of ['itemsInRules', 'itemsSeen', 'flags', 'gained', 'roomsReached'] as const) b[k].forEach((x) => a[k].add(x));
  for (const k of ['attempted', 'perAction'] as const) for (const [x, n] of b[k]) a[k].set(x, (a[k].get(x) ?? 0) + n);
  for (const [r, f] of b.fallbackByRoom) { const g = a.fallbackByRoom.get(r) ?? { candidates: 0, rules: 0, fallback: 0 }; g.candidates += f.candidates; g.rules += f.rules; g.fallback += f.fallback; a.fallbackByRoom.set(r, g); }
  for (const k of Object.keys(a.n) as (keyof ExpandStats['n'])[]) a.n[k] += b.n[k];
  for (const k of Object.keys(a.timing) as (keyof SolveProfile['timing'])[]) a.timing[k] += b.timing[k];
  a.canon.folded += b.canon.folded; a.canon.explicit += b.canon.explicit;
  a.mob.moves += b.mob.moves; a.mob.largest = Math.max(a.mob.largest, b.mob.largest);
  a.own.handovers += b.own.handovers;
}

/**
 * Everything one expansion needs, derived from the game and the options alone: the state keys, the abstractions, the
 * memo, a fresh engine per try. Built the same way in the search and in each worker (solve-pool.ts), so an expansion
 * gives the same records wherever it runs; the memo is each one's own (exact: it changes counts, never results).
 */
export function makeExpander(gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions = {}) {
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
  const model0 = (opts.mobility ?? mode === 'prove') ? mobilityModel(game, keys.visitedRead, opts.goal) : null;
  // A game where no move can ever be silent (every room has an onEnter, or is named by a condition): no regions.
  const model = model0 && !model0.trivial ? model0 : null;
  const mobInfo: SolveProfile['mobility'] = { applied: !!model, moves: 0, largest: model ? 0 : 1, ...(model0?.trivial ? { reason: 'no move of this game can be silent' } : {}) };
  // The canonical owner: needs the canonical character (the pool replaces who holds what) and the regions (meeting).
  const poolable = (opts.ownership ?? mode === 'prove') && canonical && model ? poolableItems(game, opts.goal) : null;
  const pool = poolable?.items.size ? poolable.items : null;
  const ownInfo: NonNullable<SolveProfile['ownership']> = { applied: !!pool, items: [...(pool ?? [])].sort(), handovers: 0,
    ...(pool ? {} : { reason: opts.ownership === false ? 'turned off' : !canonical ? 'no canonical character' : !model ? 'no mobility regions' : poolable?.reason ?? 'off for a witness' }) };
  /**
   * Every two playable characters can meet without changing anything (their regions share a room): whoever holds a
   * pooled item can bring it to whoever needs it. Read from the regions only, never the exact rooms, so a silent move
   * inside a region does not change it (mobility checks that). A state where two cannot meet keeps who holds what.
   */
  const meeting = (st: GameState, p: Id, q: Id): Id | undefined => {
    const a = model!.region(viewOf(st, p, game.hero, shared)).rooms, b = new Set(model!.region(viewOf(st, q, game.hero, shared)).rooms);
    return a.find((r) => b.has(r));
  };
  const together = (st: GameState) => !!pool && !!model && playerIds.every((p, i) => playerIds.every((q, j) => j <= i || meeting(st, p, q) !== undefined));
  const baseDims = (st: GameState): Dims => canonical ? canonicalDims(stateDims(st, keys), st, keys, game.hero, shared, together(st) ? pool : null) : stateDims(st, keys);
  const dimsOf = (st: GameState): Dims => model ? regionDims(baseDims(st), st, model, game.hero, shared) : baseDims(st);
  const stats: ExpandStats = {
    itemsInRules: new Set(), itemsSeen: new Set(), flags: new Set(), gained: new Set(), roomsReached: new Set(),
    attempted: new Map(), perAction: new Map(), fallbackByRoom: new Map(),
    n: { memoHits: 0, memoStored: 0, memoVerified: 0, memoRefused: 0, tries: 0, skipped: 0, slept: 0, noops: 0 },
    timing: { tries: 0, engine: 0, clone: 0, run: 0, hash: 0, queue: 0, other: 0, classify: 0 },
    canon: { folded: 0, explicit: 0 }, mob: { moves: 0, largest: model ? 0 : 1 }, own: { handovers: 0 },
  };
  const { timing, n: cnt, attempted, perAction, fallbackByRoom, itemsInRules, flags, gained, roomsReached, itemsSeen } = stats;
  const now = () => performance.now();
  const timed = <T>(k: keyof SolveProfile['timing'], f: () => T): T => { const t = now(); try { return f(); } finally { timing[k] += now() - t; } };
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
  // A goal can read the active character's bag or room (`{ has }`, `{ room }`). With the canonical character, a state
  // reaches the goal when any character, seen as active, meets it: switching to that one is silent.
  const goalHolds = (s: GameState) => !!opts.goal && (opts.goal.every((c) => check(c, s)) || (canonical && playerIds.some((p) => p !== (s.active ?? game.hero) && opts.goal!.every((c) => check(c, viewOf(s, p, game.hero, shared))))));
  const reached = (ui: FakePresenter, s: GameState) => opts.goal ? goalHolds(s) : (s.done || ui.log.includes('ENDING'));
  // A reduction must not remove a losing branch from a proof. Keep proof mode deliberately conservative until the
  // reductions themselves have a model-equivalence proof.
  const por = mode === 'prove' && !opts.unsafeReduction ? false : (opts.por ?? false);
  const memoOn = !por && opts.memo !== false;
  const memoEvery = Math.max(1, opts.memoVerify ?? 16);
  type Memo = { vals: [string, string][]; ran: string[]; src: Source | null | void; asked: FakePresenter['asked']; drawn: number[] };
  const memo = new Map<string, Memo[]>();
  // A write the state's dimensions never show (a flag nobody else reads, a counter of a line list): whatever its
  // value, the hash is the same.
  const hidden = (writes: Set<string>) => {
    for (const w of writes) {
      const i = w.indexOf(':');
      const kind = w.slice(0, i), id = w.slice(i + 1);
      if (kind === 'flag' ? keys.live.flags.has(id) : kind === 'seen' ? keys.seenRead.has(id) || id.startsWith('event.')
        : kind === 'once' ? keys.once.has(id) : kind === 'nth' ? keys.nth.has(id) : kind === 'random' ? keys.random.has(id)
          : kind === 'script' ? keys.live.actions.has(id) : true) return false;
    }
    return true;
  };
  const stx = por === 'stubborn' ? staticTransitions(puzzleGraph(game, { commands: opts.commands })) : null;

  /** Every try from one node, run on the real engine. Reads nothing of the search (no `seen`, no frontier). */
  async function expandNode(input: NodeInput): Promise<Expansion> {
    const s = input.state;
    const tTries = now(), engineBefore = timing.engine, cloneBefore = timing.clone, runBefore = timing.run;
    const exp: Expansion = { records: [], txs: [], progressed: false, tries: 0, effective: 0, byVerb: {}, broken: [], errors: [] };
    // List of actions to try
    // `picks`: the answers given to the choices met on the way (a topic index first, then nested `choice` prompts);
    // whatever is not given defaults to the last option. After a run, every other option of a prompt is a new try.
    type Try = { label: string; run: (e: Engine) => Promise<Source | null | void>; items: string[]; picks: number[]; rnd: number[]; pair?: true; /** The content actions that could answer (puzzle graph ids). */ candidates: string[];
      /** Another character's view or another room of the region: the state the try starts from, and the session entries that led there (played once). */
      base?: GameState; pre?: SessionEntry[]; /** The variant's label prefix (`Switch to X › `): the memo keys the action without it. */ prefix?: string };
    const keyOf = (t: Try) => `${t.label}|p=${t.picks.join(',')}|r=${t.rnd.join(',')}`;
    const tries: Try[] = [];
    const tryKeys = new Set<string>();
    const addTry = (t: Try) => { const k = keyOf(t); if (!tryKeys.has(k)) { tryKeys.add(k); tries.push(t); } };
    const brokenHere = (st: GameState, suffix: string[]) => (game.invariants ?? []).forEach((c, i) => { if (check(c, st)) exp.broken.push({ invariant: i, suffix }); });
    // The canonical character: the same state seen from each other character it can switch to without changing
    // anything the solver reads (`canonicalPlayers`); their actions are tried from here, prefixed by the switch.
    const h0 = JSON.stringify(input.dims);
    const variants: { st: GameState; via?: Id; pre?: SessionEntry[]; prefix?: string }[] = [{ st: s }];
    const explicitSwitch: Id[] = [];
    if (canonical) for (const pid of playerIds) {
      if (pid === (s.active ?? game.hero)) continue;
      const { e } = makeEngine();
      e.state = timed('clone', () => structuredClone(s));
      try { await drive(e, e.switchTo(pid), () => {}); } catch { explicitSwitch.push(pid); continue; }
      if (JSON.stringify(dimsOf(e.state)) === h0) { variants.push({ st: e.state, via: pid, pre: e.session?.log ?? [], prefix: `Switch to ${pid} › ` }); stats.canon.folded++; brokenHere(e.state, [`Switch to ${pid}`]); }
      else { explicitSwitch.push(pid); stats.canon.explicit++; }
    }
    // Mobility regions: each character's view, in every room of its region. The route there is played once, each
    // hop checked (arrives, changes nothing the solver reads); the tries of that room start from where it ends.
    const placed: { st: GameState; via?: Id; pre?: SessionEntry[]; prefix?: string; region?: Id[] }[] = [];
    for (const v of variants) {
      // What a character's view reaches is reached (the explicit search would switch to it, or walk there): the room
      // reports and the lint's `room-never-reached` must not depend on the abstractions (tests/audit.test.ts).
      v.st.inventory.forEach((i) => itemsSeen.add(i));
      if (!model) { placed.push(v); roomsReached.add(v.st.room); continue; }
      const R = model.region(v.st);
      stats.mob.largest = Math.max(stats.mob.largest, R.rooms.length);
      for (const r of R.rooms) {
        roomsReached.add(r);
        if (r === v.st.room) { placed.push({ ...v, region: R.rooms }); continue; }
        const { e } = makeEngine();
        e.state = timed('clone', () => structuredClone(v.st));
        const tRun = now();
        try {
          for (const h of R.route(r)) {
            await drive(e, h.kind === 'exit' ? e.act({ verb: h.verb, a: h.a }) : e.travel(h.place), () => {});
            if (e.state.room !== h.to) throw new MobilityError(`a silent move from ${h.from} to ${h.to} did not arrive (in ${e.state.room})`);
            if (JSON.stringify(dimsOf(e.state)) !== h0) throw new MobilityError(`moving from ${h.from} to ${h.to} changed something the solver reads`);
          }
        } finally { timing.run += now() - tRun; }
        placed.push({ st: e.state, via: v.via, pre: [...(v.pre ?? []), ...(e.session?.log ?? [])], prefix: `${v.prefix ?? ''}Go to ${r} › `, region: R.rooms });
        stats.mob.moves++;
      }
    }
    // The canonical owner: the character whose actions are tried gets the pool first. For each other holder: where they
    // meet (here when the holder can walk here, else a room both regions share, the character going there and coming
    // back), the holder switches in, walks there, hands its pooled items over, and the controls come back. Every step is
    // played on the engine and must leave the state as the search sees it.
    if (pool && together(s)) for (let vi = 0; vi < placed.length; vi++) {
      const v = placed[vi];
      const me = v.st.active ?? game.hero;
      const holders = playerIds.filter((q) => q !== me && viewOf(v.st, q, game.hero, shared).inventory.some((i) => pool.has(i)));
      if (!holders.length) continue;
      const { e } = makeEngine();
      e.state = timed('clone', () => structuredClone(v.st));
      const same = (what: string) => { if (JSON.stringify(dimsOf(e.state)) !== h0) throw new OwnershipError(`${what} changed something the solver reads`); };
      const walk = async (who: Id, to: Id) => {
        for (const h of model!.region(e.state).route(to)) {
          await drive(e, h.kind === 'exit' ? e.act({ verb: h.verb, a: h.a }) : e.travel(h.place), () => {});
          if (e.state.room !== h.to) throw new OwnershipError(`${who} walking to ${to} did not arrive (in ${e.state.room})`);
          same(`${who} walking from ${h.from} to ${h.to}`);
        }
      };
      const tRun = now();
      try {
        for (const q of holders) {
          const here = model!.region(viewOf(e.state, q, game.hero, shared)).rooms.includes(v.st.room);
          const at = here ? v.st.room : meeting(e.state, me, q)!;
          if (at !== e.state.room) await walk(me, at);
          await drive(e, e.switchTo(q), () => {});
          if ((e.state.active ?? game.hero) !== q) throw new OwnershipError(`switching to ${q} did not happen`);
          same(`switching to ${q}`);
          await walk(q, at);
          for (const it of e.state.inventory.filter((i) => pool.has(i))) {
            const before = viewOf(e.state, me, game.hero, shared).inventory.filter((i) => i === it).length;
            await drive(e, e.act({ verb: 'give', a: it, b: me }), () => {});
            if (viewOf(e.state, me, game.hero, shared).inventory.filter((i) => i === it).length !== before + 1) throw new OwnershipError(`${q} giving ${it} to ${me} did not hand it over`);
            same(`${q} giving ${it} to ${me}`);
          }
          await drive(e, e.switchTo(me), () => {});
          same(`switching back to ${me}`);
          if (e.state.room !== v.st.room) await walk(me, v.st.room);
        }
      } finally { timing.run += now() - tRun; }
      if (e.state.room !== v.st.room || (e.state.active ?? game.hero) !== me) throw new OwnershipError(`the hand-overs did not leave ${me} where it was`);
      placed[vi] = { ...v, st: e.state, pre: [...(v.pre ?? []), ...(e.session?.log ?? [])], prefix: `${v.prefix ?? ''}Pool to ${me} › ` };
      stats.own.handovers++;
    }
    for (const variant of placed) {
      const s = variant.st;
      const add = (t: Try) => addTry(variant.prefix ? { ...t, label: `${variant.prefix}${t.label}`, base: variant.st, pre: variant.pre, prefix: variant.prefix } : t);
      // Inside a region, its silent exits and map trips are the macro moves above, not tries of their own.
      const silentExits = new Set(model && variant.region ? model.hops(s, s.room).filter((h) => h.kind === 'exit' && variant.region!.includes(h.to)).map((h) => (h as { a: Id }).a) : []);
      const regionRooms = new Set(variant.region ?? []);
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
        if (silentExits.has(t)) continue;
        if (!answered(v, t) && !(v === 'talk' && t === game.hintItem && inv.includes(t))) { cnt.skipped++; continue; }
        add({ label: label(game, { verb: v, a: t }), run: (e) => e.act({ verb: v, a: t }), items: inv.includes(t) ? [t] : [], picks: [], rnd: [], candidates: answers(v, t) });
      }
      for (const it of inv) for (const t of [...targets, ...inv.filter((x) => x !== it)]) for (const v of ['use', 'give'] as VerbId[]) {
        if (v === 'give' && inv.includes(t)) continue;
        fb.candidates++;
        if (!answered(v, it, t) && !(v === 'give' && probe.isPlayer(t) && t !== probe.heroId())) { fb.fallback++; cnt.skipped++; continue; }
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
        if (!s.unlocked.includes(pid) || p.room === s.room || !game.rooms.some((r) => r.id === p.room) || regionRooms.has(p.room)) continue;
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

    timing.tries += now() - tTries - (timing.engine - engineBefore) - (timing.clone - cloneBefore) - (timing.run - runBefore);
    const only = input.only;
    // The effective actions tried here so far, with what they read and wrote: the later ones sleep them in their children.
    const done: { key: string; rw: RW }[] = [];
    // What a run leaves besides its state: other answers to its prompts and draws (new tries), what answered it.
    const expand = (t: Try, asked: FakePresenter['asked'], drawn: number[]) => {
      // Other answers to every nested `choice` prompt. There is deliberately no hidden variant ceiling: maxStates is
      // the one explicit search budget, and reaching it returns `truncated`.
      for (let j = t.picks.length; j < asked.length; j++) {
        const q = asked[j];
        if (q.topic || q.n < 2) continue;
        const prefix = [...t.picks, ...asked.slice(t.picks.length, j).map((a) => a.n - 1)];
        for (let o = 0; o < q.n - 1; o++) {
          const base = t.label.replace(/ › ".*$/, '');
          const chosen = [...prefix.slice(t.picks.length), o].map((pick, k) => asked[t.picks.length + k].texts[pick]);
          addTry({ ...t, label: `${base} › ${chosen.map((x) => `"${x}"`).join(' › ')}`, picks: [...prefix, o] });
        }
      }
      // The engine records every random draw in the session. Expand every newly observed draw with representative
      // values for every random block arity in the game; state hashing removes duplicates. This explores nested
      // random blocks just like nested dialogue choices, instead of forcing branch zero.
      for (let j = t.rnd.length; j < drawn.length; j++) {
        const prefix = [...t.rnd, ...drawn.slice(t.rnd.length, j)];
        for (const value of randomBranchValues) if (value !== drawn[j]) addTry({ ...t, rnd: [...prefix, value] });
      }
    };
    const countAnswer = (t: Try, src: Source | null | void, room: Id) => {
      if (src === 'rule' || src === 'hint') t.items.forEach((i) => itemsInRules.add(i));
      if (t.pair) { const fb = fallbackByRoom.get(room); if (fb) { if (src === 'rule') fb.rules++; else if (src === 'fallback') fb.fallback++; } }
    };
    // A memo hit: the try is a no-op here, as it was where it was kept. Its prompts, draws and answers count the same.
    const replayNoop = (t: Try, m: Memo, room: Id) => {
      expand(t, m.asked, m.drawn);
      countAnswer(t, m.src, room);
      for (const id of m.ran) attempted.set(id, (attempted.get(id) ?? 0) + 1);
    };
    for (let ti = 0; ti < tries.length; ti++) {
      const t = tries[ti];
      const key = keyOf(t);
      if (por === 'sleep' && input.sleep.has(key)) { cnt.slept++; exp.progressed = true; continue; }
      if (only && !only.has(key)) continue;
      const mk = t.prefix && t.label.startsWith(t.prefix) ? keyOf({ ...t, label: t.label.slice(t.prefix.length) }) : key;
      const from = t.base ?? s;
      const hit = memoOn ? memo.get(mk)?.find((m) => m.vals.every(([k, v]) => atomValue(from, k) === v)) : undefined;
      let verify: Memo | undefined;
      if (hit) {
        cnt.memoHits++;
        if (cnt.memoHits % memoEvery) { replayNoop(t, hit, s.room); cnt.noops++; continue; }
        verify = hit;
      }
      cnt.tries++;
      const { e, ui } = makeEngine(t.rnd);
      e.state = timed('clone', () => structuredClone(from));
      if (por || memoOn) e.reads = new Set();
      if (memoOn) e.writes = new Set();
      ui.picks = [...t.picks];
      const path: string[] = []; // this step's tutorial moves, then its label
      let src: Source | null | void = null;
      const tRun = now();
      try {
        await drive(e, t.run(e).then((r) => { src = r; }), (a) => path.push(`(tutorial) ${label(game, a)}`));
      } catch (err) {
        if (err instanceof MobilityError) throw err;
        exp.errors.push(`${t.label} (${s.room}): ${(err as Error).message}`);
        continue;
      } finally { timing.run += now() - tRun; }
      const drawn = (e.session?.log ?? []).flatMap((entry) => entry.rnd ?? []);
      expand(t, ui.asked, drawn);
      countAnswer(t, src, s.room);
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
      const rw: RW | null = por ? { reads: readDims(e.reads!), writes: diffDims(input.dims, dims) } : null;
      if (verify) {
        cnt.memoVerified++;
        if (h !== h0 || !hidden(e.writes!)) exp.errors.push(`${t.label} (${s.room}): the no-op memo skipped a try that ${h !== h0 ? 'changes the state' : 'writes what the solver hashes'} here (the engine's read trace is incomplete)`);
      }
      if (h === h0 && memoOn && !verify) {
        const vals = hidden(e.writes!) ? valuation(from, e.reads!) : null;
        if (vals) {
          const list = memo.get(mk) ?? (memo.set(mk, []), memo.get(mk)!);
          if (list.length < 64) { list.push({ vals, ran: (e.session?.log ?? []).flatMap((en) => en.ran ?? []), src, asked: ui.asked, drawn }); cnt.memoStored++; }
        } else cnt.memoRefused++;
      }
      if (h === h0) {
        cnt.noops++;
        if (hitGoal) exp.records.push({ key, label: t.label, h, hitGoal, noop: true });
        if (stx && rw) {
          // A transition a condition holds back: what it would change, and the gates that hold it, from the content.
          const cands = t.candidates.map((c) => stx.byId.get(c)).filter((x) => !!x);
          cands.forEach((c) => c.writes.forEach((w) => rw.writes.add(w)));
          if (rw.writes.size) exp.txs.push({ key, enabled: false, rw, candidates: t.candidates, gates: cands.map((c) => c.gates), visible: false });
        }
        continue;
      }
      exp.progressed = true;
      exp.effective++;
      exp.byVerb[t.label.split(' ')[0]] = (exp.byVerb[t.label.split(' ')[0]] ?? 0) + 1;
      for (const en of e.session?.log ?? []) for (const id of en.ran ?? []) perAction.set(id, (perAction.get(id) ?? 0) + 1);
      const sleep = new Map<string, RW>();
      if (por === 'sleep' && rw) {
        for (const [k, r] of input.sleep) if (independent(r, rw)) sleep.set(k, r);
        for (const d of done) if (independent(d.rw, rw)) sleep.set(d.key, d.rw);
        done.push({ key, rw });
      }
      if (stx && rw) exp.txs.push({ key, enabled: true, rw, candidates: t.candidates, gates: [], visible: [...rw.writes].some((w) => goalDims.has(w)) });
      const state = timed('clone', () => structuredClone(e.state));
      exp.records.push({ key, label: t.label, h, hitGoal, noop: false, dims, state, path: [...path, t.label], tailSteps: [...(t.pre ?? []), ...(e.session?.log ?? [])], rw, sleep });
      // A witness ends at its first goal (one never seen before: a seen goal would have ended the search already).
      if (hitGoal && mode === 'witness') break;
    }
    exp.tries = tries.length;
    return exp;
  }

  // What the search looks for: an action that changes it is never postponed by the reduction.
  const goalDims = new Set<string>(['done', ...(opts.goal ?? []).flatMap((c) => condAtoms(c).map(atomDim))]);
  return { game, mode, keys, playerIds, canonical, canonInfo, model, mobInfo, ownInfo, dimsOf, makeEngine, reached, goalHolds, por, memoOn, stx, stats, timed, now, expandNode };
}

async function solveOnce(gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions = {}): Promise<SolveResult> {
  const maxStates = opts.maxStates ?? 20000;
  const X = makeExpander(gameIn, layouts, opts);
  const { game, mode, canonInfo, mobInfo, ownInfo, dimsOf, makeEngine, reached, goalHolds, por, memoOn, stx, stats, timed, now } = X;
  const { timing } = stats;
  const errors: string[] = [];
  const unlocked = new Set<string>();
  const deadEnds: SolveResult['deadEnds'] = [];
  // The profile
  const t0 = Date.now();
  let postponed = 0, hashHits = 0, maxQueue = 0, expansions = 0, triesSum = 0, triesMax = 0;
  let worst: SolveProfile['branching']['worst'];
  const perRoom = new Map<string, number>();
  const loopStart = { t: 0 };
  // Workers (solve-pool.ts): the frontier is expanded a batch at a time, each node by whichever worker is free, and
  // merged in the batch's order. The result depends on the batch, never on the number of workers.
  const pool = opts.workers === undefined ? null : poolOpener ? await poolOpener(opts.workers, gameIn, layouts, opts, X) : threadPool(X, 'no worker pool here (a Node tool loads solve-pool.ts): this thread expands');
  const batch = pool ? Math.max(1, opts.batch ?? 64) : 1;
  const deadline = opts.timeLimitMs ? t0 + opts.timeLimitMs : Infinity;
  let stoppedBy: 'states' | 'time' | undefined;

  // Starting state
  const { e: e0, ui: ui0 } = makeEngine();
  const startPath: string[] = [];
  // Several starts (a chapter's boundary states): one search from all of them, sharing what it has seen.
  const extraStarts = opts.start && typeof opts.start === 'object' && 'states' in opts.start ? opts.start.states.slice(1) : [];
  if (opts.start && typeof opts.start === 'object') { if ('checkpoint' in opts.start) await e0.checkpoint(opts.start.checkpoint); else await e0.load(structuredClone('states' in opts.start ? opts.start.states[0] : opts.start.state)); }
  else await drive(e0, e0.newGame(), (a) => startPath.push(`(tutorial) ${label(game, a)}`));
  const broken: SolveResult['broken'] = [];
  const brokenSeen = new Set<number>();
  const checkInvariants = (s: GameState, path: () => string[]) => {
    (game.invariants ?? []).forEach((c, i) => { if (!brokenSeen.has(i) && check(c, s)) { brokenSeen.add(i); broken.push({ invariant: i, path: path() }); } });
  };

  const seen = new Map<string, Node>();
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
  for (const [k, st0] of extraStarts.entries()) {
    const { e } = makeEngine();
    await e.load(structuredClone(st0));
    const dims = dimsOf(e.state);
    const h = JSON.stringify(dims);
    if (seen.has(h)) continue;
    const n: Node = { state: structuredClone(e.state), tail: [`(start ${k + 2} of ${extraStarts.length + 1})`], tailSteps: [], len: 1, dims, sleep: new Map(), expanded: false };
    seen.set(h, n);
    enqueue(n);
    if (opts.goal ? goalHolds(e.state) : e.state.done) { goals.add(h); finish ??= n; }
  }
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
  // Witness dominance: states indexed by everything but their dominance things; a new one whose things are a subset of
  // a seen one's, with the rest equal, has nothing more to offer a witness.
  const dom = opts.dominance && mode === 'witness' ? dominanceThings(game) : null;
  const domIndex = new Map<string, Set<string>[]>();
  let pruned = 0;
  const domSplit = (d: Dims) => {
    const mono = new Set<string>(); const rest: Dims = [];
    for (const [k, v] of d) (k.startsWith('flag:') && v === 'true' && dom!.flags.has(k.slice(5))) || (k.startsWith('item:') && dom!.items.has(k.slice(5))) ? mono.add(k) : rest.push([k, v]);
    return { key: JSON.stringify(rest), mono };
  };
  /** Some state seen has all of this one's progress (`strict`: and more), everything else equal. */
  const dominated = (d: Dims, strict = false) => { const { key, mono } = domSplit(d); return !!domIndex.get(key)?.some((m) => m.size >= mono.size + (strict ? 1 : 0) && [...mono].every((x) => m.has(x))); };
  const remember = (d: Dims) => { const { key, mono } = domSplit(d); (domIndex.get(key) ?? (domIndex.set(key, []), domIndex.get(key)!)).push(mono); };
  if (dom) for (const n of seen.values()) remember(n.dims);
  let limitReached = false;
  let last: Node = start;
  checkInvariants(start.state, () => pathOf(start));

  /** What popping a node counts (the rooms, flags, places and items the search has been through). */
  const visit = (node: Node) => {
    const s = node.state;
    last = node;
    stats.roomsReached.add(s.room);
    perRoom.set(s.room, (perRoom.get(s.room) ?? 0) + 1);
    Object.entries(s.flags).forEach(([k, v]) => v && stats.flags.add(k));
    s.unlocked.forEach((u) => unlocked.add(u));
    s.inventory.forEach((i) => stats.itemsSeen.add(i));
  };
  /** An expansion's records into the search: goals, edges, new states, the frontier. Reads `seen`; the expansion never did. */
  const merge = (node: Node, exp: Expansion) => {
    const s = node.state;
    const h0 = JSON.stringify(node.dims);
    for (const b of exp.broken) if (!brokenSeen.has(b.invariant)) { brokenSeen.add(b.invariant); broken.push({ invariant: b.invariant, path: [...pathOf(node), ...b.suffix] }); }
    errors.push(...exp.errors);
    const children: { key: string; next: Node; h: string }[] = [];
    let anyHit = false;
    for (const r of exp.records) {
      const h = r.h;
      if (r.hitGoal) goals.add(h);
      if (r.noop) continue;
      (edges.get(h0) ?? (edges.set(h0, new Set()), edges.get(h0)!)).add(h);
      const sleep = r.sleep ?? new Map<string, RW>();
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
      const next: Node = { state: r.state!, prev: node, tail: r.path!, tailSteps: r.tailSteps!, len: node.len + r.path!.length, dims: r.dims!, sleep, expanded: false, parent: h0, via: r.label };
      checkInvariants(next.state, () => pathOf(next));
      if (r.hitGoal) {
        seen.set(h, next);
        finish ??= next;
        if (mode === 'witness') break;
        // The ending is terminal. Keep trying the other actions from the source state, but do not expand past it.
        continue;
      }
      if (dom) { if (dominated(next.dims)) { pruned++; continue; } remember(next.dims); }
      children.push({ key: r.key, next, h });
    }
    if (mode === 'prove' || !finish) {
      // Stubborn mode: of the commuting actions, one at a time. The content's actions no try stands for (a hidden
      // topic, a rule on something not shown yet) count as held-back transitions too.
      let keep: Set<string> | null = null;
      if (stx) {
        const txs = [...exp.txs];
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
    triesSum += exp.tries;
    if (exp.tries > triesMax) { triesMax = exp.tries; worst = { room: s.room, inventory: [...s.inventory], tries: exp.tries, effective: exp.effective, byVerb: exp.byVerb }; }
    if (!exp.progressed && deadEnds.length < 20) deadEnds.push({ path: pathOf(node), room: s.room, inventory: [...s.inventory] });
  };
  const input = (node: Node): NodeInput => {
    const only = node.only;
    node.only = undefined;
    return { state: node.state, dims: node.dims, sleep: node.sleep, ...(only ? { only } : {}) };
  };

  loopStart.t = now();
  try {
    while (queue.size && (mode === 'prove' || !finish)) {
      if (seen.size >= maxStates) { limitReached = true; stoppedBy = 'states'; break; }
      if (Date.now() > deadline) { limitReached = true; stoppedBy = 'time'; break; }
      const nodes: Node[] = [];
      while (nodes.length < batch && queue.size) {
        const n = timed('queue', () => queue.pop()!);
        // Witness dominance: a state that a better one (more progress, the rest equal) has overtaken since it was queued.
        if (dom && dominated(n.dims, true)) { pruned++; continue; }
        nodes.push(n);
      }
      if (!nodes.length) continue;
      const exps = pool ? await pool.expand(nodes.map(input), deadline) : [await X.expandNode(input(nodes[0]))];
      for (let k = 0; k < nodes.length; k++) {
        // The batch is taken from the frontier at once; the rest of it is dropped as the one-at-a-time search would
        // have stopped before it (the budget, a witness found).
        if (k > 0 && (seen.size >= maxStates || (mode === 'witness' && finish))) { if (seen.size >= maxStates) { limitReached = true; stoppedBy = 'states'; } break; }
        if (!exps[k]) { limitReached = true; stoppedBy = 'time'; break; }
        visit(nodes[k]);
        merge(nodes[k], exps[k]!);
      }
      if (limitReached) break;
    }
  } finally {
    if (pool) { const w = await pool.stats(); if (w) mergeStats(stats, w); await pool.close(); }
  }
  if (limitReached && !stoppedBy) stoppedBy = 'states';
  const { itemsInRules, itemsSeen, flags, gained, roomsReached, attempted, perAction, fallbackByRoom, n: cnt } = stats;
  void itemsSeen;
  canonInfo.folded = stats.canon.folded; canonInfo.explicit = stats.canon.explicit;
  if (mobInfo.applied) { mobInfo.moves = stats.mob.moves; mobInfo.largest = stats.mob.largest; }
  ownInfo.handovers = stats.own.handovers;
  const loopMs = now() - loopStart.t;
  timing.other = Math.max(0, loopMs - timing.tries - timing.engine - timing.clone - timing.run - timing.hash - timing.queue);
  const all = seen.size <= 50000 ? [...seen.values()].map((n) => n.dims) : [];
  const dims = splits(all).slice(0, 30);
  const positions = new Set([...seen.values()].map((n) => `${n.state.active ?? ''}|${n.state.room}|${Object.entries(n.state.players ?? {}).map(([k, p]) => `${k}:${p.room}`).sort().join(',')}`)).size;
  const profile: SolveProfile = {
    ms: Date.now() - t0, states: seen.size, tries: cnt.tries, skipped: cnt.skipped, slept: cnt.slept, postponed, noops: cnt.noops, hashHits, maxQueue,
    branching: { avg: expansions ? triesSum / expansions : 0, max: triesMax, ...(worst ? { worst } : {}) },
    fallbackByRoom: Object.fromEntries(fallbackByRoom), dims, perRoom: Object.fromEntries(perRoom), perAction: Object.fromEntries(perAction), attempted: Object.fromEntries(attempted),
    monotonic: monotonicThings(game), independent: independentGroups(all, dims), timing, positions, canonical: canonInfo, mobility: mobInfo, ownership: ownInfo, dominance: { applied: !!dom, pruned, ...(dom ? {} : { reason: mode === 'prove' ? 'a proof cannot prune by dominance' : 'not asked for (--dominance)' }) }, memo: { applied: memoOn, stored: cnt.memoStored, hits: cnt.memoHits, verified: cnt.memoVerified, refused: cnt.memoRefused, ...(memoOn ? {} : { reason: opts.memo === false ? 'turned off' : 'off with a partial-order reduction' }) },
    workers: pool ? { workers: pool.size, batch, ...(pool.reason ? { reason: pool.reason } : {}) } : { workers: 1, batch: 1 },
    ...(stoppedBy ? { stoppedBy } : {}),
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
    : broken.length ? 'broken'
      : limitReached ? 'truncated'
      : !finish ? 'unsolved'
        : softlocks.length ? 'softlocks'
          : 'solved';

  for (const n of seen.values()) n.state.inventory.forEach((i) => gained.add(i));
  return {
    status,
    exit: exitOf(status),
    headline: solveHeadline({ status, mode, states: seen.size, softlockCount: unsafe.length, broken, errors: uniqueErrors, goal: !!opts.goal, stoppedBy }),
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

/** What each abstraction of the search did: one line each, the same in the text profile, the Studio and the tools. */
export function abstractionLines(p: SolveProfile): string[] {
  const off = (r?: string) => `off${r ? ` (${r})` : ''}`;
  return [
    `  canonical character   ${p.canonical.applied ? `${p.canonical.folded} switches folded, ${p.canonical.explicit} kept explicit` : off(p.canonical.reason)}`,
    `  mobility regions      ${p.mobility.applied ? `${p.mobility.moves} macro moves, largest region ${p.mobility.largest} rooms` : off(p.mobility.reason)}`,
    `  no-op memo            ${p.memo.applied ? `${p.memo.hits} runs skipped (${p.memo.verified} of them run anyway and identical), ${p.memo.stored} kept, ${p.memo.refused} refused` : off(p.memo.reason)}`,
    ...(p.dominance?.applied || p.dominance?.pruned ? [`  witness dominance     ${p.dominance.applied ? `${p.dominance.pruned} states not explored` : off(p.dominance.reason)}`] : []),
    ...(p.ownership ? [`  canonical owner       ${p.ownership.applied ? `${p.ownership.items.length} item(s) pooled, ${p.ownership.handovers} hand-overs played` : off(p.ownership.reason)}`] : []),
    ...(p.workers && p.workers.batch > 1 ? [`  workers               ${p.workers.workers} expanding batches of ${p.workers.batch}${p.workers.reason ? ` (${p.workers.reason})` : ''}; times below are summed over them`] : []),
    ...(p.stoppedBy ? [`  stopped by            ${p.stoppedBy === 'time' ? 'the time limit (--time)' : 'the state budget (--max)'}`] : []),
  ];
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
  out.push('SOLVER PROFILE', `  states explored       ${p.states}`, `  engine runs           ${p.tries}  (${p.noops} tries changed nothing${p.memo.hits > p.memo.verified ? `, ${p.memo.hits - p.memo.verified} of them not run: the no-op memo knew` : ''}; ${p.hashHits} landed on a known state)`,
    `  actions not run       ${p.skipped}  (no rule could answer them)${p.slept ? `, ${p.slept} asleep (an independent one came first)` : ''}${p.postponed ? `, ${p.postponed} states left to a commuting order` : ''}`, `  max queue             ${p.maxQueue}`, `  time                  ${(p.ms / 1000).toFixed(1)} s`,
    `  actions per state     ${p.branching.avg.toFixed(1)} on average, ${p.branching.max} at most${p.branching.worst ? ` (${p.branching.worst.room}, ${p.branching.worst.inventory.length} items in the bag: ${Object.entries(p.branching.worst.byVerb).map(([v, n]) => `${n} ${v}`).join(', ')} changed something)` : ''}`);
  out.push('', 'Abstractions (what each one did, or why it is off):', ...abstractionLines(p));
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
