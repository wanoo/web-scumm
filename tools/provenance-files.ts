// The files behind a game's asset keys, read from disk: what `npm run provenance` locks and `validate` checks.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetKeys, assetPath, type FileFacts, type Provenance, type ProvenanceLock } from '../src/engine/tools/provenance';
import type { GameDef } from '../src/engine/core/types';
import { ASSETS_DIR, GAME_DIR } from './game';

export const PROVENANCE = resolve(GAME_DIR, 'provenance.json');
export const LOCK = resolve(GAME_DIR, 'provenance.lock.json');

export const readJson = <T>(f: string): T | null => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as T : null);

/** The game's asset keys (manifest images and videos, audio files). */
export function shippedKeys(game: GameDef): string[] {
  const m = readJson<{ images: Record<string, unknown>; videos?: Record<string, unknown> }>(resolve(GAME_DIR, 'assets.gen.json'));
  return m ? assetKeys(game, m) : [];
}

/** SHA-256 and size of each key's file under the built assets (null: missing). */
export function fileFacts(keys: string[], dir = ASSETS_DIR): Record<string, FileFacts> {
  const out: Record<string, FileFacts> = {};
  for (const k of keys) {
    const p = assetPath(k);
    const f = p ? resolve(dir, p) : null;
    if (!f || !existsSync(f)) { out[k] = null; continue; }
    const b = readFileSync(f);
    out[k] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length };
  }
  return out;
}

export type { Provenance, ProvenanceLock };
