// Proof workers (3.5, solve-pool.ts): the frontier expanded in batches by worker threads. The result depends on the
// batch, never on the number of workers: 1 (this thread), 2, 4 and 8 give the same verdict, states, softlocks and
// paths. A worker that cannot start leaves the work to this thread with a reason; the clock stops a search as
// `truncated`. The speed is measured in BENCH.md "3.5", not here.
import { describe, expect, it } from 'vitest';
import { solve, type SolveResult } from '@engine/tools/solve';
import { makeStressGame } from '@engine/tools/stress';
import '@engine/tools/solve-pool';

const sig = (r: SolveResult) => ({
  status: r.status, states: r.states, finished: r.finished, path: r.path, steps: r.steps.length, softlockCount: r.softlockCount,
  softlocks: r.softlocks, causes: r.softlockCauses, flags: r.flagsReached, rooms: r.roomsReached, broken: r.broken, deadEnds: r.deadEnds, errors: r.errors,
});

describe('proof workers', () => {
  for (const softlock of [false, true]) it(`1, 2, 4 and 8 workers: the same proof${softlock ? ', softlocks included' : ''}`, async () => {
    const g = makeStressGame({ rooms: 12, players: 2, items: 10, flags: 10, npcs: 1, scripts: 2, topics: 4, schemaVersion: 3, eras: true, softlock });
    const runs = [];
    for (const workers of [1, 2, 4, 8]) runs.push(await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 60000, workers, batch: 16 }));
    expect(runs[0].status).toBe(softlock ? 'softlocks' : 'solved');
    for (const r of runs.slice(1)) expect(sig(r)).toEqual(sig(runs[0]));
    expect(runs.map((r) => r.profile.workers?.workers)).toEqual([1, 2, 4, 8]);
    expect(runs.every((r) => !r.profile.workers?.reason)).toBe(true);
    // The one-at-a-time search reaches the same states and the same verdict (the batch only changes the order).
    const plain = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 60000 });
    expect([plain.status, plain.states, plain.softlockCount]).toEqual([runs[0].status, runs[0].states, runs[0].softlockCount]);
  }, 120000);

  it('a witness too, and a truncated search stops at the same place', async () => {
    const g = makeStressGame({ rooms: 12, players: 2, items: 10, flags: 10, npcs: 1, scripts: 2, topics: 4, schemaVersion: 3 });
    const w = await Promise.all([1, 4].map((workers) => solve(structuredClone(g.game), g.layouts, { workers, batch: 8 })));
    expect(w[0].finished).toBe(true);
    expect(sig(w[1])).toEqual(sig(w[0]));
    const t = await Promise.all([1, 4].map((workers) => solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 300, workers, batch: 8 })));
    expect(t[0].status).toBe('truncated');
    expect(sig(t[1])).toEqual(sig(t[0]));
  }, 120000);

  it('without the game module, custom commands keep the work in this thread, and say so', async () => {
    const g = makeStressGame({ rooms: 6, players: 1, items: 4, flags: 4, npcs: 0, scripts: 0, topics: 2, schemaVersion: 3 });
    const r = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', workers: 4, commands: { noop: { run: async () => {} } } as never });
    expect(r.profile.workers).toMatchObject({ workers: 1, reason: expect.stringContaining('game module') });
    const missing = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', workers: 2, gameModule: '/nowhere/index.ts', commands: { noop: { run: async () => {} } } as never });
    expect(missing.profile.workers?.reason).toContain('did not start');
    expect(sig(missing)).toEqual(sig(r));
    const por = await solve(structuredClone(g.game), g.layouts, { workers: 4, por: 'sleep' });
    expect(por.profile.workers?.reason).toContain('partial-order');
  }, 60000);

  for (const how of ['exit', 'throw'] as const) it(`a worker that stops mid-search (${how}) leaves the pool: the same proof, and the profile says so`, async () => {
    const g = makeStressGame({ rooms: 12, players: 2, items: 10, flags: 10, npcs: 1, scripts: 2, topics: 4, schemaVersion: 3, eras: true, softlock: true });
    const one = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 60000, workers: 1, batch: 16 });
    const t = Date.now();
    const crashed = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 60000, workers: 4, batch: 16, workerCrash: { worker: 1, after: 5, how } });
    expect(sig(crashed)).toEqual(sig(one));
    expect(crashed.profile.workers?.reason).toMatch(/1 worker\(s\) stopped .*3 went on/);
    // Every worker stops: this thread finishes the search.
    const all = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 60000, workers: 3, batch: 16, workerCrash: { worker: 'all', after: 2, how } });
    expect(sig(all)).toEqual(sig(one));
    expect(all.profile.workers?.reason).toMatch(/3 worker\(s\) stopped .*this thread expanded the rest/);
    expect(Date.now() - t).toBeLessThan(60000);
  }, 120000);

  it('the clock stops a search: truncated, and the profile says why', async () => {
    const g = makeStressGame({ rooms: 20, players: 2, items: 12, flags: 30, npcs: 1, scripts: 2, topics: 8, schemaVersion: 3 });
    const r = await solve(structuredClone(g.game), g.layouts, { mode: 'prove', maxStates: 200000, workers: 2, timeLimitMs: 400 });
    expect(r.status).toBe('truncated');
    expect(r.profile.stoppedBy).toBe('time');
    expect(r.headline).toContain('raise --time');
  }, 60000);
});
