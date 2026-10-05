// web-scumm/content (4.0): what a game's sources are written with. Public: its names follow docs/en/SUPPORT.md (a
// change is announced, a removal waits for the next major). Everything else of src/engine is internal.
export { defineGame, defineRoom, compileGame, EMPTY_LAYOUT, FLOOR, NEAR } from '../core/define';
export type { GameSource, CompiledGame } from '../core/define';
export type * from '../core/types';
export type { CustomCommand, CustomCommands, CustomContext } from '../core/custom';
