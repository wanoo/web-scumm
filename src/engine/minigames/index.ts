import type { Minigame } from './types';
import { pipes } from './pipes';
import { stroke } from './stroke';
import { pick } from './pick';
import { hide } from './hide';
import { runner } from './runner';
import { scratch } from './scratch';
import { cables } from './cables';

export type { Minigame, MinigameCtx } from './types';
export { MINIGAME_CSS } from './style';

/** Minigames provided by the engine. A game can add others with the same interface. */
export const minigames: Record<string, Minigame> = { pipes, stroke, pick, hide, runner, scratch, cables };
