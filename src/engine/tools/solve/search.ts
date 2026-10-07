// The search: the frontier, the proof workers, termination and the verdict (solved, softlocks, unsolved, truncated).
import { exitOf, solveHeadline } from '../status';
import { check } from '../../core/cond';
import { cmdLists, eachCmd } from '../../core/cmds';
import { atomDim, stubbornKeys, type RW } from '../por';
import type { GameDef, GameState, Id, Layout } from '../../core/types';
import { Frontier } from '../frontier';
import type { ExpandPool } from '../solve-pool';
import { must } from '../../core/must';
import {
  type Dims,
  MobilityError,
  OwnershipError,
  dominanceThings,
  independentGroups,
  monotonicThings,
  splits,
} from './abstractions';
import { drive, makeExpander } from './expansion';
import { type Expansion, type SearchNode, type NodeInput, type SolveOptions, mergeStats } from './model';
import { type SolveProfile, type SolveResult, label, pathOf, stepsOf } from './report';

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
  const errors: string[] = [];
  const unlocked = new Set<string>();
  const deadEnds: SolveResult['deadEnds'] = [];
  // The profile
  const t0 = Date.now();
  let postponed = 0,
    hashHits = 0,
    maxQueue = 0,
    expansions = 0,
    triesSum = 0,
    triesMax = 0;
  let worst: SolveProfile['branching']['worst'];
  const perRoom = new Map<string, number>();
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
  let stoppedBy: 'states' | 'time' | undefined;

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
  const broken: SolveResult['broken'] = [];
  const brokenSeen = new Set<number>();
  const checkInvariants = (s: GameState, path: () => string[]) => {
    (game.invariants ?? []).forEach((c, i) => {
      if (!brokenSeen.has(i) && check(c, s)) {
        brokenSeen.add(i);
        broken.push({ invariant: i, path: path() });
      }
    });
  };

  const seen = new Map<string, SearchNode>();
  const start: SearchNode = {
    state: structuredClone(e0.state),
    tail: startPath,
    tailSteps: e0.session?.log ?? [],
    len: startPath.length,
    dims: dimsOf(e0.state),
    sleep: new Map(),
    expanded: false,
  };
  // Best-first: the more a state has progressed, the earlier it's explored. At equal progress, the shortest path first.
  const score = (n: SearchNode) =>
    n.state.unlocked.length * 20 +
    Object.values(n.state.flags).filter(Boolean).length * 3 +
    n.state.inventory.length * 2 -
    n.len * 0.01;
  // A heap in the order of the old sorted list (score, then arrival): same witnesses, O(log n) instead of O(n).
  const queue = new Frontier<SearchNode>(score);
  queue.push(start);
  const enqueue = (n: SearchNode) => queue.push(n);
  seen.set(JSON.stringify(start.dims), start);
  let finish: SearchNode | null = reached(ui0, e0.state) ? start : null;
  const startHash = JSON.stringify(start.dims);
  const goals = new Set<string>(finish ? [startHash] : []);
  for (const [k, st0] of extraStarts.entries()) {
    const { e } = makeEngine();
    await e.load(structuredClone(st0));
    const dims = dimsOf(e.state);
    const h = JSON.stringify(dims);
    if (seen.has(h)) continue;
    const n: SearchNode = {
      state: structuredClone(e.state),
      tail: [`(start ${k + 2} of ${extraStarts.length + 1})`],
      tailSteps: [],
      len: 1,
      dims,
      sleep: new Map(),
      expanded: false,
    };
    seen.set(h, n);
    enqueue(n);
    if (opts.goal ? goalHolds(e.state) : e.state.done) {
      goals.add(h);
      finish ??= n;
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
        const dims = dimsOf(e.state);
        const h = JSON.stringify(dims);
        if (seen.has(h)) continue;
        const alt: SearchNode = {
          state: structuredClone(e.state),
          tail: path,
          tailSteps: e.session?.log ?? [],
          len: path.length,
          dims,
          sleep: new Map(),
          expanded: false,
        };
        seen.set(h, alt);
        enqueue(alt);
        if (reached(ui, e.state)) {
          goals.add(h);
          finish ??= alt;
        }
      }
  }
  const edges = new Map<string, Set<string>>();
  // Witness dominance: states indexed by everything but their dominance things; a new one whose things are a subset of
  // a seen one's, with the rest equal, has nothing more to offer a witness.
  const dom = opts.dominance && mode === 'witness' ? dominanceThings(game) : null;
  const domIndex = new Map<string, Set<string>[]>();
  let pruned = 0;
  const domSplit = (d: Dims) => {
    const mono = new Set<string>();
    const rest: Dims = [];
    for (const [k, v] of d)
      (k.startsWith('flag:') && v === 'true' && dom!.flags.has(k.slice(5))) ||
      (k.startsWith('item:') && dom!.items.has(k.slice(5)))
        ? mono.add(k)
        : rest.push([k, v]);
    return { key: JSON.stringify(rest), mono };
  };
  /** Some state seen has all of this one's progress (`strict`: and more), everything else equal. */
  const dominated = (d: Dims, strict = false) => {
    const { key, mono } = domSplit(d);
    return !!domIndex.get(key)?.some((m) => m.size >= mono.size + (strict ? 1 : 0) && [...mono].every((x) => m.has(x)));
  };
  const remember = (d: Dims) => {
    const { key, mono } = domSplit(d);
    (domIndex.get(key) ?? (domIndex.set(key, []), domIndex.get(key)!)).push(mono);
  };
  if (dom) for (const n of seen.values()) remember(n.dims);
  let limitReached = false;
  let last: SearchNode = start;
  checkInvariants(start.state, () => pathOf(start));

  /** What popping a node counts (the rooms, flags, places and items the search has been through). */
  const visit = (node: SearchNode) => {
    const s = node.state;
    last = node;
    stats.roomsReached.add(s.room);
    perRoom.set(s.room, (perRoom.get(s.room) ?? 0) + 1);
    Object.entries(s.flags).forEach(([k, v]) => v && stats.flags.add(k));
    s.unlocked.forEach((u) => unlocked.add(u));
    s.inventory.forEach((i) => stats.itemsSeen.add(i));
  };
  /** An expansion's records into the search: goals, edges, new states, the frontier. Reads `seen`; the expansion never did. */
  const merge = (node: SearchNode, exp: Expansion) => {
    const s = node.state;
    const h0 = JSON.stringify(node.dims);
    for (const b of exp.broken)
      if (!brokenSeen.has(b.invariant)) {
        brokenSeen.add(b.invariant);
        broken.push({ invariant: b.invariant, path: [...pathOf(node), ...b.suffix] });
      }
    errors.push(...exp.errors);
    const children: { key: string; next: SearchNode; h: string }[] = [];
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
      const next: SearchNode = {
        state: r.state!,
        prev: node,
        tail: r.path!,
        tailSteps: r.tailSteps!,
        len: node.len + r.path!.length,
        dims: r.dims!,
        sleep,
        expanded: false,
        parent: h0,
        via: r.label,
      };
      checkInvariants(next.state, () => pathOf(next));
      if (r.hitGoal) {
        seen.set(h, next);
        finish ??= next;
        if (mode === 'witness') break;
        // The ending is terminal. Keep trying the other actions from the source state, but do not expand past it.
        continue;
      }
      if (dom) {
        if (dominated(next.dims)) {
          pruned++;
          continue;
        }
        remember(next.dims);
      }
      children.push({ key: r.key, next, h });
    }
    if (mode === 'prove' || !finish) {
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
        seen.set(c.h, c.next);
        timed('queue', () => enqueue(c.next));
        maxQueue = Math.max(maxQueue, queue.size);
        if (seen.size >= maxStates) {
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
      deadEnds.push({ path: pathOf(node), room: s.room, inventory: [...s.inventory] });
  };
  const input = (node: SearchNode): NodeInput => {
    const only = node.only;
    node.only = undefined;
    return { state: node.state, dims: node.dims, sleep: node.sleep, ...(only ? { only } : {}) };
  };

  loopStart.t = now();
  try {
    while (queue.size && (mode === 'prove' || !finish)) {
      if (seen.size >= maxStates) {
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
      while (nodes.length < batch && queue.size) {
        const n = timed('queue', () => queue.pop()!);
        // Witness dominance: a state that a better one (more progress, the rest equal) has overtaken since it was queued.
        if (dom && dominated(n.dims, true)) {
          pruned++;
          continue;
        }
        nodes.push(n);
      }
      if (!nodes.length) continue;
      const exps = pool
        ? await pool.expand(nodes.map(input), deadline)
        : [await X.expandNode(input(must(nodes[0], 'first node')))];
      for (let k = 0; k < nodes.length; k++) {
        // The batch is taken from the frontier at once; the rest of it is dropped as the one-at-a-time search would
        // have stopped before it (the budget, a witness found).
        if (k > 0 && (seen.size >= maxStates || (mode === 'witness' && finish))) {
          if (seen.size >= maxStates) {
            limitReached = true;
            stoppedBy = 'states';
          }
          break;
        }
        if (!exps[k]) {
          limitReached = true;
          stoppedBy = 'time';
          break;
        }
        const node = must(nodes[k], 'batch node');
        visit(node);
        merge(node, exps[k]!);
      }
      if (limitReached) break;
    }
  } finally {
    if (pool) {
      const w = await pool.stats();
      if (w) mergeStats(stats, w);
      await pool.close();
    }
  }
  if (limitReached && !stoppedBy) stoppedBy = 'states';
  const { itemsInRules, itemsSeen, flags, gained, roomsReached, attempted, perAction, fallbackByRoom, n: cnt } = stats;
  void itemsSeen;
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
  const all = seen.size <= 50000 ? [...seen.values()].map((n) => n.dims) : [];
  const dims = splits(all).slice(0, 30);
  const positions = new Set(
    [...seen.values()].map(
      (n) =>
        `${n.state.active ?? ''}|${n.state.room}|${Object.entries(n.state.players ?? {})
          .map(([k, p]) => `${k}:${p.room}`)
          .sort()
          .join(',')}`,
    ),
  ).size;
  const profile: SolveProfile = {
    ms: Date.now() - t0,
    states: seen.size,
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
    positions,
    canonical: canonInfo,
    mobility: mobInfo,
    ownership: ownInfo,
    dominance: {
      applied: !!dom,
      pruned,
      ...(dom
        ? {}
        : { reason: mode === 'prove' ? 'a proof cannot prune by dominance' : 'not asked for (--dominance)' }),
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
  };

  const tClassify = now();
  // In proof mode, a state is safe iff a goal is reachable from it. Reverse reachability classifies cycles as well as
  // immediate dead ends, which the old `progressed` test could not do.
  const canReachGoal = new Set<string>();
  if (mode === 'prove' && !limitReached && goals.size) {
    const reverse = new Map<string, Set<string>>();
    for (const [from, tos] of edges)
      for (const to of tos) (reverse.get(to) ?? (reverse.set(to, new Set()), reverse.get(to)!)).add(from);
    const todo = [...goals];
    while (todo.length) {
      const h = todo.pop()!;
      if (canReachGoal.has(h)) continue;
      canReachGoal.add(h);
      for (const p of reverse.get(h) ?? []) todo.push(p);
    }
  }
  const unsafe =
    mode === 'prove' && !limitReached && finish ? [...seen.entries()].filter(([h]) => !canReachGoal.has(h)) : [];
  const softlocks = [...unsafe]
    .sort(([, a], [, b]) => a.len - b.len)
    .slice(0, 20)
    .map(([, n]) => ({ path: pathOf(n), room: n.state.room, inventory: [...n.state.inventory] }));
  // The step that lost the game: walk each unsafe state up to the first unsafe one whose parent is safe (or the start).
  const causes = new Map<string, { action: string; room: Id; count: number; len: number; node: SearchNode }>();
  for (const [, n] of unsafe) {
    let cur: SearchNode = n;
    while (cur.parent && !canReachGoal.has(cur.parent) && seen.has(cur.parent)) cur = seen.get(cur.parent)!;
    const action = cur.via ?? '(start)';
    const room = cur.parent ? seen.get(cur.parent)!.state.room : cur.state.room;
    const key = `${room}\u0000${action}`;
    const c = causes.get(key);
    if (c) {
      c.count++;
      if (cur.len < c.len) {
        c.len = cur.len;
        c.node = cur;
      }
    } else causes.set(key, { action, room, count: 1, len: cur.len, node: cur });
  }
  const softlockCauses = [...causes.values()]
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .map(({ action, room, count, node }) => ({ action, room, count, sample: pathOf(node) }));
  timing.classify = now() - tClassify;
  const boundaries =
    mode === 'prove' && opts.goal && !limitReached
      ? [...goals]
          .map((h) => seen.get(h)!)
          .filter(Boolean)
          .map((n) => structuredClone(n.state))
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
        : !finish
          ? 'unsolved'
          : softlocks.length
            ? 'softlocks'
            : 'solved';

  for (const n of seen.values()) n.state.inventory.forEach((i) => gained.add(i));
  return {
    status,
    exit: exitOf(status),
    headline: solveHeadline({
      status,
      mode,
      states: seen.size,
      softlockCount: unsafe.length,
      broken,
      errors: uniqueErrors,
      goal: !!opts.goal,
      stoppedBy,
    }),
    mode,
    finished: !!finish,
    path: pathOf(finish ?? last),
    steps: stepsOf(finish ?? last),
    states: seen.size,
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
