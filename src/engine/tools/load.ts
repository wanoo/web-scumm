// Loads a game from disk for the command-line tools (node only).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Layout } from '../core/types';
import type { AssetIndex } from './validate';

export function loadLayouts(dir: string): Record<string, Layout> {
  const out: Record<string, Layout> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir))
    if (f.endsWith('.json')) out[basename(f, '.json')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return out;
}

export function loadAssets(file: string): AssetIndex | undefined {
  if (!existsSync(file)) return undefined;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return { images: j.images ?? {}, audio: j.audio };
}

/** Translation tables of a game folder: locales/<lang>.json → language → (path → text). */
export function loadLocales(dir: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir))
    if (f.endsWith('.json')) {
      try {
        out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        /* unreadable: skipped */
      }
    }
  return out;
}
