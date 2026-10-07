// Solver: explores every possible action from "New game" (best-first: the state that has progressed
// the most — unlocked places, flags, inventory — is explored first) to prove the game can be finished, and to spot dead
// ends and unused items. States only differ by what matters: props and counters that nothing reads
// (a "2nd time" gag, opening/closing a cupboard with no consequence) don't create a new state.
// Uses the real engine with a silent presenter: whatever the solver finds, the player can do.
// Split by responsibility in 4.1.0 "Clarity" (tools/solve/): search, expansion, abstractions, model, report. This file
// re-exports what the rest of the code imports from the solver, so those imports stay as they were (4.1.8: the names
// nobody imported left the list; knip holds it).

export { profileText, proofProfileLines } from './solve/report';
export type { SolveProfile, SolveResult } from './solve/report';
export { mergeStats } from './solve/model';
export type { SolveOptions, NodeInput, Expansion, ExpandStats, RealityPolicy } from './solve/model';
export {
  mobilityError,
  isMobilityError,
  poolableItems,
  ownershipError,
  isOwnershipError,
  atomValue,
  dominanceThings,
  projectState,
} from './solve/abstractions';
export { makeExpander } from './solve/expansion';
export { registerPool, threadPool, solve } from './solve/search';
