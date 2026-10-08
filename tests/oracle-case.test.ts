// The oracle's diagnostic (4.1.17, plan §5.1): the fixture keeps digests, so a moved digest says nothing of why.
// `tools/oracle-case.ts --diff` names the fields, the first session entry, the flags and the reachable states that differ.
import { describe, expect, it } from 'vitest';
import { diffCases } from '../tools/oracle-case';

const base = {
  case: 'reference proof',
  commit: 'a'.repeat(40),
  engine: '4.1.8',
  node: 'v22.14.0',
  opts: { mode: 'prove', maxStates: 20000 },
  signature: { status: 'solved', states: 288, steps: '77d8', flags: 'c9d2' },
  steps: [{ act: { verb: 'talk', a: 'neighbor' }, picks: [1, 2] }],
  path: [],
  flagsReached: ['a', 'b'],
  roomsReached: ['hall'],
  reachable: ['s1', 's2'],
};

describe('oracle-case --diff', () => {
  it('says nothing when the digests agree', () => {
    expect(diffCases(base, { ...base, commit: 'b'.repeat(40), engine: '4.1.16' })).toEqual([]);
  });

  it('names the fields, the first entry, the flags and the reachable set', () => {
    const after = {
      ...base,
      commit: 'b'.repeat(40),
      engine: '4.1.16',
      signature: { ...base.signature, steps: 'a3ff', flags: '2244' },
      steps: [{ act: { verb: 'talk', a: 'neighbor' }, picks: [2, 3] }],
      flagsReached: ['a', 'b', 'password_ok'],
    };
    const out = diffCases(base, after);
    expect(out).toContain('fields that differ: steps, flags');
    expect(out).toContain('first session entry that differs: #0 of 1 → 1');
    expect(out).toContain('flags added: password_ok');
    expect(out).toContain('reachable: the same 2 states');
    const moved = diffCases(base, { ...after, flagsReached: ['b', 'a'], reachable: ['s1', 's3'], steps: base.steps });
    expect(moved).toContain('flags reordered');
    expect(moved).toContain('reachable: 2 → 2 states; first that differs: s2 → s3');
    expect(diffCases(base, { ...after, reachable: ['s1', 's2', 's4'] })).toContain(
      'reachable: 2 → 3 states; first that differs: — → s4',
    );
    expect(diffCases(base, { ...base, opts: { mode: 'witness' } })[2]).toMatch(/^options: /);
  });
});
