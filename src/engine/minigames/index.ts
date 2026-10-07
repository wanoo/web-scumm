import type { Minigame } from './types';
import { MINIGAME_META } from './meta';

export type { Minigame, MinigameCtx } from './types';
export { MINIGAME_CSS } from './style';

/** Each built-in minigame's code, loaded when it starts (3.9): a player who never meets a minigame never downloads it. */
const LOAD: Record<keyof typeof MINIGAME_META, () => Promise<Minigame>> = {
  pipes: () => import('./pipes').then((m) => m.pipes),
  stroke: () => import('./stroke').then((m) => m.stroke),
  pick: () => import('./pick').then((m) => m.pick),
  hide: () => import('./hide').then((m) => m.hide),
  runner: () => import('./runner').then((m) => m.runner),
  scratch: () => import('./scratch').then((m) => m.scratch),
  cables: () => import('./cables').then((m) => m.cables),
  'code-wheel': () => import('./code-wheel').then((m) => m.codeWheel),
};

/**
 * Minigames provided by the engine. A game can add others with the same interface. What tools read (`required`,
 * `textParams`, `bindings`) is here at once; `run` loads the minigame's code first (precached by the service worker,
 * so it works offline).
 * @public
 */
export const minigames: Record<string, Minigame> = Object.fromEntries(
  (Object.keys(MINIGAME_META) as (keyof typeof MINIGAME_META)[]).map((k) => [
    k,
    { ...MINIGAME_META[k], run: (ctx) => LOAD[k]().then((m) => m.run(ctx)) } satisfies Minigame,
  ]),
);
