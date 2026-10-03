// Custom commands: the escape hatch when the DSL is not enough. A game exports `commands` from games/<id>/index.ts;
// a script then says `{ custom: 'explodeChicken', args: { … } }`. The command declares what it does to the state as
// plain commands (`effects`), so the validator, the solver and the save keep reasoning about the game; its `run`
// only draws or plays something in the browser (nothing runs in node). A command with no effect says `pure: true`.
import type { Presenter } from './ports';
import type { Cmd, GameDef, GameState, RoomDef } from './types';

export interface CustomContext {
  game: GameDef;
  /** The live state: read it; change it only through `effects`. */
  state: GameState;
  room: RoomDef;
  args: unknown;
  ui: Presenter;
  /** The scene element (DOM renderer only): draw into it, clean up after yourself. */
  scene?: HTMLElement;
  /** Skipping a cutscene: finish right away. */
  fast: boolean;
}

export interface CustomCommand {
  /** What it does to the game, as commands: run first, in the browser and in the solver. */
  effects?: Cmd[];
  /** No effect on the state (then `effects` may be omitted). */
  pure?: boolean;
  /** The visual part, browser only. */
  run?(ctx: CustomContext): Promise<void> | void;
}

export type CustomCommands = Record<string, CustomCommand>;
