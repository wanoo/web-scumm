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
    const h = this.items;
    h.push({ v, score: this.scoreOf(v), seq: this.seq++ });
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

  pop(): T | undefined {
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
    return top.v;
  }
}
