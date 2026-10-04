// The audit of the proof's abstractions (`npm run solve -- --audit-abstractions`). The canonical character, the
// mobility regions and the no-op memo are exact only as long as the engine reports everything a run reads: that is
// checked on the differential corpus (tests/memo.test.ts, tests/canonical.test.ts, tests/audit.test.ts), not proved
// for every game. The audit makes the same check on one game: the proof with the abstractions, every memo hit run
// anyway and compared, against the explicit search with all of them off. Any difference is a failure; an explicit
// search too big for the budget leaves the verdicts unchecked, and the audit says so (it does not pass).
import type { CustomCommands } from '../core/custom';
import type { GameDef, Layout } from '../core/types';
import { solve, type SolveOptions, type SolveResult } from './solve';

export type AuditStatus = 'same' | 'diverged' | 'partial';

export interface AuditResult {
  /** `same`: the abstractions gave the explicit search's verdict, every memo hit identical. `diverged`: they did not.
   * `partial`: every memo hit identical, but the explicit search was truncated, so the verdicts were not compared. */
  status: AuditStatus;
  /** 0 same, 1 diverged, 2 partial (raise --max: nothing is proved about the verdicts). */
  exit: 0 | 1 | 2;
  headline: string;
  /** What differs, one line each. */
  divergences: string[];
  abstract: { status: string; states: number; softlockCount: number; memo: SolveResult['profile']['memo']; canonical: boolean; mobility: boolean };
  explicit: { status: string; states: number; softlockCount: number; truncated: boolean };
  ms: number;
}

type Solver = (game: GameDef, layouts: Record<string, Layout>, opts: SolveOptions) => Promise<SolveResult>;

/** What the abstractions must not change. States, paths and their labels may differ: they are what the abstractions fold. */
export function verdictOf(r: SolveResult) {
  return {
    status: r.status, finished: r.finished, broken: r.broken.map((b) => b.invariant).sort(), softlocks: r.softlockCount > 0,
    flagsReached: [...r.flagsReached].sort(), roomsReached: [...r.roomsReached].sort(), unlockedReached: [...r.unlockedReached].sort(),
  };
}

export async function auditAbstractions(game: GameDef, layouts: Record<string, Layout>, opts: { maxStates?: number; commands?: CustomCommands; solver?: Solver } = {}): Promise<AuditResult> {
  const t0 = Date.now();
  const run = opts.solver ?? solve;
  const base: SolveOptions = { mode: 'prove', maxStates: opts.maxStates ?? 20000, commands: opts.commands };
  const abs = await run(structuredClone(game), layouts, { ...base, memoVerify: 1 });
  const exp = await run(structuredClone(game), layouts, { ...base, memo: false, canonicalPlayers: false, mobility: false });
  const divergences: string[] = [];
  // A memo hit that differs is an engine error of the abstract run (solve never skips silently).
  // Errors are labelled by the path that met them, which the abstractions spell differently ("Switch to bob › Go to
  // room0 › Take spot"): compared by room and message.
  const bare = (e: string) => e.match(/\(([^()]+)\): (.*)$/s)?.slice(1).join(': ') ?? e;
  const expErrors = new Set(exp.errors.map(bare));
  for (const e of abs.errors) if (!expErrors.has(bare(e))) divergences.push(`abstract run: ${e}`);
  if (abs.profile.memo.verified !== abs.profile.memo.hits) divergences.push(`memo: ${abs.profile.memo.hits - abs.profile.memo.verified} hit(s) not checked`);
  const partial = exp.truncated && !divergences.length;
  if (!exp.truncated) {
    if (abs.truncated) divergences.push(`the abstract search was truncated at ${abs.states} states, the explicit one finished in ${exp.states}`);
    const a = verdictOf(abs), x = verdictOf(exp);
    for (const k of Object.keys(a) as (keyof typeof a)[]) if (JSON.stringify(a[k]) !== JSON.stringify(x[k])) divergences.push(`${k}: ${JSON.stringify(a[k])} with the abstractions, ${JSON.stringify(x[k])} without`);
  }
  const status: AuditStatus = divergences.length ? 'diverged' : partial ? 'partial' : 'same';
  const headline = status === 'same'
    ? `same: the abstractions give the explicit search's verdict (${abs.states} vs ${exp.states} states), ${abs.profile.memo.hits} memo hit(s) run anyway and identical`
    : status === 'partial'
      ? `partial: ${abs.profile.memo.hits} memo hit(s) run anyway and identical, but the explicit search stopped at ${exp.states} states, so the verdicts are not compared (raise --max)`
      : `diverged: ${divergences.length} difference(s) between the abstractions and the explicit search`;
  return {
    status, exit: status === 'same' ? 0 : status === 'partial' ? 2 : 1, headline, divergences,
    abstract: { status: abs.status, states: abs.states, softlockCount: abs.softlockCount, memo: abs.profile.memo, canonical: abs.profile.canonical.applied, mobility: abs.profile.mobility.applied },
    explicit: { status: exp.status, states: exp.states, softlockCount: exp.softlockCount, truncated: exp.truncated },
    ms: Date.now() - t0,
  };
}
