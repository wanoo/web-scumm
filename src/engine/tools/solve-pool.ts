// Proof workers (3.5): the search's frontier expanded by worker threads. The search takes a batch of nodes from its
// frontier (best first), each node goes to whichever worker is free, and the expansions come back to be merged in the
// batch's order (solve.ts `merge`): what is found depends on the batch size, never on how many workers expanded it,
// so 1, 2, 4 or 8 workers give the same result (tests/workers.test.ts). One worker is the same search in this thread.
// A worker that cannot start leaves the work to this thread; one that stops mid-search leaves the pool, its node going
// to the others (or to this thread when none is left): the result stays the same, only slower (`profile.workers.reason`). Measured in BENCH.md "3.5": workers stay off unless asked for (`--workers=N`). A Node
// tool imports this file to have them (solve.ts does not: the browser bundles the solver without worker threads).
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import type { GameDef, Layout } from '../core/types';
import { mergeStats, mobilityError, ownershipError, registerPool, threadPool, type Expansion, type ExpandStats, type NodeInput, type SolveOptions, type makeExpander } from './solve';

export interface ExpandPool {
  size: number;
  reason?: string;
  expand(inputs: NodeInput[], deadline: number): Promise<(Expansion | null)[]>;
  /** What the workers counted (the search's own expansions are in its stats already). */
  stats(): Promise<ExpandStats | null>;
  close(): Promise<void>;
}

/** `auto`: one per core but one, at most 8. */
export function workerCount(w: number | 'auto' | undefined): number {
  if (w === 'auto') return Math.max(1, Math.min(8, cpus().length - 1));
  return Math.max(1, Math.floor(w ?? 1));
}

/** Options a worker needs (functions do not cross: custom commands come from the game's module). */
function workerOpts(opts: SolveOptions) {
  const { mode, goal, canonicalPlayers, mobility, ownership, memo, memoVerify, por, unsafeReduction } = opts;
  return { mode, goal, canonicalPlayers, mobility, ownership, memo, memoVerify, por, unsafeReduction };
}

export async function openPool(n: number | 'auto', gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions, X: ReturnType<typeof makeExpander>): Promise<ExpandPool> {
  n = workerCount(n);
  if (n <= 1) return threadPool(X);
  if (opts.por) return threadPool(X, 'workers do not run with a partial-order reduction');
  if (opts.commands && Object.keys(opts.commands).length && !opts.gameModule) return threadPool(X, 'the custom commands need the game module (gameModule) to reach the workers');
  let data: { game: GameDef; layouts: Record<string, Layout> };
  try { data = structuredClone({ game: gameIn, layouts }); } catch (e) { return threadPool(X, `the game cannot be sent to a worker (${(e as Error).message})`); }
  const workers: Worker[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const crash = opts.workerCrash && [i, 'all'].includes(opts.workerCrash.worker) ? opts.workerCrash : undefined;
      const w = new Worker(new URL('./solve-worker.mjs', import.meta.url), { workerData: { ...data, opts: workerOpts(opts), module: opts.gameModule, crash } });
      workers.push(w);
    }
    await Promise.all(workers.map((w) => new Promise<void>((ok, ko) => {
      w.once('message', (m: { type: string; message?: string }) => (m.type === 'ready' ? ok() : ko(new Error(m.message ?? 'a worker did not start'))));
      w.once('error', ko);
    })));
  } catch (e) {
    await Promise.all(workers.map((w) => w.terminate()));
    return threadPool(X, `the workers did not start (${(e as Error).message}): this thread expands`);
  }
  let reason: string | undefined;
  let closing = false;
  let seq = 0;
  const pending = new Map<number, { resolve: (e: Expansion | null) => void; reject: (e: Error) => void; input: NodeInput; deadline: number }>();
  const idle: Worker[] = [...workers];
  const queue: number[] = [];
  const busy = new Map<Worker, number>();
  /** Workers that stopped: out of the pool for good (never sent a node, never asked for their stats). */
  const dead = new Set<Worker>();
  const live = () => workers.filter((w) => !dead.has(w));
  /** This thread expands a node (no worker left). */
  const here = (id: number) => { const p = pending.get(id)!; pending.delete(id); X.expandNode(p.input).then(p.resolve, p.reject); };
  const dispatch = () => {
    if (!live().length) { for (const id of queue.splice(0)) here(id); return; }
    while (idle.length && queue.length) {
      const id = queue.shift()!, w = idle.shift()!, p = pending.get(id)!;
      busy.set(w, id);
      w.postMessage({ type: 'expand', id, input: p.input, deadline: p.deadline });
    }
  };
  // A worker that stops: out of the pool, its node goes back first in the queue, to the others (or to this thread when
  // none is left). The expansions are the same whoever does them: the result does not change.
  const fail = (w: Worker, why: string) => {
    if (closing || dead.has(w)) return;
    dead.add(w);
    const left = live().length;
    reason = `${dead.size} worker(s) stopped (${why}): ${left ? `${left} went on` : 'this thread expanded the rest'}`;
    const i = idle.indexOf(w); if (i >= 0) idle.splice(i, 1);
    const id = busy.get(w); busy.delete(w);
    if (id !== undefined) queue.unshift(id);
    void w.terminate();
    dispatch();
  };
  for (const w of workers) {
    w.on('message', (m: { type: string; id: number; exp?: Expansion | null; message?: string; mobility?: boolean; ownership?: boolean }) => {
      if (m.type !== 'expanded' && m.type !== 'error') return;
      const p = pending.get(m.id); pending.delete(m.id); busy.delete(w);
      if (p) { if (m.type === 'error') p.reject(m.mobility ? mobilityError(m.message!) : m.ownership ? ownershipError(m.message!) : new Error(m.message)); else p.resolve(m.exp ?? null); }
      if (dead.has(w)) return;
      idle.push(w);
      dispatch();
    });
    w.on('error', (e) => fail(w, e.message));
    w.on('exit', (code) => fail(w, `exit ${code}`));
  }
  /** A worker's counts, or null when it does not answer within `ms` (it stopped meanwhile). */
  const ask = (w: Worker, ms: number) => new Promise<ExpandStats | null>((ok) => {
    const done = (s: ExpandStats | null) => { clearTimeout(t); w.off('message', on); w.off('exit', gone); ok(s); };
    const on = (m: { type: string; stats?: ExpandStats }) => { if (m.type === 'stats') done(m.stats!); };
    const gone = () => done(null);
    const t = setTimeout(() => done(null), ms);
    w.on('message', on); w.once('exit', gone);
    w.postMessage({ type: 'stats' });
  });
  return {
    size: n,
    get reason() { return reason; },
    expand(inputs, deadline) {
      const ps = inputs.map((input) => new Promise<Expansion | null>((resolve, reject) => {
        const id = seq++;
        pending.set(id, { resolve, reject, input, deadline });
        queue.push(id);
      }));
      dispatch();
      return Promise.all(ps);
    },
    async stats() {
      const all = await Promise.all(live().map((w) => ask(w, 2000)));
      const [first, ...rest] = all.filter((x): x is ExpandStats => !!x);
      if (!first) return null;
      for (const r of rest) mergeStats(first, r);
      return first;
    },
    async close() { closing = true; await Promise.all(workers.map((w) => w.terminate())); },
  };
}

// Loaded by a Node tool: `solve({ workers })` uses it from now on.
registerPool(openPool);
