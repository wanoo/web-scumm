// Loads a game from disk for the command-line tools (node only).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Layout } from '../core/types';
import type { AssetIndex } from './validate';

export function loadLayouts(dir: string): Record<string, Layout> {
  const out: Record<string, Layout> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) out[basename(f, '.json')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return out;
}

export function loadAssets(file: string): AssetIndex | undefined {
  if (!existsSync(file)) return undefined;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return { images: j.images ?? {}, audio: j.audio };
}
