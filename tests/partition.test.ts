// Partitioned workers (4.1.13, src/engine/tools/solve/search/partition.ts): a node goes to the worker its room hashes
// to, an idle worker steals, and the visited table is shared, so a state the search stored comes back without its
// engine state. None of it changes the result: 1, 2 and 4 workers give the same proof, and a worker's "already
// stored" that the search does not confirm (a hash collision) is expanded again here. The speed is in BENCH.md.
import { describe, expect, it } from 'vitest';
import { registerPool, solve, threadPool, type SolveResult } from '@engine/tools/solve';
import { SharedVisited, nextFor, ownerOf } from '@engine/tools/solve/search/partition';
import { stateHash } from '@engine/tools/solve/search/compact';
import { makeStressGame } from '@engine/tools/stress';
import '@engine/tools/solve-pool';
import { matrixGame } from './gen/random-game';

const sig = (r: SolveResult) => ({
  status: r.status,
  states: r.states,
  finished: r.finished,
  path: r.path,
  steps: r.steps.length,
  softlockCount: r.softlockCount,
  softlocks: r.softlocks,
  causes: r.softlockCauses,
  flags: r.flagsReached,
  rooms: r.roomsReached,
  broken: r.broken,
  deadEnds: r.deadEnds,
  errors: r.errors,
});

describe('the pieces', () => {
  it('the shared table: what the search added is found, the rest is not, and it stops at half full', () => {
    const t = new SharedVisited(10);
    const a = stateHash([['room', 'r1']]),
      b = stateHash([['room', 'r2']]);
    t.add(a);
    t.add(a);
    expect([t.has(a), t.has(b), t.added]).toEqual([true, false, 1]);
    // Another view of the same memory (a worker) sees it.
    expect(new SharedVisited(t.buf).has(a)).toBe(true);
    for (let k = 0; k < 5000; k++) t.add(stateHash([['flag:x', String(k)]]));
    expect(t.added).toBeLessThanOrEqual(t.buf.byteLength / 16);
    expect(t.has(stateHash([['flag:x', '0']]))).toBe(true);
    expect(t.has([0, 0])).toBe(false);
  });

  it("a node goes to its room's worker; an idle worker takes its own first, then steals the longest queue", () => {
    expect(ownerOf([['room', 'r1']], 4)).toBe(
      ownerOf(
        [
          ['room', 'r1'],
          ['flag:x', '1'],
        ],
        4,
      ),
    );
    const qs = [[1, 2], [], [3, 4, 5]];
    expect(nextFor(0, qs)).toBe(1);
    expect(nextFor(1, qs)).toBe(5);
    expect(nextFor(1, qs)).toBe(4);
    expect(qs).toEqual([[2], [], [3]]);
    expect(nextFor(1, [[], [], []])).toBeUndefined();
  });
});

describe('partitioned workers', () => {
  it('1, 2 and 4 workers with the shared table: the same proof, softlocks included; states come back without their engine state', async () => {
    for (const g of [
      matrixGame(12, { characters: 3, rooms: [20, 40] }),
      makeStressGame({
        rooms: 10,
        players: 2,
        items: 8,
        flags: 8,
        npcs: 1,
        scripts: 2,
        topics: 4,
        schemaVersion: 3,
        eras: true,
        softlock: true,
      }),
    ]) {
      const runs: SolveResult[] = [];
      for (const workers of [1, 2, 4])
        runs.push(
          await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 60000, workers, batch: 16 }),
        );
      for (const r of runs.slice(1)) expect(sig(r)).toEqual(sig(runs[0]!));
      expect(runs[0]!.status).toBe('softlocks');
      expect(runs[2]!.profile.shared).toMatchObject({ applied: true, collisions: 0 });
      expect(runs[2]!.profile.shared!.known).toBeGreaterThan(0);
      // Without the table: the same again.
      const off = await solve(structuredClone(g.game), g.layouts, {
        mode: 'prove',
        maxStates: 60000,
        workers: 2,
        batch: 16,
        sharedVisited: false,
      });
      expect(sig(off)).toEqual(sig(runs[0]!));
      expect(off.profile.shared?.applied).toBe(false);
    }
  }, 600_000);

  // Last in the file: it replaces the worker pool with one that says "already stored" of every state.
  it('a worker\'s "already stored" the search does not confirm is expanded again here: the same proof', async () => {
    const g = matrixGame(16, { characters: 3, rooms: [20, 40] });
    const plain = await solve(structuredClone(g.game), g.layouts, {
      mode: 'prove',
      maxStates: 20000,
      workers: 1,
      batch: 8,
    });
    registerPool(async (_w, _g, _l, _o, X) => {
      const t = threadPool(X);
      return {
        ...t,
        async expand(inputs, deadline) {
          const out = await t.expand(inputs, deadline);
          for (const e of out)
            for (const r of e?.records ?? [])
              if (!r.noop && r.state) {
                r.state = undefined;
                r.tailSteps = undefined;
                r.known = true;
              }
          return out;
        },
      };
    });
    const lied = await solve(structuredClone(g.game), g.layouts, {
      mode: 'prove',
      maxStates: 20000,
      workers: 2,
      batch: 8,
    });
    expect(sig(lied)).toEqual(sig(plain));
    expect(lied.profile.shared?.collisions).toBeGreaterThan(0);
  }, 300_000);
});
