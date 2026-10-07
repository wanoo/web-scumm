// Checkpoint and resume on a matrix instance (4.1.13, heavy: `npm run test:heavy`, nightly): c12, three characters
// and softlocks, stopped at 30 % and taken up again, gives the proof that never stopped. The cheap cases are
// tests/checkpoint.test.ts.
import { describe, expect, it } from 'vitest';
import { solve, type SolveOptions, type SolveResult } from '@engine/tools/solve';
import { snapshotHeader } from '@engine/tools/solve/search/checkpoint';
import { matrixGame } from './gen/random-game';

const sig = (r: SolveResult) => ({
  status: r.status,
  states: r.states,
  path: r.path,
  steps: r.steps,
  softlockCount: r.softlockCount,
  softlocks: r.softlocks,
  causes: r.softlockCauses,
  flags: r.flagsReached,
  rooms: r.roomsReached,
  deadEnds: r.deadEnds,
});

describe('checkpoint and resume on the matrix', () => {
  it('matrix c12 (softlocks): stopped at 30 %, taken up again, the same proof', async () => {
    const g = matrixGame(12, { characters: 3, rooms: [20, 40] });
    const o: SolveOptions = { mode: 'prove', maxStates: 50000 };
    const whole = await solve(structuredClone(g.game), g.layouts, o);
    expect(whole.status).toBe('softlocks');
    let text: string | null = null;
    const stop = new Error('stopped');
    try {
      await solve(structuredClone(g.game), g.layouts, {
        ...o,
        checkpoint: { save: (t) => (text = t), everyExpansions: 50 },
        onProgress: (p) => {
          if (p.states >= whole.states * 0.3) throw stop;
        },
      });
    } catch (e) {
      if (e !== stop) throw e;
    }
    const h = snapshotHeader(text!)!;
    expect(h.states).toBeLessThan(whole.states * 0.5);
    const resumed = await solve(structuredClone(g.game), g.layouts, {
      ...o,
      checkpoint: { save: () => {}, resume: text },
    });
    expect(resumed.profile.checkpoint?.resumedAt?.states).toBe(h.states);
    expect(sig(resumed)).toEqual(sig(whole));
  }, 900_000);
});
