// What the engine and the tools load for this game.
import type { Layout } from '@engine/core/types';
import type { AssetManifest } from '@engine/dom/assets';
import type { Minigame } from '@engine/minigames';
import { game } from './game';
import manifestJson from './assets.gen.json';

export { game };

// One JSON per room (placement editor: ?edit=<room>). Outside Vite, the tools read layout/*.json themselves.
export const layouts: Record<string, Layout> = {};
if (import.meta.env) {
  for (const [path, mod] of Object.entries(import.meta.glob('./layout/*.json', { eager: true, import: 'default' }))) {
    layouts[path.split('/').pop()!.replace('.json', '')] = mod as Layout;
  }
}

export const manifest = manifestJson as unknown as AssetManifest;

/** Minigames specific to this game (none: the demo uses the engine's pipes, pick and scratch). */
export const minigames: Record<string, Minigame> = {};

/** Images to prepare even when no content references them. */
export const extraImages: string[] = [];
