// Solver: explores every possible action from "New game" (best-first: the state that has progressed
// the most — unlocked places, flags, inventory — is explored first) to prove the game can be finished, and to spot dead
// ends and unused items. States only differ by what matters: props and counters that nothing reads
// (a "2nd time" gag, opening/closing a cupboard with no consequence) don't create a new state.
// Uses the real engine with a silent presenter: whatever the solver finds, the player can do.
// Split by responsibility in 4.1.0 "Clarity" (tools/solve/): search, expansion, abstractions, model, report. This file
// re-exports what it exported before, so every import of the solver stays as it was.

export { abstractionLines, profileText } from './solve/report';
export type { Step, SolveProfile, SolveResult } from './solve/report';
export { mergeStats } from './solve/model';
export type { SolveOptions, NodeInput, TryRecord, Expansion, ExpandStats } from './solve/model';
export {
  mobilityError,
  isMobilityError,
  poolableItems,
  ownershipError,
  isOwnershipError,
  atomValue,
  monotonicThings,
  dominanceThings,
  projectState,
} from './solve/abstractions';
export type { Dims } from './solve/abstractions';
export { makeExpander } from './solve/expansion';
export { registerPool, threadPool, solve } from './solve/search';
