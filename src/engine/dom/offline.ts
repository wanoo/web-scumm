// The plan of a full offline warm-up: every asset the game can ever show or play, in the order a player benefits from
// it, in batches the budgets size. Pure: the App runs it through the asset bank after the room-scoped warm-up.
import type { GameDef } from '../core/types';
import type { AssetManifest } from './assets';

export type BatchKind = 'img' | 'sfx' | 'voice' | 'music' | 'video';
export interface Batch { kind: BatchKind; ids: string[] }

export interface OfflineBudgets { initialImages?: number; audioFiles?: number }

/**
 * Images first (every image of the manifest: sprites are addressed by sheet and cell, a content scan would miss
 * them), then sound effects, voices, music one track at a time, videos one at a time. Batch sizes follow
 * `GameDef.assetBudgets` (images per batch: `initialImages`, default 120; audio per batch: `audioFiles`, default 16).
 */
export function offlinePlan(game: GameDef, manifest: AssetManifest, budgets: OfflineBudgets = game.assetBudgets ?? {}): Batch[] {
  const chunk = (ids: string[], n: number, kind: BatchKind): Batch[] => {
    const out: Batch[] = [];
    for (let i = 0; i < ids.length; i += n) out.push({ kind, ids: ids.slice(i, i + n) });
    return out;
  };
  const a = game.audio ?? {};
  const imgN = Math.max(1, budgets.initialImages ?? 120), audioN = Math.max(1, budgets.audioFiles ?? 16);
  return [
    ...chunk(Object.keys(manifest.images).sort(), imgN, 'img'),
    ...chunk(Object.values(a.sfx ?? {}).sort(), audioN, 'sfx'),
    ...chunk(Object.values(a.voices ?? {}).sort(), audioN, 'voice'),
    ...chunk(Object.values(a.music ?? {}).sort(), 1, 'music'),
    ...chunk(Object.keys(manifest.videos ?? {}).sort(), 1, 'video'),
  ];
}

/** How many files and batches a plan holds, for a log line. */
export function planSize(plan: Batch[]): { files: number; batches: number } {
  return { files: plan.reduce((n, b) => n + b.ids.length, 0), batches: plan.length };
}
