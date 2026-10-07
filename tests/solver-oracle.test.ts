// The differential oracle of the compact representation (4.1.13, ADR 0015): on the sample game, the reference game
// and 200 generated games, today's search gives exactly what the 4.1.8 implementation gave (the fixture): the same
// verdict, the same path and session entries, the same softlocks and causes, and the same reachable set, state for
// state. `ORACLE_WRITE=1` writes the fixture again: only for a change that means to alter what the solver finds, said
// in the LOG.
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { solve, type SolveOptions } from '@engine/tools/solve';
import { oracleCases, signature } from './gen/oracle';

const FIXTURE = 'tests/fixtures/solver-oracle.json';
const write = process.env.ORACLE_WRITE === '1';

async function run(extra: SolveOptions) {
  const out: Record<string, ReturnType<typeof signature>> = {};
  for (const c of oracleCases())
    out[c.id] = signature(
      await solve(structuredClone(c.game), c.layouts, { ...c.opts, ...extra, keepReachable: true }),
    );
  return out;
}

describe('the solver against the 4.1.8 oracle', () => {
  it('203 searches: the same verdicts, paths, softlocks and reachable sets', async () => {
    const now = await run({});
    if (write) writeFileSync(FIXTURE, JSON.stringify(now, null, 1) + '\n');
    const before = JSON.parse(readFileSync(FIXTURE, 'utf8')) as typeof now;
    expect(Object.keys(now).length).toBe(203);
    const diff = Object.keys(before).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(before[k]));
    expect(diff).toEqual([]);
  }, 900_000);
});
