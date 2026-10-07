// The workers' side of a large proof (4.1.13): a visited table the search shares with its worker threads, and the
// partition of a batch between them. Neither changes what the search finds; both are measured in BENCH.md.
// - The shared table holds the 64-bit hash (compact.ts `stateHash`) of every state the search has stored. A worker
//   that reaches one of them sends the record back without its engine state and steps (`known`): the search would
//   have counted it as a known state anyway. The search alone writes the table; its exact keys stay the authority:
//   a `known` record whose key the store does not have (two states with one hash) is expanded again in the search's
//   thread, so a collision costs time, never a state.
// - The partition: each node of a batch goes first to the worker its room hashes to (the same rooms meet the same
//   no-op memo), and an idle worker steals from the longest queue of the others. The merge stays in the batch's order,
//   so the result is the same for 1, 2 or 4 workers (tests/partition.test.ts).
import type { Dims } from '../abstractions';
import { fnv64, stateHash } from './compact';

/** Open addressing on pairs of Int32 (high, low), (0, 0) empty; one writer (the search), any number of readers. */
export class SharedVisited {
  readonly buf: SharedArrayBuffer;
  private t: Int32Array;
  /** Slots (a power of two); the table stops taking hashes at half full (then workers send every state). */
  private cap: number;
  added = 0;

  constructor(from: SharedArrayBuffer | number) {
    if (typeof from === 'number') {
      let cap = 1024;
      while (cap < from * 2 && cap < 1 << 24) cap *= 2;
      this.buf = new SharedArrayBuffer(cap * 8);
    } else this.buf = from;
    this.t = new Int32Array(this.buf);
    this.cap = this.t.length / 2;
  }

  private slot(h: [number, number]): number {
    return (h[1] ^ Math.imul(h[0], 0x9e3779b1)) & (this.cap - 1);
  }

  /** The search, for every state it stores. */
  add(h: [number, number]) {
    if (this.added * 2 >= this.cap) return;
    const hi = h[0] | 0,
      lo = h[1] | 0 || 1; // (0, 0) means empty: a low half of 0 is stored as 1 (a hash, not a key)
    for (let s = this.slot(h); ; s = (s + 1) & (this.cap - 1)) {
      const a = Atomics.load(this.t, 2 * s),
        b = Atomics.load(this.t, 2 * s + 1);
      if (a === hi && b === lo) return;
      if (a === 0 && b === 0) {
        Atomics.store(this.t, 2 * s, hi);
        Atomics.store(this.t, 2 * s + 1, lo);
        this.added++;
        return;
      }
    }
  }

  /** A worker: has the search stored a state with this hash? (A yes is checked by the search: see `known`.) */
  has(h: [number, number]): boolean {
    const hi = h[0] | 0,
      lo = h[1] | 0 || 1;
    for (let s = this.slot(h), k = 0; k < this.cap; s = (s + 1) & (this.cap - 1), k++) {
      const a = Atomics.load(this.t, 2 * s),
        b = Atomics.load(this.t, 2 * s + 1);
      if (a === hi && b === lo) return true;
      if (a === 0 && b === 0) return false;
    }
    return false;
  }

  hasDims(d: Dims): boolean {
    return this.has(stateHash(d));
  }
}

/** The worker a node goes to first: its room's hash, modulo the workers. */
export function ownerOf(d: Dims, workers: number): number {
  const room = d.find(([k]) => k === 'room' || k.startsWith('pos:'))?.[1] ?? '';
  return fnv64(room)[1] % workers;
}

/**
 * The next node for worker `w`: the first of its own queue, or the last of the longest other queue (work stealing).
 * Returns the node's id and removes it, or undefined when every queue is empty.
 */
export function nextFor(w: number, queues: number[][]): number | undefined {
  const own = queues[w];
  if (own?.length) return own.shift();
  let best = -1,
    len = 0;
  queues.forEach((q, i) => {
    if (i !== w && q.length > len) {
      best = i;
      len = q.length;
    }
  });
  return best < 0 ? undefined : queues[best]?.pop();
}
