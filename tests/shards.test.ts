// The nightly's shards (3.7.1): every seed asked for runs once, none past the total; the merge catches a gap or an overlap.
import { describe, expect, it } from 'vitest';
import { shardProblems, shardRange } from '../src/engine/tools/shards';

describe('the corpus in shards', () => {
  it('splits any total into four ranges that cover it exactly', () => {
    for (const total of [1, 3, 4, 500, 501, 502, 503, 1500]) {
      const shards = [0, 1, 2, 3].map((i) => shardRange(total, i, 4));
      expect(shards.reduce((n, s) => n + s.seeds, 0)).toBe(total);
      expect(shardProblems(shards, total)).toEqual([]);
    }
    expect(shardRange(501, 3, 4)).toEqual({ from: 376, seeds: 126 });
  });

  it('a merge sees a missing shard, an overlap and seeds past the total', () => {
    expect(
      shardProblems(
        [
          { from: 1, seeds: 100 },
          { from: 201, seeds: 100 },
        ],
        300,
      ),
    ).toEqual(['seeds 101–200: no shard ran them']);
    expect(
      shardProblems(
        [
          { from: 1, seeds: 100 },
          { from: 90, seeds: 211 },
        ],
        300,
      ),
    ).toEqual(['seeds 90–100: run by more than one shard']);
    expect(
      shardProblems(
        [
          { from: 1, seeds: 126 },
          { from: 127, seeds: 126 },
          { from: 253, seeds: 126 },
          { from: 379, seeds: 126 },
        ],
        501,
      ),
    ).toEqual(['seeds 502–504: past the 501 asked for']);
    expect(shardProblems([{ from: 1, seeds: 50 }], 100)).toEqual(['seeds 51–100: no shard ran them']);
  });
});
