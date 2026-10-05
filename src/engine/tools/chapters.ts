// The proof of a long game, chapter by chapter: each checkpoint that declares `goals` closes a chapter. In proof
// mode the search of a chapter returns every reachable state where its goals hold (its boundary); the next chapter
// is proved from each boundary state that differs for it (projected on what that chapter reads), not from the one
// hand-written checkpoint. The checkpoint itself must be one of those boundary states, else the content and the
// checkpoint disagree. Sound when a chapter reads nothing but what the projection keeps, which is how the projection
// is built (the state keys of that chapter's search).
import { chaptersHeadline, exitOf, worstStatus, type ExitCode, type ProofStatus } from './status';
import type { CustomCommands } from '../core/custom';
import { Engine } from '../core/engine';
import { FakePresenter, MemoryStore } from '../core/ports';
import type { GameDef, GameState, Id, Layout } from '../core/types';
import { projectState, solve, type SolveOptions, type SolveResult } from './solve';

export interface ChapterProof {
  /** The checkpoint that closes the chapter, or `ending`. */
  id: Id | 'ending';
  /** Boundary states the chapter was proved from (`1` for the first one: a new game), and how many were distinct for it. */
  from: number;
  distinct: number;
  /** The worst status over the starts: `solved` only when every start proves. */
  status: SolveResult['status'];
  states: number;
  softlockCount: number;
  ms: number;
  /** The hand-written checkpoint is not among the reachable boundary states of this chapter. */
  checkpointUnreachable?: boolean;
  /** Then: what differs between the checkpoint and the closest reachable boundary state (`dim: checkpoint vs boundary`). */
  checkpointDiff?: string[];
  /** Boundary states this chapter produced, deduped by the next chapter's projection (what `proveChapters` starts it from). */
  boundaries: number;
  results: SolveResult[];
}

export interface ChaptersProof {
  /** The searches' worst status, and `checkpoint_mismatch` when they all solved but a checkpoint is no reachable state. */
  status: ProofStatus;
  /** The status as an exit code and a sentence (`src/engine/tools/status.ts`). */
  exit: ExitCode;
  headline: string;
  chapters: ChapterProof[];
  ms: number;
}

/**
 * The one exit code of a proof by chapters, for the text output, `--json`, the Studio and the MCP tool alike:
 * 0 every chapter solved and every checkpoint reachable, 2 truncated, 1 anything else (softlocks, unsolved, error,
 * a checkpoint no boundary state matches).
 */
export const chaptersExitCode = (p: Pick<ChaptersProof, 'status'>) => exitOf(p.status);

const worst = worstStatus;

/** The state a hand-written checkpoint stands for. */
async function checkpointState(
  game: GameDef,
  layouts: Record<string, Layout>,
  id: Id,
  commands?: CustomCommands,
): Promise<GameState> {
  const e = new Engine(structuredClone(game), layouts, new FakePresenter(), new MemoryStore(), { commands });
  await e.checkpoint(id);
  return structuredClone(e.state);
}

/** Default cap on the boundary states a chapter is proved from: past it, the chapter is `truncated` (never green). */
export const MAX_STARTS = 1000;

export async function proveChapters(
  game: GameDef,
  layouts: Record<string, Layout>,
  opts: Pick<
    SolveOptions,
    | 'maxStates'
    | 'commands'
    | 'por'
    | 'unsafeReduction'
    | 'workers'
    | 'batch'
    | 'gameModule'
    | 'timeLimitMs'
    | 'ownership'
  > & {
    mode?: 'witness' | 'prove';
    maxStarts?: number;
    budget?: number /** The search to run (the tools pass the persistent proof cache's). */;
    solver?: typeof solve;
  } = {},
): Promise<ChaptersProof> {
  const run1 = opts.solver ?? solve;
  const maxStarts = opts.maxStarts ?? MAX_STARTS;
  // The whole proof's state budget, every chapter and every start together: past it, the proof is `truncated`.
  const budget = opts.budget ?? (opts.maxStates ?? 20000) * 10;
  let spent = 0;
  const t0 = Date.now();
  const mode = opts.mode ?? 'prove';
  const cps = Object.entries(game.checkpoints ?? {}).filter(([, c]) => c.goals?.length);
  const chapters: ChapterProof[] = [];
  let status: SolveResult['status'] = 'solved';
  // The starts of the current chapter: `new`, or the previous chapter's boundary states.
  let starts: ({ state: GameState } | 'new')[] = ['new'];
  const run = async (
    id: ChapterProof['id'],
    goal: SolveOptions['goal'],
    nextGoal: SolveOptions['goal'] | undefined,
    cpId?: Id,
  ) => {
    const t = Date.now();
    const results: SolveResult[] = [];
    let st: SolveResult['status'] = 'solved';
    const nextBoundaries = new Map<string, GameState>();
    if (starts.length > maxStarts) {
      // Too many distinct ways into this chapter to prove each one within the budget: say so, prove nothing more.
      chapters.push({
        id,
        from: starts.length,
        distinct: starts.length,
        status: 'truncated',
        states: 0,
        softlockCount: 0,
        ms: Date.now() - t,
        boundaries: 0,
        results,
      });
      status = worst(status, 'truncated');
      starts = [];
      return;
    }
    // One search from every boundary state at once, sharing its seen states (a state is safe or not whichever start
    // reached it): the chapter costs the union of what the starts reach, not the sum.
    const groups: ({ state: GameState } | 'new' | { states: GameState[] })[] =
      mode === 'prove' && starts.length > 1 && starts.every((x) => x !== 'new')
        ? [{ states: (starts as { state: GameState }[]).map((x) => x.state) }]
        : starts;
    for (const start of groups) {
      if (spent >= budget) {
        st = worst(st, 'truncated');
        break;
      }
      const r = await run1(game, layouts, {
        maxStates: Math.min(
          (opts.maxStates ?? 20000) * Math.max(1, typeof start === 'object' && 'states' in start ? 10 : 1),
          budget - spent,
        ),
        start,
        goal,
        commands: opts.commands,
        por: opts.por,
        unsafeReduction: opts.unsafeReduction,
        mode,
        ...(opts.workers !== undefined
          ? { workers: opts.workers, batch: opts.batch, gameModule: opts.gameModule }
          : {}),
        ...(opts.ownership === false ? { ownership: false } : {}),
        ...(opts.timeLimitMs ? { timeLimitMs: Math.max(1, opts.timeLimitMs - (Date.now() - t0)) } : {}),
      });
      spent += r.states;
      results.push(r);
      st = worst(st, r.status);
      if (mode === 'prove')
        for (const b of r.boundaries) {
          const k = projectState(game, layouts, b, { commands: opts.commands, goal: nextGoal });
          if (!nextBoundaries.has(k)) nextBoundaries.set(k, b);
        }
    }
    let checkpointUnreachable: boolean | undefined, checkpointDiff: string[] | undefined;
    if (mode === 'prove' && cpId && st !== 'truncated' && st !== 'error') {
      const cp = await checkpointState(game, layouts, cpId, opts.commands);
      const key = projectState(game, layouts, cp, { commands: opts.commands, goal: nextGoal });
      checkpointUnreachable = !nextBoundaries.has(key);
      if (checkpointUnreachable) {
        // The closest boundary state, dimension by dimension, so the author sees what to fix in the checkpoint.
        const want = Object.fromEntries(JSON.parse(key) as [string, string][]);
        let best: string[] = [];
        for (const k of nextBoundaries.keys()) {
          const have = Object.fromEntries(JSON.parse(k) as [string, string][]);
          const diff = [...new Set([...Object.keys(want), ...Object.keys(have)])]
            .filter((d) => want[d] !== have[d])
            .map((d) => `${d}: ${want[d] ?? '—'} vs ${have[d] ?? '—'}`);
          if (!best.length || diff.length < best.length) best = diff;
        }
        checkpointDiff = best;
      }
    }
    const proof: ChapterProof = {
      id,
      from: starts.length,
      distinct: starts.length,
      status: st,
      states: results.reduce((n, r) => n + r.states, 0),
      softlockCount: results.reduce((n, r) => n + r.softlockCount, 0),
      ms: Date.now() - t,
      boundaries: nextBoundaries.size,
      results,
      ...(checkpointUnreachable !== undefined ? { checkpointUnreachable } : {}),
      ...(checkpointDiff ? { checkpointDiff } : {}),
    };
    chapters.push(proof);
    status = worst(status, st);
    if (st === 'truncated') {
      starts = [];
      return;
    }
    if (mode === 'prove')
      starts = nextBoundaries.size
        ? [...nextBoundaries.values()].map((state) => ({ state }))
        : cpId
          ? [{ state: await checkpointState(game, layouts, cpId, opts.commands) }]
          : [];
    else starts = cpId ? [{ state: await checkpointState(game, layouts, cpId, opts.commands) }] : [];
  };
  for (let i = 0; i < cps.length; i++) {
    if (!starts.length && i > 0) break;
    const [id, c] = cps[i];
    const next = cps[i + 1]?.[1].goals;
    await run(id, c.goals, next, id);
  }
  if (cps.length && starts.length) await run('ending', undefined, undefined);
  const mismatch = chapters.some((c) => c.checkpointUnreachable);
  const final: ProofStatus = status === 'solved' && mismatch ? 'checkpoint_mismatch' : status;
  return {
    status: final,
    exit: exitOf(final),
    headline: chaptersHeadline({ status: final, chapters }),
    chapters,
    ms: Date.now() - t0,
  };
}
