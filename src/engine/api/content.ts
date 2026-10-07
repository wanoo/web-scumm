// web-scumm/content (4.0): what a game's sources are written with. Public: its names follow docs/en/SUPPORT.md (a
// change is announced, a removal waits for the next major). Everything else of src/engine is internal.
export { defineGame, defineRoom, compileGame, EMPTY_LAYOUT, FLOOR, NEAR } from '../core/define';
export type { GameSource, CompiledGame } from '../core/define';
export type * from '../core/types';
export type { CustomCommand, CustomCommands, CustomContext } from '../core/custom';
// 4.1.12 (ADR 0013, 0014): the game's intermediate representation, the canonical text it is hashed through, and the
// solver's 100% goal from the objectives.
export { canonicalJson } from '../core/canonical';
export { compileIR, logicView, provenanceOf } from '../core/ir';
export type {
  CompileIROptions,
  ExtensionHashes,
  GameIR,
  IrEntity,
  IrExtensions,
  IrObjective,
  IrRealityPolicies,
  IrRoom,
  IrRule,
  IrScript,
  IrSource,
  IrVariantSlot,
  IrWorld,
} from '../core/ir';
export { completionGoal } from '../core/objectives';
