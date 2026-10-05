// A proof worker (3.5, solve-pool.ts): builds the same expander as the search (`makeExpander`: the game sent as data,
// its custom commands from its module) and expands the nodes it is given, one at a time, in the order they come.
// Nothing here knows the search: no `seen`, no frontier. Started by solve-worker.mjs (tsx).
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { isMobilityError, isOwnershipError, makeExpander, type NodeInput } from './solve';

const init = workerData as { game: unknown; layouts: Record<string, unknown>; opts: Record<string, unknown>; module?: string };
let X: ReturnType<typeof makeExpander>;
try {
  const commands = init.module ? (await import(pathToFileURL(init.module).href)).commands : undefined;
  X = makeExpander(init.game as never, init.layouts as never, { ...init.opts, ...(commands ? { commands } : {}) });
  parentPort!.postMessage({ type: 'ready' });
} catch (e) {
  parentPort!.postMessage({ type: 'failed', message: (e as Error).message });
}

parentPort!.on('message', async (m: { type: 'expand'; id: number; input: NodeInput; deadline: number } | { type: 'stats' }) => {
  if (m.type === 'stats') { parentPort!.postMessage({ type: 'stats', stats: X.stats }); return; }
  if (Date.now() > m.deadline) { parentPort!.postMessage({ type: 'expanded', id: m.id, exp: null }); return; }
  try { parentPort!.postMessage({ type: 'expanded', id: m.id, exp: await X.expandNode(m.input) }); }
  catch (e) { parentPort!.postMessage({ type: 'error', id: m.id, message: (e as Error).message, mobility: isMobilityError(e), ownership: isOwnershipError(e) }); }
});
