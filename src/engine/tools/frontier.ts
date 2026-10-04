// The solver's frontier: the states still to expand, best first. A binary heap ordered by score (highest first) then
// by arrival (first in, first out among equal scores): exactly the order of the sorted list it replaces, so witnesses
// and printed paths do not change, in O(log n) per push and pop instead of O(n).

export class Frontier<T> {
  private items: { v: T; score: number; seq: number }[] = [];
  private seq = 0;
  constructor(private scoreOf: (v: T) => number) {}

  get size(): number { return this.items.length; }

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
      if (!this.before(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  pop(): T | undefined {
    const h = this.items;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && this.before(h[l], h[m])) m = l;
        if (r < h.length && this.before(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top.v;
  }
}
