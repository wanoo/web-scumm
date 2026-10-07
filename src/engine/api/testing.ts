// web-scumm/testing (4.0): what a game's own tests drive the engine with, without a browser: the engine, fake ports,
// the solver, the save envelope. Public (docs/en/SUPPORT.md).
export { Engine } from '../core/engine';
export { FakePresenter, MemoryStore } from '../core/ports';
export { parseSave, saveEnvelope, SaveWorldMismatch, savedWorld, upgradeEnvelope } from '../core/save';
export type { SaveEnvelopeV3, SaveEnvelopeV4 } from '../core/save';
// 4.1.15 (ADR 0018, D26): what a verifier checks of a run's world, and the leaderboard it goes to.
export { leaderboardKey, REMIX_CATEGORIES, seedCommitment, worldVerdict } from '../core/remix/categories';
export type { RemixCategoryRules, SpeedrunSeedPolicy, WorldEvidence } from '../core/remix/categories';
export { logicalKey } from '../core/remix/compile';
export { solve } from '../tools/solve';
export type { SolveOptions, SolveResult } from '../tools/solve';
// 4.1.11 (ADR 0011): what the engine says happened, in ids (`Engine.journal`).
export type { SemanticEvent, SemanticJournal } from '../core/journal';
// 4.1.12 (ADR 0013): the game's fingerprint, what a run or a build is compared on.
export {
  fingerprint,
  fingerprintGame,
  hashSources,
  presentationOf,
  sha256Hex,
  shortFingerprint,
} from '../core/fingerprint';
export type { GameFingerprint } from '../core/fingerprint';
