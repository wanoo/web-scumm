import { describe, expect, it } from 'vitest';
import { Frontier } from '@engine/tools/frontier';

describe('the solver frontier', () => {
  it('pops in the order of the sorted list it replaces: highest score first, first in first out among equals', () => {
    // the old enqueue: insert after every item whose score is >= the new one, pop from the front
    const old: { s: number; id: number }[] = [];
    const oldPush = (x: { s: number; id: number }) => {
      let i = old.length;
      while (i > 0 && old[i - 1].s < x.s) i--;
      old.splice(i, 0, x);
    };
    const f = new Frontier<{ s: number; id: number }>((x) => x.s);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const outOld: number[] = [],
      outNew: number[] = [];
    for (let k = 0; k < 2000; k++) {
      if (rnd() < 0.6 || !old.length) {
        const x = { s: Math.floor(rnd() * 8), id: k };
        oldPush(x);
        f.push(x);
      } else {
        outOld.push(old.shift()!.id);
        outNew.push(f.pop()!.id);
      }
    }
    while (old.length) {
      outOld.push(old.shift()!.id);
      outNew.push(f.pop()!.id);
    }
    expect(outNew).toEqual(outOld);
    expect(f.size).toBe(0);
    expect(f.pop()).toBeUndefined();
  });
});
