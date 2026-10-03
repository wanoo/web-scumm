// The current game: GAME environment variable, otherwise package.json → "config": { "game": … }, otherwise "demo".
// Used by vite.config.ts, the tools (validate, solve, refs) and tools/select-game.ts.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GameDef, Layout } from '../src/engine/core/types';
import type { Minigame } from '../src/engine/minigames/types';
import type { CustomCommands } from '../src/engine/core/custom';

// import.meta.url (not import.meta.dirname): vite.config.ts bundles this file and only rewrites import.meta.url.
export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

export function gameId(): string {
  const env = process.env.GAME?.trim();
  if (env) return env;
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    if (typeof pkg.config?.game === 'string' && pkg.config.game) return pkg.config.game;
  } catch { /* no readable package.json */ }
  return 'demo';
}

// GAME_DIR (environment) points the tools at a game folder outside games/, e.g. tests/fixture.
const DIR_ENV = process.env.GAME_DIR?.trim();
export const GAME = DIR_ENV && !process.env.GAME?.trim() ? basename(resolve(DIR_ENV)) : gameId();
export const GAME_DIR = DIR_ENV ? resolve(DIR_ENV) : resolve(ROOT, 'games', GAME);

/** What games/<id>/index.ts exports. Outside Vite, `layouts` is empty: the tools read layout/*.json from disk. */
export interface GameModule {
  game: GameDef;
  layouts: Record<string, Layout>;
  manifest: unknown;
  /** Minigames specific to the game (same interface as the engine's own). */
  minigames?: Record<string, Minigame>;
  /** Images to prepare even if no content references them (npm run assets). */
  extraImages?: string[];
  /** Custom commands (`{ custom }`), see src/engine/core/custom.ts. */
  commands?: CustomCommands;
  /** Translations: language → (text path → text), from locales/<lang>.json (tools/i18n.ts). */
  locales?: Record<string, Record<string, string>>;
}

/** Loads games/<GAME>/index.ts. */
export async function loadGameModule(): Promise<GameModule> {
  return import(pathToFileURL(resolve(GAME_DIR, 'index.ts')).href);
}
