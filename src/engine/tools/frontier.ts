// The solver's frontier: the states still to expand, best first. A binary heap ordered by score (highest first) then
// by arrival (first in, first out among equal scores): exactly the order of the sorted list it replaces, so witnesses
// and printed paths do not change, in O(log n) per push and pop instead of O(n).

import { must } from '../core/must';

export class Frontier<T> {
  private items: { v: T; score: number; seq: number }[] = [];
  private seq = 0;
  constructor(private scoreOf: (v: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  /** `a` comes out before `b`. */
  private before(a: { score: number; seq: number }, b: { score: number; seq: number }) {
    return a.score > b.score || (a.score === b.score && a.seq < b.seq);
  }

  push(v: T): void {
    this.pushEntry({ v, score: this.scoreOf(v), seq: this.seq++ });
  }

  /**
   * Puts back what `popEntry` took, in its place (4.1.13: a batch cut short by a budget goes back to the frontier, so
   * the checkpoint written then holds every state still to expand, in the same order).
   */
  pushEntry(e: { v: T; score: number; seq: number }): void {
    const h = this.items;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const a = must(h[i], 'heap item'),
        b = must(h[p], 'heap parent');
      if (!this.before(a, b)) break;
      h[i] = b;
      h[p] = a;
      i = p;
    }
  }

  /** The heap as it is, each value mapped (a checkpoint, 4.1.13): `restore` gives back the same order of pops. */
  snapshot<U>(map: (v: T) => U): { items: { v: U; score: number; seq: number }[]; seq: number } {
    return { items: this.items.map((x) => ({ v: map(x.v), score: x.score, seq: x.seq })), seq: this.seq };
  }

  static restore<T, U>(
    scoreOf: (v: T) => number,
    snap: { items: { v: U; score: number; seq: number }[]; seq: number },
    map: (u: U) => T,
  ): Frontier<T> {
    const f = new Frontier<T>(scoreOf);
    f.items = snap.items.map((x) => ({ v: map(x.v), score: x.score, seq: x.seq }));
    f.seq = snap.seq;
    return f;
  }

  pop(): T | undefined {
    return this.popEntry()?.v;
  }

  popEntry(): { v: T; score: number; seq: number } | undefined {
    const h = this.items;
    if (!h.length) return undefined;
    const top = must(h[0], 'heap top');
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < h.length && this.before(must(h[l], 'heap left'), must(h[m], 'heap item'))) m = l;
        if (r < h.length && this.before(must(h[r], 'heap right'), must(h[m], 'heap item'))) m = r;
        if (m === i) break;
        const a = must(h[i], 'heap item'),
          b = must(h[m], 'heap child');
        h[i] = b;
        h[m] = a;
        i = m;
      }
    }
    return top;
  }
}
