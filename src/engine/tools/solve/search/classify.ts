// The verdict of a proof over the stored states (moved out of search.ts in 4.1.13): a state is safe when a goal is
// reachable from it, found by walking the transitions backwards from the goals (cycles included, which the old
// `progressed` test could not see); the unsafe ones are the softlocks, grouped by the step that lost the game.
import type { Id } from '../../../core/types';
import type { SolveResult } from '../report';
import type { StateStore } from './compact';

/**
 * `reverse`: walk back from the goals (a proof that finished with a goal); `judged`: the unsafe states count (a proof
 * that finished and found the ending). The samples are the shortest found, in the order the states were stored.
 */
export function classify(
  store: StateStore,
  seenOrder: number[],
  reverse: boolean,
  judged: boolean,
): { unsafe: number[]; softlocks: SolveResult['softlocks']; softlockCauses: SolveResult['softlockCauses'] } {
  // In proof mode, a state is safe iff a goal is reachable from it. Reverse reachability classifies cycles as well as
  // immediate dead ends, which the old `progressed` test could not do.
  const n = store.size;
  const canReach = new Uint8Array(n);
  const reaches = (i: number) => canReach[i] === 1;
  if (reverse) {
    // The reverse edges as columns: the sources of each target, by target.
    const from = store.edgeFrom.slice(),
      to = store.edgeTo.slice();
    const first = new Int32Array(n + 1);
    for (const t of to) first[t + 1]!++;
    for (let k = 0; k < n; k++) first[k + 1]! += first[k]!;
    const fill = first.slice(0, n),
      srcs = new Int32Array(to.length);
    to.forEach((t, k) => {
      srcs[fill[t]!++] = from[k]!;
    });
    const todo = [...store.goals];
    while (todo.length) {
      const h = todo.pop()!;
      if (canReach[h]) continue;
      canReach[h] = 1;
      for (let k = first[h]!; k < first[h + 1]!; k++) todo.push(srcs[k]!);
    }
  }
  const unsafe = judged ? seenOrder.filter((i) => !reaches(i)) : [];
  const softlocks = [...unsafe]
    .sort((a, b) => store.lenOf(a) - store.lenOf(b))
    .slice(0, 20)
    .map((i) => ({ path: store.path(i), ...store.placeOf(i) }));
  // The step that lost the game: walk each unsafe state up to the first unsafe one whose parent is safe (or the start).
  const causes = new Map<string, { action: string; room: Id; count: number; len: number; node: number }>();
  for (const i of unsafe) {
    let cur = i;
    while (store.parentOf(cur) >= 0 && !reaches(store.parentOf(cur))) cur = store.parentOf(cur);
    const action = store.viaOf(cur) ?? '(start)';
    const p = store.parentOf(cur);
    const room = store.placeOf(p >= 0 ? p : cur).room;
    const key = `${room}\u0000${action}`;
    const c = causes.get(key);
    const len = store.lenOf(cur);
    if (c) {
      c.count++;
      if (len < c.len) {
        c.len = len;
        c.node = cur;
      }
    } else causes.set(key, { action, room, count: 1, len, node: cur });
  }
  const softlockCauses = [...causes.values()]
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .map(({ action, room, count, node }) => ({
      action,
      room,
      count,
      sample: store.path(node),
      steps: store.steps(node),
    }));
  return { unsafe, softlocks, softlockCauses };
}
