// Pure helpers of the e2e scripts, tested in tests/tooling.test.ts.

/**
 * Whether a `npm run solve -- --json` run can be replayed as a proof that the game is finishable: the child exited 0
 * (solved, nothing broken), its result says `solved` and `finished`, and it has steps. Anything else is a reason
 * to fail the e2e, never to "replay the best path anyway".
 */
export function solverResultOk(r, exitStatus) {
  if (exitStatus !== 0)
    return {
      ok: false,
      reason: `npm run solve -- --json exited ${exitStatus ?? 'without a status'} (${r?.status ?? 'no result'})`,
    };
  if (!r || typeof r !== 'object') return { ok: false, reason: 'npm run solve -- --json produced no result' };
  if (r.status !== 'solved')
    return {
      ok: false,
      reason: `the solver's status is "${r.status}"${r.truncated ? ' (search truncated: raise --max)' : ''}`,
    };
  if (!r.finished) return { ok: false, reason: 'the solver did not reach an ending from a new game' };
  if (!Array.isArray(r.steps) || !r.steps.length)
    return { ok: false, reason: 'the solver returned no steps to replay' };
  return { ok: true, reason: '' };
}
