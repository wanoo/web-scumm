// Proof workers (3.5): the search's frontier expanded by worker threads. The search takes a batch of nodes from its
// frontier (best first), each node goes to whichever worker is free, and the expansions come back to be merged in the
// batch's order (solve.ts `merge`): what is found depends on the batch size, never on how many workers expanded it,
// so 1, 2, 4 or 8 workers give the same result (tests/workers.test.ts). One worker is the same search in this thread.
// A worker that cannot start, or stops, leaves its nodes to this thread: the result stays the same, only slower
// (`profile.workers.reason`). Measured in BENCH.md "3.5": workers stay off unless asked for (`--workers=N`). A Node
// tool imports this file to have them (solve.ts does not: the browser bundles the solver without worker threads).
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import type { GameDef, Layout } from '../core/types';
import { mergeStats, mobilityError, registerPool, threadPool, type Expansion, type ExpandStats, type NodeInput, type SolveOptions, type makeExpander } from './solve';

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
  const { mode, goal, canonicalPlayers, mobility, memo, memoVerify, por, unsafeReduction } = opts;
  return { mode, goal, canonicalPlayers, mobility, memo, memoVerify, por, unsafeReduction };
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
      const w = new Worker(new URL('./solve-worker.mjs', import.meta.url), { workerData: { ...data, opts: workerOpts(opts), module: opts.gameModule } });
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
  let broken = false;
  let seq = 0;
  const pending = new Map<number, { resolve: (e: Expansion | null) => void; reject: (e: Error) => void; input: NodeInput; deadline: number }>();
  const idle: Worker[] = [...workers];
  const queue: number[] = [];
  const busy = new Map<Worker, number>();
  const dispatch = () => {
    while (idle.length && queue.length) {
      const id = queue.shift()!, w = idle.shift()!, p = pending.get(id)!;
      busy.set(w, id);
      w.postMessage({ type: 'expand', id, input: p.input, deadline: p.deadline });
    }
  };
  // A worker that stops: its node and the rest are expanded here (the same records: the result does not change).
  const fail = (w: Worker, why: string) => {
    if (!broken) { broken = true; reason = `a worker stopped (${why}): this thread expanded the rest`; }
    const id = busy.get(w); busy.delete(w);
    const ids = [...(id !== undefined ? [id] : []), ...queue.splice(0)];
    for (const k of ids) { const p = pending.get(k)!; pending.delete(k); X.expandNode(p.input).then(p.resolve, p.reject); }
  };
  for (const w of workers) {
    w.on('message', (m: { type: string; id: number; exp?: Expansion | null; message?: string; mobility?: boolean }) => {
      if (m.type !== 'expanded' && m.type !== 'error') return;
      const p = pending.get(m.id); pending.delete(m.id); busy.delete(w);
      if (p) { if (m.type === 'error') p.reject(m.mobility ? mobilityError(m.message!) : new Error(m.message)); else p.resolve(m.exp ?? null); }
      idle.push(w); if (broken) { fail(w, 'stopped'); return; }
      dispatch();
    });
    w.on('error', (e) => fail(w, e.message));
  }
  return {
    size: n,
    get reason() { return reason; },
    expand(inputs, deadline) {
      const ps = inputs.map((input) => new Promise<Expansion | null>((resolve, reject) => {
        const id = seq++;
        pending.set(id, { resolve, reject, input, deadline });
        if (broken) { pending.delete(id); X.expandNode(input).then(resolve, reject); return; }
        queue.push(id);
      }));
      dispatch();
      return Promise.all(ps);
    },
    async stats() {
      const all = await Promise.all(workers.map((w) => new Promise<ExpandStats | null>((ok) => {
        const on = (m: { type: string; stats?: ExpandStats }) => { if (m.type === 'stats') { w.off('message', on); ok(m.stats!); } };
        w.on('message', on);
        w.once('error', () => ok(null));
        w.postMessage({ type: 'stats' });
      })));
      const [first, ...rest] = all.filter((x): x is ExpandStats => !!x);
      if (!first) return null;
      for (const r of rest) mergeStats(first, r);
      return first;
    },
    async close() { await Promise.all(workers.map((w) => w.terminate())); },
  };
}

// Loaded by a Node tool: `solve({ workers })` uses it from now on.
registerPool(openPool);
