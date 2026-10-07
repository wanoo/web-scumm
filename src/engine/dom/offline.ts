// The plan of a full offline warm-up: every asset the game can ever show or play, in the order a player benefits from
// it, in batches the budgets size. Pure: the App runs it through the asset bank after the room-scoped warm-up.
import type { GameDef } from '../core/types';
import { assetGraph, splitKey } from '../core/asset-graph';
import type { AssetManifest, WarmResult } from './assets';

type BatchKind = 'img' | 'sfx' | 'voice' | 'music' | 'video';
export interface Batch {
  kind: BatchKind;
  ids: string[];
}

export interface OfflineBudgets {
  initialImages?: number;
  audioFiles?: number;
}

/**
 * Images first (every image of the manifest: sprites are addressed by sheet and cell, a content scan would miss
 * them), then sound effects, voices, music one track at a time, videos one at a time. Batch sizes follow
 * `GameDef.assetBudgets` (images per batch: `initialImages`, default 120; audio per batch: `audioFiles`, default 16).
 */
export function offlinePlan(
  game: GameDef,
  manifest: AssetManifest,
  budgets: OfflineBudgets = game.assetBudgets ?? {},
): Batch[] {
  const chunk = (ids: string[], n: number, kind: BatchKind): Batch[] => {
    const out: Batch[] = [];
    for (let i = 0; i < ids.length; i += n) out.push({ kind, ids: ids.slice(i, i + n) });
    return out;
  };
  const imgN = Math.max(1, budgets.initialImages ?? 120),
    audioN = Math.max(1, budgets.audioFiles ?? 16);
  // The asset graph's `offline` scope (src/engine/core/asset-graph.ts): the same keys provenance and the budgets use.
  const by: Record<BatchKind, string[]> = { img: [], sfx: [], voice: [], music: [], video: [] };
  for (const k of assetGraph(game, { manifest }).offline) {
    const [kind, id] = splitKey(k);
    by[kind].push(id);
  }
  return [
    ...chunk(by.img, imgN, 'img'),
    ...chunk(by.sfx, audioN, 'sfx'),
    ...chunk(by.voice, audioN, 'voice'),
    ...chunk(by.music, 1, 'music'),
    ...chunk(by.video, 1, 'video'),
  ];
}

/** How many files and batches a plan holds, for a log line. */
export function planSize(plan: Batch[]): { files: number; batches: number } {
  return { files: plan.reduce((n, b) => n + b.ids.length, 0), batches: plan.length };
}

/**
 * Where the full warm-up stands. `complete` is the only state that means "the whole game is in the cache": a skip,
 * a failure or a quota too small leaves `partial` (with `reason`), `skipped` says nothing was even tried, `off` is a
 * game with `offline: 'nearby'`.
 */
export interface OfflineStatus {
  state: 'idle' | 'running' | 'complete' | 'partial' | 'skipped' | 'off';
  /** Files known to be in the cache, and files the plan holds. */
  done: number;
  total: number;
  failed: string[];
  reason?: 'network' | 'save-data' | 'slow' | 'quota';
  /** `navigator.storage.estimate()` when the browser gives it, in bytes. */
  usage?: number;
  quota?: number;
}

/** Below this free space the warm-up is not started: a long game's assets would be evicted as they arrive. */
export const MIN_FREE_BYTES = 64 * 1024 * 1024;

export const offlineStart = (plan: Batch[], estimate?: { usage?: number; quota?: number }): OfflineStatus => {
  const { files } = planSize(plan);
  const s: OfflineStatus = {
    state: 'running',
    done: 0,
    total: files,
    failed: [],
    ...(estimate?.usage !== undefined ? { usage: estimate.usage } : {}),
    ...(estimate?.quota !== undefined ? { quota: estimate.quota } : {}),
  };
  if (
    estimate?.quota !== undefined &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < MIN_FREE_BYTES
  ) {
    s.state = 'partial';
    s.reason = 'quota';
  }
  return s;
};

/** Folds one batch's result into the status (a new object). */
export const offlineFold = (s: OfflineStatus, r: WarmResult, batchSize: number): OfflineStatus => {
  const out: OfflineStatus = { ...s, failed: [...s.failed, ...r.failed] };
  out.done += r.ok;
  if (r.skipped) {
    out.reason = out.reason ?? r.skipped;
    out.state = 'partial';
  } else if (r.failed.length) {
    out.reason = out.reason ?? 'network';
    out.state = 'partial';
  }
  if (r.ok + r.failed.length === 0 && !r.skipped && batchSize) out.reason = out.reason ?? 'network';
  return out;
};

/** The final word once every batch ran: complete only when nothing was skipped or failed. */
export const offlineFinish = (s: OfflineStatus): OfflineStatus =>
  s.state === 'running'
    ? {
        ...s,
        state: s.done >= s.total ? 'complete' : 'partial',
        ...(s.done >= s.total ? {} : { reason: s.reason ?? 'network' }),
      }
    : s.state === 'partial' && s.done === 0 && (s.reason === 'save-data' || s.reason === 'slow')
      ? { ...s, state: 'skipped' }
      : s;

/** A short line for the pause menu: "312/400", "complete", "312/400 ⚠". */
export const offlineText = (s: OfflineStatus, ui: { complete?: string; retry?: string } = {}): string =>
  s.state === 'complete'
    ? (ui.complete ?? 'complete')
    : s.state === 'off'
      ? '—'
      : s.state === 'idle'
        ? `0/${s.total}`
        : s.state === 'running'
          ? `${s.done}/${s.total}…`
          : `${s.done}/${s.total} ⚠${ui.retry ? ` ${ui.retry}` : ''}`;
