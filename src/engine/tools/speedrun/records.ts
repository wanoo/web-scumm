// The player's local records (4.1.14 "Time Attack"): per game and category, the personal best with its splits, the
// best segment of every split, the sum of best, attempts, finishes and abandons, the route's notes, and a short
// history. Pure data (bigints as decimal strings), kept offline in IndexedDB (`dom/run-store.ts`, `records`); this
// module only computes. A record keeps the trust level of each run: a local PB is `local` until someone replays it.
import type { SpeedrunCategory } from '../../core/types';
import { type RecordedSplit, rankedTime } from './splits';

/** How far a run is believed (ADR 0017): raised only by someone other than the player's client. @public */
export type TrustLevel = 'local' | 'replay-valid' | 'server-witnessed' | 'moderator-verified';
export const TRUST_LEVELS: readonly TrustLevel[] = ['local', 'replay-valid', 'server-witnessed', 'moderator-verified'];

/** One run as the history keeps it. */
export interface RunSummary {
  runId: string;
  at: number;
  status: 'finished' | 'abandoned';
  /** The ranked time in microticks (null: abandoned). */
  total: string | null;
  trust: TrustLevel;
}

/** A category's records on this device. */
export interface CategoryRecords {
  gameId: string;
  categoryId: string;
  rulesVersion: number;
  attempts: number;
  finished: number;
  abandoned: number;
  pb: { runId: string; total: string; splits: RecordedSplit[]; trust: TrustLevel; at: number } | null;
  /** The best segment of each split (microticks), by split id. */
  best: Record<string, string>;
  notes: string;
  history: RunSummary[];
}

const HISTORY = 50;

export function emptyRecords(gameId: string, categoryId: string, rulesVersion: number): CategoryRecords {
  return {
    gameId,
    categoryId,
    rulesVersion,
    attempts: 0,
    finished: 0,
    abandoned: 0,
    pb: null,
    best: {},
    notes: '',
    history: [],
  };
}

/** Each split's segment: its ranked time minus the previous split that fired (null when it was missed). */
export function segments(cat: Pick<SpeedrunCategory, 'timing'>, splits: readonly RecordedSplit[]): (bigint | null)[] {
  let prev = 0n;
  return splits.map((s) => {
    const t = rankedTime(cat, s);
    if (t === null || s.entry === null) return null;
    const seg = t - prev;
    prev = t;
    return seg;
  });
}

/** The sum of the best segments (null until every split has one). */
export function sumOfBest(rec: CategoryRecords, splitIds: readonly string[]): bigint | null {
  let sum = 0n;
  for (const id of splitIds) {
    const b = rec.best[id];
    if (b === undefined) return null;
    sum += BigInt(b);
  }
  return sum;
}

/** Ahead (negative) or behind (positive) the PB at each split; null where either is missing. */
export function againstPb(
  cat: Pick<SpeedrunCategory, 'timing'>,
  rec: CategoryRecords,
  splits: readonly RecordedSplit[],
): (bigint | null)[] {
  return splits.map((s) => {
    const mine = rankedTime(cat, s);
    const pb = rec.pb?.splits.find((p) => p.id === s.id);
    const theirs = pb ? rankedTime(cat, pb) : null;
    return mine === null || theirs === null ? null : mine - theirs;
  });
}

/**
 * The records after a run: an attempt counted, a finish or an abandon, best segments improved, a new PB when it is
 * faster (a run under other rules is never compared: its `rulesVersion` resets the records). Returns a new value.
 */
export function addRun(
  recIn: CategoryRecords,
  cat: SpeedrunCategory,
  rulesVersion: number,
  run: {
    runId: string;
    at: number;
    splits: RecordedSplit[];
    finish: { logicalTime: string; activeTime: string; rtaMs: number | null } | null;
    trust?: TrustLevel;
  },
): CategoryRecords {
  const rec =
    recIn.rulesVersion === rulesVersion
      ? structuredClone(recIn)
      : emptyRecords(recIn.gameId, recIn.categoryId, rulesVersion);
  rec.attempts++;
  const total = run.finish ? rankedTime(cat, run.finish) : null;
  const trust = run.trust ?? 'local';
  segments(cat, run.splits).forEach((seg, i) => {
    const id = run.splits[i]!.id;
    if (seg === null) return;
    const b = rec.best[id];
    if (b === undefined || seg < BigInt(b)) rec.best[id] = seg.toString();
  });
  if (run.finish && total !== null) {
    rec.finished++;
    if (!rec.pb || total < BigInt(rec.pb.total))
      rec.pb = { runId: run.runId, total: total.toString(), splits: structuredClone(run.splits), trust, at: run.at };
  } else rec.abandoned++;
  rec.history = [
    {
      runId: run.runId,
      at: run.at,
      status: run.finish ? ('finished' as const) : ('abandoned' as const),
      total: total?.toString() ?? null,
      trust,
    },
    ...rec.history,
  ].slice(0, HISTORY);
  return rec;
}

/** Raises a run's trust in the records (a verdict came back): never lowers it, never from the client itself. */
export function raiseTrust(recIn: CategoryRecords, runId: string, trust: TrustLevel): CategoryRecords {
  const rec = structuredClone(recIn);
  const up = (t: TrustLevel) => (TRUST_LEVELS.indexOf(trust) > TRUST_LEVELS.indexOf(t) ? trust : t);
  if (rec.pb?.runId === runId) rec.pb.trust = up(rec.pb.trust);
  for (const h of rec.history) if (h.runId === runId) h.trust = up(h.trust);
  return rec;
}
