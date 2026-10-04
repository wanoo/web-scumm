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
  /** Flags never unset or lowered, items never lost: once gained, kept (what dominance pruning could use). */
  monotonic: { flags: string[]; items: string[] };
  /** Boolean dimensions that evolve independently: their combinations multiply the states (a checkpoint between them helps). */
  independent: { dims: string[]; combos: number; product: number }[];
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
  profile: SolveProfile;
}

export interface SolveOptions {
  maxStates?: number;
  /** `witness` stops at the first solution; `prove` explores the whole reachable graph and finds softlocks. */
  mode?: 'witness' | 'prove';
  start?: 'new' | { checkpoint: Id };
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
}

interface Node {
  state: GameState; path: string[]; steps: SessionEntry[]; dims: Dims;
  /** Sleep set: actions not to try here (an independent one was tried before them on the way), with what they read and wrote. */
  sleep: Map<string, RW>;
  expanded: boolean;
  /** A node seen again with a smaller sleep set: only these actions are still to try. */
  only?: Set<string>;
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

export async function solve(gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions = {}): Promise<SolveResult> {
  const maxStates = opts.maxStates ?? 20000;
  const mode = opts.mode ?? 'witness';
  const game = compileGame(gameIn) as GameDef;
  const keys0 = new Engine(game, layouts, new FakePresenter(), new MemoryStore(), { commands: opts.commands }); // assigns the keys
  const keys = stateKeys(keys0.game, opts.commands, opts.goal);
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
  const perRoom = new Map<string, number>(), perAction = new Map<string, number>();
  const fallbackByRoom = new Map<string, { candidates: number; rules: number; fallback: number }>();

  const randomBranchValues = [...new Set(cmdLists(game).flatMap(({ list }) => {
    const sizes: number[] = [];
    eachCmd(list, (c) => { if (typeof c !== 'string' && 'random' in c && c.random.length) sizes.push(c.random.length); });
    return sizes.flatMap((n) => Array.from({ length: n }, (_, i) => (i + 0.5) / n));
  }))].sort((a, b) => a - b);
  const makeEngine = (rnd: number[] = []) => {
    const ui = new FakePresenter();
    const e = new Engine(game, layouts, ui, new MemoryStore(), { commands: opts.commands });
    const draws = [...rnd];
    e.random = () => draws.shift() ?? 0;
    return { e, ui };
  };

  // Starting state
  const { e: e0, ui: ui0 } = makeEngine();
  const startPath: string[] = [];
  if (opts.start && typeof opts.start === 'object') await e0.checkpoint(opts.start.checkpoint);
  else await drive(e0, e0.newGame(), (a) => startPath.push(`(tutorial) ${label(game, a)}`));
  const reached = (ui: FakePresenter, s: GameState) => opts.goal ? opts.goal.every((c) => check(c, s)) : (s.done || ui.log.includes('ENDING'));
  const broken: SolveResult['broken'] = [];
  const brokenSeen = new Set<number>();
  const checkInvariants = (s: GameState, path: string[]) => {
    (game.invariants ?? []).forEach((c, i) => { if (!brokenSeen.has(i) && check(c, s)) { brokenSeen.add(i); broken.push({ invariant: i, path }); } });
  };

  const seen = new Map<string, Node>();
  // A reduction must not remove a losing branch from a proof. Keep proof mode deliberately conservative until the
  // reductions themselves have a model-equivalence proof.
  const por = mode === 'prove' ? false : (opts.por ?? false);
  const stx = por === 'stubborn' ? staticTransitions(puzzleGraph(game, { commands: opts.commands })) : null;
  // What the search looks for: an action that changes it is never postponed by the reduction.
  const goalDims = new Set<string>(['done', ...(opts.goal ?? []).flatMap((c) => condAtoms(c).map(atomDim))]);
  const start: Node = { state: structuredClone(e0.state), path: startPath, steps: e0.session?.log ?? [], dims: stateDims(e0.state, keys), sleep: new Map(), expanded: false };
  // Best-first: the more a state has progressed, the earlier it's explored. At equal progress, the shortest path first.
  const score = (n: Node) => n.state.unlocked.length * 20 + Object.values(n.state.flags).filter(Boolean).length * 3 + n.state.inventory.length * 2 - n.path.length * 0.01;
  const queue: Node[] = [start];
  const enqueue = (n: Node) => { const sc = score(n); let i = queue.length; while (i > 0 && score(queue[i - 1]) < sc) i--; queue.splice(i, 0, n); };
  seen.set(JSON.stringify(start.dims), start);
  let finish: Node | null = reached(ui0, e0.state) ? start : null;
  const startHash = JSON.stringify(start.dims);
  const goals = new Set<string>(finish ? [startHash] : []);
  const edges = new Map<string, Set<string>>();
  let limitReached = false;
  let last: Node = start;
  checkInvariants(start.state, start.path);

  while (queue.length && (mode === 'prove' || !finish)) {
    if (seen.size >= maxStates) { limitReached = true; break; }
    const node = queue.shift()!;
    last = node;
    const s = node.state;
    roomsReached.add(s.room);
    perRoom.set(s.room, (perRoom.get(s.room) ?? 0) + 1);
    Object.entries(s.flags).forEach(([k, v]) => v && flags.add(k));
    s.unlocked.forEach((u) => unlocked.add(u));
    s.inventory.forEach((i) => itemsSeen.add(i));

    // List of actions to try
    const probe = makeEngine().e;
    probe.state = structuredClone(s);
    const room = probe.room();
    const targets = probe.targets(room);
    const inv = s.inventory;
    const verbs = game.verbs.map((v) => v.id) as VerbId[];
    // `picks`: the answers given to the choices met on the way (a topic index first, then nested `choice` prompts);
    // whatever is not given defaults to the last option. After a run, every other option of a prompt is a new try.
    type Try = { label: string; run: (e: Engine) => Promise<Source | null | void>; items: string[]; picks: number[]; rnd: number[]; pair?: true; /** The content actions that could answer (puzzle graph ids). */ candidates: string[] };
    const keyOf = (t: Try) => `${t.label}|p=${t.picks.join(',')}|r=${t.rnd.join(',')}`;
    const tries: Try[] = [];
    const tryKeys = new Set<string>();
    const addTry = (t: Try) => { const k = keyOf(t); if (!tryKeys.has(k)) { tryKeys.add(k); tries.push(t); } };
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
      addTry({ label: label(game, { verb: v, a: t }), run: (e) => e.act({ verb: v, a: t }), items: inv.includes(t) ? [t] : [], picks: [], rnd: [], candidates: answers(v, t) });
    }
    for (const it of inv) for (const t of [...targets, ...inv.filter((x) => x !== it)]) for (const v of ['use', 'give'] as VerbId[]) {
      if (v === 'give' && inv.includes(t)) continue;
      fb.candidates++;
      if (!answered(v, it, t) && !(v === 'give' && probe.isPlayer(t) && t !== probe.heroId())) { fb.fallback++; skipped++; continue; }
      addTry({ label: label(game, { verb: v, a: it, b: t }), run: (e) => e.act({ verb: v, a: it, b: t }), items: inv.includes(t) ? [it, t] : [it], picks: [], rnd: [], pair: true, candidates: answers(v, it, t) });
    }
    for (const [actor, topics] of Object.entries(room.talk ?? {})) {
      if (!targets.includes(actor)) continue;
      // the engine numbers visible topics: the label must follow the same list (otherwise the printed path would lie)
      topics.map((tp, orig) => ({ tp, orig })).filter(({ tp }) => check(tp.if, s, room.id)).forEach(({ tp, orig }, i) => addTry({
        label: `Talk ${actor}: "${tp.topic}"`, run: (e) => e.act({ verb: 'talk', a: actor }), items: [], picks: [i], rnd: [], candidates: [`topic:${tp.id ?? `${room.id}/${actor}[${orig}]`}`],
      }));
    }
    for (const [pid, p] of Object.entries(game.map?.places ?? {})) {
      if (!s.unlocked.includes(pid) || p.room === s.room || !game.rooms.some((r) => r.id === p.room)) continue;
      addTry({ label: `Map → ${p.name}`, run: (e) => e.travel(pid), items: [], picks: [], rnd: [], candidates: [] });
    }
    // Several playable characters: taking control of another one.
    for (const pid of probe.playerIds()) if (pid !== probe.heroId()) addTry({ label: `Switch to ${pid}`, run: (e) => e.switchTo(pid).then(() => undefined), items: [], picks: [], rnd: [], candidates: [] });
    // The world's scripts: letting one run until its next wait (or its end) is something the player can do by waiting.
    for (const sc of probe.scriptsHere()) {
      const st = s.scripts?.[sc.id];
      if (st?.done || st?.off || !keys.live.actions.has(sc.id)) continue;
      addTry({ label: `Script ${sc.id}`, run: (e) => e.runScript(sc.id, true).then(() => undefined), items: [], picks: [], rnd: [], candidates: [`script:${sc.id}`] });
    }

    let progressed = false;
    const h0 = JSON.stringify(node.dims);
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
      e.state = structuredClone(s);
      if (por) e.reads = new Set();
      ui.picks = [...t.picks];
      const path = [...node.path];
      let src: Source | null | void = null;
      try {
        await drive(e, t.run(e).then((r) => { src = r; }), (a) => path.push(`(tutorial) ${label(game, a)}`));
      } catch (err) {
        errors.push(`${t.label} (${s.room}): ${(err as Error).message}`);
        continue;
      }
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
      if (t.pair) { if (src === 'rule') fb.rules++; else if (src === 'fallback') fb.fallback++; }
      // Reported even when the state is not worth exploring (a flag nobody reads, a trinket no gate needs): it did happen.
      Object.entries(e.state.flags).forEach(([k, v]) => v && flags.add(k));
      e.state.inventory.forEach((i) => gained.add(i));
      const dims = stateDims(e.state, keys);
      const h = JSON.stringify(dims);
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
      const next: Node = { state: structuredClone(e.state), path: [...path, t.label], steps: [...node.steps, ...(e.session?.log ?? [])], dims, sleep, expanded: false };
      checkInvariants(next.state, next.path);
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
        enqueue(c.next);
        maxQueue = Math.max(maxQueue, queue.length);
        if (seen.size >= maxStates) { if (queue.length) limitReached = true; break; }
      }
    }
    node.expanded = true;
    expansions++;
    triesSum += tries.length;
    if (tries.length > triesMax) { triesMax = tries.length; worst = { room: s.room, inventory: [...s.inventory], tries: tries.length, effective, byVerb }; }
    if (!progressed) deadEnds.push({ path: node.path, room: s.room, inventory: [...s.inventory] });
  }
  const all = seen.size <= 50000 ? [...seen.values()].map((n) => n.dims) : [];
  const dims = splits(all).slice(0, 30);
  const profile: SolveProfile = {
    ms: Date.now() - t0, states: seen.size, tries: tries_total, skipped, slept, postponed, noops, hashHits, maxQueue,
    branching: { avg: expansions ? triesSum / expansions : 0, max: triesMax, ...(worst ? { worst } : {}) },
    fallbackByRoom: Object.fromEntries(fallbackByRoom), dims, perRoom: Object.fromEntries(perRoom), perAction: Object.fromEntries(perAction),
    monotonic: monotonicThings(game), independent: independentGroups(all, dims),
  };

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
  const softlocks = mode === 'prove' && !limitReached && finish
    ? [...seen.entries()].filter(([h]) => !canReachGoal.has(h)).map(([, n]) => ({ path: n.path, room: n.state.room, inventory: [...n.state.inventory] }))
      .sort((a, b) => a.path.length - b.path.length).slice(0, 20)
    : [];
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
    path: (finish ?? last).path,
    steps: (finish ?? last).steps,
    states: seen.size,
    truncated: limitReached,
    flagsReached: [...flags].sort(),
    unlockedReached: [...unlocked].sort(),
    roomsReached: [...roomsReached].sort(),
    unusedItems: Object.keys(game.items).filter((i) => !gained.has(i)).sort(),
    itemsNeverUsed: [...gained].filter((i) => !itemsInRules.has(i)).sort(),
    deadEnds: deadEnds.slice(0, 20),
    softlocks,
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
