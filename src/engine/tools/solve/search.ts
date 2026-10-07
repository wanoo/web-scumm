// The search: the frontier, the proof workers, termination and the verdict (solved, softlocks, unsolved, truncated).
// Since 4.1.13 the states seen live in a store by index (search/compact.ts), the search can be written down and taken
// up again (search/checkpoint.ts), dominance and symmetries have their own file (search/dominance.ts), and the
// workers share the visited table (search/partition.ts).
import { exitOf, solveHeadline } from '../status';
import { check } from '../../core/cond';
import { cmdLists, eachCmd } from '../../core/cmds';
import { atomDim, stubbornKeys, type RW } from '../por';
import type { GameDef, GameState, Layout } from '../../core/types';
import { Frontier } from '../frontier';
import type { ExpandPool } from '../solve-pool';
import { must } from '../../core/must';
import {
  MobilityError,
  OwnershipError,
  dominanceThings,
  independentGroups,
  monotonicThings,
  splits,
} from './abstractions';
import { makeExpander } from './expansion';
import { drive } from './drive';
import { type Expansion, type SearchNode, type NodeInput, type SolveOptions, mergeStats } from './model';
import { type SolveProfile, type SolveResult, label } from './report';
import { type NodeMeta, StateStore } from './search/compact';
import { Dominance } from './search/dominance';
import { explosion } from './explosion';
import { classify } from './search/classify';
import {
  type SearchSnapshot,
  decodeSnapshot,
  encodeSnapshot,
  fingerprint,
  statsFromJson,
  statsToJson,
} from './search/checkpoint';

/**
 * The worker pool, when a Node tool loaded it (`import '@engine/tools/solve-pool'` registers it): this file stays free
 * of worker threads, so the browser (the Studio's demo) bundles the solver without them.
 */
export type PoolOpener = (
  w: number | 'auto',
  gameIn: GameDef,
  layouts: Record<string, Layout>,
  opts: SolveOptions,
  X: ReturnType<typeof makeExpander>,
) => Promise<ExpandPool>;

let poolOpener: PoolOpener | null = null;

export function registerPool(open: PoolOpener) {
  poolOpener = open;
}

/** The expansions in this thread, in order (one worker, no pool, or a pool's fallback). */
export function threadPool(X: ReturnType<typeof makeExpander>, reason?: string): ExpandPool {
  return {
    size: 1,
    ...(reason ? { reason } : {}),
    async expand(inputs, deadline) {
      const out: (Expansion | null)[] = [];
      for (const i of inputs) out.push(Date.now() > deadline ? null : await X.expandNode(i));
      return out;
    },
    async stats() {
      return null;
    },
    async close() {},
  };
}

/**
 * Searches the game for a way to its ending (`witness`), or explores every reachable state for softlocks (`prove`).
 * @public
 */
export async function solve(
  gameIn: GameDef,
  layouts: Record<string, Layout>,
  opts: SolveOptions = {},
): Promise<SolveResult> {
  const r = await solveAbstracted(gameIn, layouts, opts);
  // Dominance prunes on what the content says of absence, a heuristic: a witness search that found nothing after
  // pruning is run again without it, so `unsolved` and `truncated` are never its doing.
  if (r.profile.dominance?.applied && r.profile.dominance.pruned && !r.finished) {
    const again = await solveAbstracted(gameIn, layouts, { ...opts, dominance: false });
    again.profile.dominance = {
      applied: false,
      pruned: r.profile.dominance.pruned,
      reason: `no witness with it (${r.profile.dominance.pruned} pruned): run again without`,
    };
    return again;
  }
  return r;
}

async function solveAbstracted(
  gameIn: GameDef,
  layouts: Record<string, Layout>,
  opts: SolveOptions,
): Promise<SolveResult> {
  try {
    return await solveOnce(gameIn, layouts, opts);
  } catch (e) {
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

/** The heap in use, in MB, where a runtime tells it (Node); null elsewhere (a browser). */
const heapMb = (): number | null => {
  const p = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } }).process;
  return p?.memoryUsage ? p.memoryUsage().heapUsed / 1048576 : null;
};

async function solveOnce(
  gameIn: GameDef,
  layouts: Record<string, Layout>,
  opts: SolveOptions = {},
): Promise<SolveResult> {
  const maxStates = opts.maxStates ?? 20000;
  const X = makeExpander(gameIn, layouts, opts);
  const {
    game,
    mode,
    canonInfo,
    mobInfo,
    ownInfo,
    symInfo,
    dimsOf,
    makeEngine,
    reached,
    goalHolds,
    por,
    memoOn,
    stx,
    stats,
    timed,
    now,
  } = X;
  const { timing } = stats;
  // The store (4.1.13): compact unless asked otherwise, or the partial-order reduction expands a state again.
  const compact = (opts.representation ?? 'compact') === 'compact' && !por;
  const repReason =
    (opts.representation ?? 'compact') === 'compact' && por
      ? 'the partial-order reduction expands a state again: it keeps every state'
      : undefined;
  let store = new StateStore(compact);
  /** `objects`: every node, as 4.1.8 kept them (the partial-order reduction reaches a stored one again). */
  const live = compact ? null : new Map<number, SearchNode>();
  let errors: string[] = [];
  let unlocked = new Set<string>();
  let deadEnds: SolveResult['deadEnds'] = [];
  // The profile
  const t0 = Date.now();
  let postponed = 0,
    hashHits = 0,
    maxQueue = 0,
    expansions = 0,
    triesSum = 0,
    triesMax = 0;
  let worst: SolveProfile['branching']['worst'];
  let perRoom = new Map<string, number>();
  const loopStart = { t: 0 };
  // Workers (solve-pool.ts): the frontier is expanded a batch at a time, each node by whichever worker is free, and
  // merged in the batch's order. The result depends on the batch, never on the number of workers.
  const pool =
    opts.workers === undefined
      ? null
      : poolOpener
        ? await poolOpener(opts.workers, gameIn, layouts, opts, X)
        : threadPool(X, 'no worker pool here (a Node tool loads solve-pool.ts): this thread expands');
  const batch = pool ? Math.max(1, opts.batch ?? 64) : 1;
  const deadline = opts.timeLimitMs ? t0 + opts.timeLimitMs : Infinity;
  let stoppedBy: 'states' | 'time' | 'memory' | undefined;

  // Starting state
  const { e: e0, ui: ui0 } = makeEngine();
  const startPath: string[] = [];
  // Several starts (a chapter's boundary states): one search from all of them, sharing what it has seen.
  const extraStarts =
    opts.start && typeof opts.start === 'object' && 'states' in opts.start ? opts.start.states.slice(1) : [];
  if (opts.start && typeof opts.start === 'object') {
    if ('checkpoint' in opts.start) await e0.checkpoint(opts.start.checkpoint);
    else
      await e0.load(
        structuredClone('states' in opts.start ? must(opts.start.states[0], 'first start state') : opts.start.state),
      );
  } else await drive(e0, e0.newGame(), (a) => startPath.push(`(tutorial) ${label(game, a)}`));
  let broken: SolveResult['broken'] = [];
  let brokenSeen = new Set<number>();
  const checkInvariants = (s: GameState, path: () => string[]) => {
    (game.invariants ?? []).forEach((c, i) => {
      if (!brokenSeen.has(i) && check(c, s)) {
        brokenSeen.add(i);
        broken.push({ invariant: i, path: path() });
      }
    });
  };
  const keepGoals = mode === 'prove' && !!opts.goal;
  /** Stores a node (and what the end of the search reads of it: the items it holds, its state when it is a goal). */
  const put = (n: SearchNode, m: NodeMeta) => {
    store.insert(n.i, m);
    live?.set(n.i, n);
    pool?.remember?.(m.dims);
    for (const it of m.state.inventory) stats.gained.add(it);
  };
  /** A goal state: kept by index, its engine state with it when a chapter's boundaries are asked for (the stored one). */
  const goal = (i: number, s: GameState | undefined) => {
    store.goals.add(i);
    const st = live?.get(i)?.state ?? s;
    if (keepGoals && st && !store.goalStates.has(i)) store.goalStates.set(i, st);
  };
  // Best-first: the more a state has progressed, the earlier it's explored. At equal progress, the shortest path first.
  const score = (n: SearchNode) =>
    n.state.unlocked.length * 20 +
    Object.values(n.state.flags).filter(Boolean).length * 3 +
    n.state.inventory.length * 2 -
    n.len * 0.01;
  // A heap in the order of the old sorted list (score, then arrival): same witnesses, O(log n) instead of O(n).
  let queue = new Frontier<SearchNode>(score);
  const enqueue = (n: SearchNode) => queue.push(n);
  /** A root of the search: the start, another start state, an intro choice. */
  const root = (state: GameState, tail: string[], tailSteps: NodeMeta['tailSteps'], len: number) => {
    const dims = dimsOf(state);
    const i = store.ref(store.keyOf(dims));
    if (store.isSeen(i)) return undefined;
    const n: SearchNode = { i, state: structuredClone(state), dims, len, sleep: new Map(), expanded: false };
    put(n, { parent: -1, len, tail, tailSteps, state: n.state, dims });
    enqueue(n);
    return n;
  };
  const start = must(root(e0.state, startPath, e0.session?.log ?? [], startPath.length), 'start');
  let finish: number | null = null;
  if (reached(ui0, e0.state)) {
    finish = start.i;
    goal(start.i, start.state);
  }
  for (const [k, st0] of extraStarts.entries()) {
    const { e } = makeEngine();
    await e.load(structuredClone(st0));
    const n = root(e.state, [`(start ${k + 2} of ${extraStarts.length + 1})`], [], 1);
    if (n && (opts.goal ? goalHolds(e.state) : e.state.done)) {
      goal(n.i, n.state);
      finish ??= n.i;
    }
  }
  // A proof from "New game" branches over the intro's choices too (the silent presenter picks the last option by
  // default): each choice met during the start is varied one at a time, the others at their default. Without this,
  // a flag the intro sets from a choice would be "proved" on one value only.
  if (mode === 'prove' && (opts.start === undefined || opts.start === 'new')) {
    for (let j = 0; j < ui0.asked.length; j++)
      for (let o = 0; o < must(ui0.asked[j], 'intro prompt').n - 1; o++) {
        const { e, ui } = makeEngine();
        ui.picks = [...ui0.asked.slice(0, j).map((a) => a.n - 1), o];
        const path: string[] = [`New game › "${must(ui0.asked[j], 'intro prompt').texts[o]}"`];
        await drive(e, e.newGame(), (a) => path.push(`(tutorial) ${label(game, a)}`));
        const alt = root(e.state, path, e.session?.log ?? [], path.length);
        if (alt && reached(ui, e.state)) {
          goal(alt.i, alt.state);
          finish ??= alt.i;
        }
      }
  }
  // Witness dominance (search/dominance.ts); in a proof only for the differential tests (`unsafeReduction`): it
  // changes softlock verdicts there (tests/dominance.test.ts).
  const dom =
    opts.dominance && (mode === 'witness' || opts.unsafeReduction) ? new Dominance(dominanceThings(game)) : null;
  if (dom) for (const i of store.order.slice()) dom.remember(store.dimsOf(i));
  let limitReached = false;
  let last = start.i;
  checkInvariants(start.state, () => store.path(start.i));

  // Checkpoint and resume (search/checkpoint.ts): only the compact store is written down.
  const ck = opts.checkpoint;
  const print = fingerprint(gameIn, layouts, opts, batch);
  const ckInfo: NonNullable<SolveProfile['checkpoint']> = { written: 0 };
  let msBefore = 0;
  if (ck?.resume && dom) ckInfo.refused = 'dominance keeps an index a checkpoint does not write';
  else if (ck?.resume) {
    const snap = decodeSnapshot(ck.resume);
    if (!compact) ckInfo.refused = 'a checkpoint needs the compact representation';
    else if (!snap) ckInfo.refused = 'not a snapshot of a search';
    else if (snap.header.fingerprint !== print) ckInfo.refused = 'a snapshot of another search (game or options)';
    else {
      store = StateStore.restore(snap.store);
      queue = Frontier.restore(score, snap.frontier, (v): SearchNode => ({ ...v, sleep: new Map(), expanded: false }));
      const L = snap.loop;
      ({ postponed, hashHits, maxQueue, expansions, triesSum, triesMax } = L);
      worst = L.worst;
      perRoom = new Map(L.perRoom);
      unlocked = new Set(L.unlocked);
      deadEnds = L.deadEnds;
      broken = L.broken;
      brokenSeen = new Set(L.brokenSeen);
      errors = L.errors;
      finish = L.finish;
      last = L.last;
      if (dom) dom.pruned = L.pruned;
      statsFromJson(snap.stats, stats);
      msBefore = snap.header.ms;
      ckInfo.resumedAt = { states: store.seenCount, expansions };
      if (pool?.remember) for (const i of store.order.slice()) pool.remember(store.dimsOf(i));
    }
  }
  const snapshot = (): SearchSnapshot => ({
    header: { v: 1, fingerprint: print, states: store.seenCount, expansions, ms: msBefore + Date.now() - t0 },
    store: store.snapshot(),
    frontier: queue.snapshot((n) => ({ i: n.i, state: n.state, dims: n.dims, len: n.len })),
    loop: {
      postponed,
      hashHits,
      maxQueue,
      expansions,
      triesSum,
      triesMax,
      pruned: dom?.pruned ?? 0,
      ...(worst ? { worst } : {}),
      perRoom: [...perRoom],
      unlocked: [...unlocked],
      deadEnds,
      broken,
      brokenSeen: [...brokenSeen],
      errors,
      finish,
      last,
    },
    stats: statsToJson(stats),
  });
  let ckAt = { t: Date.now(), n: expansions };
  const writeCheckpoint = () => {
    if (!ck || !compact || dom) return;
    ck.save(encodeSnapshot(snapshot()));
    ckInfo.written++;
    ckAt = { t: Date.now(), n: expansions };
  };

  /** What popping a node counts (the rooms, flags, places and items the search has been through). */
  const visit = (node: SearchNode) => {
    const s = node.state;
    last = node.i;
    stats.roomsReached.add(s.room);
    perRoom.set(s.room, (perRoom.get(s.room) ?? 0) + 1);
    Object.entries(s.flags).forEach(([k, v]) => v && stats.flags.add(k));
    s.unlocked.forEach((u) => unlocked.add(u));
    s.inventory.forEach((i) => stats.itemsSeen.add(i));
  };
  /** The store's index of a record's state (a no-op is the node itself). */
  const indexOf = (node: SearchNode, r: Expansion['records'][number]) =>
    r.noop ? node.i : store.ref(compact ? store.keyOf(r.dims!) : r.h);
  /** An expansion's records into the search: goals, edges, new states, the frontier. Reads the store; the expansion never did. */
  const merge = (node: SearchNode, exp: Expansion) => {
    const s = node.state;
    const i0 = node.i;
    for (const b of exp.broken)
      if (!brokenSeen.has(b.invariant)) {
        brokenSeen.add(b.invariant);
        broken.push({ invariant: b.invariant, path: [...store.path(i0), ...b.suffix] });
      }
    errors.push(...exp.errors);
    const children: { key: string; next: SearchNode; meta: NodeMeta }[] = [];
    const out = new Set<number>();
    let anyHit = false;
    for (const r of exp.records) {
      const i = indexOf(node, r);
      if (r.hitGoal) goal(i, r.noop ? s : r.state);
      if (r.noop) continue;
      if (!out.has(i)) {
        out.add(i);
        store.edge(i0, i);
      }
      const sleep = r.sleep ?? new Map<string, RW>();
      if (store.isSeen(i) || children.some((c) => c.next.i === i)) {
        hashHits++;
        anyHit = true;
        if (por === 'sleep' && store.isSeen(i)) {
          // The same state, reached with a different sleep set: only what both paths sleep stays asleep; what this path
          // frees is still to be tried there.
          const stored = must(live?.get(i), 'stored node');
          const freed = [...stored.sleep.keys()].filter((k) => !sleep.has(k));
          if (freed.length) {
            for (const k of freed) stored.sleep.delete(k);
            if (stored.expanded) {
              if (stored.only) freed.forEach((k) => stored.only!.add(k));
              else {
                stored.only = new Set(freed);
                enqueue(stored);
              }
            }
          }
        }
        continue;
      }
      const state = must(r.state, 'the state of a new record');
      const next: SearchNode = { i, state, dims: r.dims!, len: node.len + r.path!.length, sleep, expanded: false };
      const meta: NodeMeta = {
        parent: i0,
        len: next.len,
        tail: r.path!,
        tailSteps: r.tailSteps!,
        via: r.label,
        state,
        dims: r.dims!,
      };
      checkInvariants(state, () => [...store.path(i0), ...r.path!]);
      if (r.hitGoal) {
        put(next, meta);
        finish ??= i;
        if (mode === 'witness') break;
        // The ending is terminal. Keep trying the other actions from the source state, but do not expand past it.
        continue;
      }
      if (dom) {
        if (dom.dominated(next.dims)) {
          dom.pruned++;
          continue;
        }
        dom.remember(next.dims);
      }
      children.push({ key: r.key, next, meta });
    }
    if (mode === 'prove' || finish === null) {
      // Stubborn mode: of the commuting actions, one at a time. The content's actions no try stands for (a hidden
      // topic, a rule on something not shown yet) count as held-back transitions too.
      let keep: Set<string> | null = null;
      if (stx) {
        const txs = [...exp.txs];
        const covered = new Set(txs.flatMap((t) => t.candidates));
        for (const st of stx.forRoom(s.room))
          if (!covered.has(st.id))
            txs.push({
              key: st.id,
              enabled: false,
              rw: { reads: new Set([...st.reads, ...st.gates.map(atomDim)]), writes: new Set(st.writes) },
              candidates: [st.id],
              gates: [st.gates],
              visible: false,
            });
        keep = stubbornKeys(txs, stx, s, s.room, { all: anyHit });
        postponed += children.filter((c) => !keep!.has(c.key)).length;
      }
      for (const c of children) {
        if (keep && !keep.has(c.key)) continue;
        put(c.next, c.meta);
        timed('queue', () => enqueue(c.next));
        maxQueue = Math.max(maxQueue, queue.size);
        if (store.seenCount >= maxStates) {
          if (queue.size) limitReached = true;
          break;
        }
      }
    }
    node.expanded = true;
    expansions++;
    triesSum += exp.tries;
    if (exp.tries > triesMax) {
      triesMax = exp.tries;
      worst = {
        room: s.room,
        inventory: [...s.inventory],
        tries: exp.tries,
        effective: exp.effective,
        byVerb: exp.byVerb,
      };
    }
    if (!exp.progressed && deadEnds.length < 20)
      deadEnds.push({ path: store.path(i0), room: s.room, inventory: [...s.inventory] });
  };
  const input = (node: SearchNode): NodeInput => {
    const only = node.only;
    node.only = undefined;
    return { state: node.state, dims: node.dims, sleep: node.sleep, ...(only ? { only } : {}) };
  };
  /** A worker said "stored already" of a state the store does not have (a 64-bit collision): expand it here. */
  const collided = (node: SearchNode, exp: Expansion) =>
    exp.records.some((r) => r.known && !store.isSeen(indexOf(node, r)));
  let collisions = 0;

  loopStart.t = now();
  try {
    while (queue.size && (mode === 'prove' || finish === null)) {
      if (store.seenCount >= maxStates) {
        limitReached = true;
        stoppedBy = 'states';
        break;
      }
      if (Date.now() > deadline) {
        limitReached = true;
        stoppedBy = 'time';
        break;
      }
      const nodes: SearchNode[] = [];
      const entries: { v: SearchNode; score: number; seq: number }[] = [];
      while (nodes.length < batch && queue.size) {
        const en = timed('queue', () => queue.popEntry()!);
        const n = en.v;
        // Witness dominance: a state that a better one (more progress, the rest equal) has overtaken since it was queued.
        if (dom && dom.dominated(n.dims, true)) {
          dom.pruned++;
          continue;
        }
        nodes.push(n);
        entries.push(en);
      }
      if (!nodes.length) continue;
      const exps = pool
        ? await pool.expand(nodes.map(input), deadline)
        : [await X.expandNode(input(must(nodes[0], 'first node')))];
      for (let k = 0; k < nodes.length; k++) {
        // The batch is taken from the frontier at once; the rest of it is dropped as the one-at-a-time search would
        // have stopped before it (the budget, a witness found).
        if (k > 0 && (store.seenCount >= maxStates || (mode === 'witness' && finish !== null))) {
          if (store.seenCount >= maxStates) {
            limitReached = true;
            stoppedBy = 'states';
            // Back to the frontier, in their places: a checkpoint written now must hold them (no state lost).
            for (const en of entries.slice(k)) queue.pushEntry(en);
          }
          break;
        }
        if (!exps[k]) {
          limitReached = true;
          stoppedBy = 'time';
          for (const en of entries.slice(k)) queue.pushEntry(en);
          break;
        }
        const node = must(nodes[k], 'batch node');
        let exp = exps[k]!;
        if (collided(node, exp)) {
          collisions++;
          exp = await X.expandNode({ state: node.state, dims: node.dims, sleep: node.sleep });
        }
        visit(node);
        merge(node, exp);
        if (expansions % 256 === 0) {
          opts.onProgress?.({ states: store.seenCount, expansions, queue: queue.size, ms: Date.now() - t0 });
          const mb = opts.maxMemoryMb ? heapMb() : null;
          if (mb !== null && mb > opts.maxMemoryMb!) {
            limitReached = true;
            stoppedBy = 'memory';
          }
        }
      }
      if (limitReached) break;
      if (
        ck &&
        (expansions - ckAt.n >= (ck.everyExpansions ?? Infinity) || Date.now() - ckAt.t >= (ck.everyMs ?? 300000))
      )
        writeCheckpoint();
    }
  } finally {
    if (pool) {
      const w = await pool.stats();
      if (w) mergeStats(stats, w);
      await pool.close();
    }
  }
  if (limitReached && !stoppedBy) stoppedBy = 'states';
  // A budget stopped it: written down, so a later run with more budget takes it up from here.
  if (limitReached && queue.size) writeCheckpoint();
  const { itemsInRules, flags, gained, roomsReached, attempted, perAction, fallbackByRoom, n: cnt } = stats;
  canonInfo.folded = stats.canon.folded;
  canonInfo.explicit = stats.canon.explicit;
  if (mobInfo.applied) {
    mobInfo.moves = stats.mob.moves;
    mobInfo.largest = stats.mob.largest;
  }
  ownInfo.handovers = stats.own.handovers;
  const loopMs = now() - loopStart.t;
  timing.other = Math.max(
    0,
    loopMs - timing.tries - timing.engine - timing.clone - timing.run - timing.hash - timing.queue,
  );
  const seenOrder = Array.from(store.order.slice());
  const all = store.seenCount <= 50000 ? seenOrder.map((i) => store.dimsOf(i)) : [];
  const dims = splits(all).slice(0, 30);
  const shared = pool?.shared?.();
  const profile: SolveProfile = {
    ms: Date.now() - t0,
    states: store.seenCount,
    tries: cnt.tries,
    skipped: cnt.skipped,
    slept: cnt.slept,
    postponed,
    noops: cnt.noops,
    hashHits,
    maxQueue,
    branching: { avg: expansions ? triesSum / expansions : 0, max: triesMax, ...(worst ? { worst } : {}) },
    fallbackByRoom: Object.fromEntries(fallbackByRoom),
    dims,
    perRoom: Object.fromEntries(perRoom),
    perAction: Object.fromEntries(perAction),
    attempted: Object.fromEntries(attempted),
    monotonic: monotonicThings(game),
    independent: independentGroups(all, dims),
    timing,
    positions: store.positions,
    canonical: canonInfo,
    mobility: mobInfo,
    ownership: ownInfo,
    dominance: {
      applied: !!dom,
      pruned: dom?.pruned ?? 0,
      ...(dom
        ? {}
        : {
            reason:
              mode === 'prove'
                ? 'off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts)'
                : 'not asked for (--dominance)',
          }),
    },
    memo: {
      applied: memoOn,
      stored: cnt.memoStored,
      hits: cnt.memoHits,
      verified: cnt.memoVerified,
      refused: cnt.memoRefused,
      ...(memoOn ? {} : { reason: opts.memo === false ? 'turned off' : 'off with a partial-order reduction' }),
    },
    workers: pool
      ? { workers: pool.size, batch, ...(pool.reason ? { reason: pool.reason } : {}) }
      : { workers: 1, batch: 1 },
    ...(stoppedBy ? { stoppedBy } : {}),
    representation: {
      mode: compact ? 'compact' : 'objects',
      bytes: compact ? store.bytes() : 0,
      ...(repReason ? { reason: repReason } : {}),
    },
    ...(ck ? { checkpoint: ckInfo } : {}),
    symmetry: symInfo,
    ...(pool
      ? {
          shared: shared
            ? { ...shared, collisions }
            : { applied: false, known: 0, collisions, reason: 'no shared table in this pool' },
        }
      : {}),
  };

  if (opts.explosion)
    profile.explosion = explosion(
      seenOrder.slice(0, 50000).map((i) => store.dimsOf(i)),
      game,
      profile,
    );
  const tClassify = now();
  const { unsafe, softlocks, softlockCauses } = classify(
    store,
    seenOrder,
    mode === 'prove' && !limitReached && store.goals.size > 0,
    mode === 'prove' && !limitReached && finish !== null,
  );
  timing.classify = now() - tClassify;
  const boundaries =
    mode === 'prove' && opts.goal && !limitReached
      ? [...store.goals]
          .map((i) => store.goalStates.get(i))
          .filter((x): x is GameState => !!x)
          .map((x) => structuredClone(x))
      : [];
  const assumptions = new Set<string>();
  for (const { list } of cmdLists(game))
    eachCmd(list, (c) => {
      if (typeof c !== 'string' && 'minigame' in c) assumptions.add(`minigame:${c.minigame}:success`);
    });
  const uniqueErrors = [...new Set(errors)].slice(0, 50);
  const status: SolveResult['status'] = uniqueErrors.length
    ? 'error'
    : broken.length
      ? 'broken'
      : limitReached
        ? 'truncated'
        : finish === null
          ? 'unsolved'
          : softlocks.length
            ? 'softlocks'
            : 'solved';
  const end = finish ?? last;
  return {
    status,
    exit: exitOf(status),
    headline: solveHeadline({
      status,
      mode,
      states: store.seenCount,
      softlockCount: unsafe.length,
      broken,
      errors: uniqueErrors,
      goal: !!opts.goal,
      stoppedBy,
    }),
    mode,
    finished: finish !== null,
    path: store.path(end),
    steps: store.steps(end),
    states: store.seenCount,
    truncated: limitReached,
    flagsReached: [...flags].sort(),
    liveFlags: [...X.keys.live.flags].sort(),
    unlockedReached: [...unlocked].sort(),
    roomsReached: [...roomsReached].sort(),
    unusedItems: Object.keys(game.items)
      .filter((i) => !gained.has(i))
      .sort(),
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
    ...(game.reality ? { reality: realityLabel(opts.reality) } : {}),
    ...(opts.keepReachable ? { reachable: seenOrder.map((i) => store.jsonKey(i)).sort() } : {}),
  };
}

/**
 * Which world a verdict holds in (4.1.1): "proved without the outside world", "under scenario X", or against any
 * order and repetition of the declared signals. The report says it, so a proof never assumes a service cooperated.
 */
function realityLabel(p: SolveOptions['reality']): string {
  if (!p || p === 'closed') return 'closed: without the world outside';
  if (p === 'adversarial') return 'adversarial: any declared signal, at any point, again';
  return `scenario ${p.scenario}: ${p.signals.join(' → ') || 'no signal'}`;
}
