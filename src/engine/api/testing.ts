// web-scumm/testing (4.0): what a game's own tests drive the engine with, without a browser: the engine, fake ports,
// the solver, the save envelope. Public (docs/en/SUPPORT.md).
export { Engine } from '../core/engine';
export { FakePresenter, MemoryStore } from '../core/ports';
export { parseSave, saveEnvelope } from '../core/save';
export type { SaveEnvelopeV3 } from '../core/save';
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
// 4.1.14 (ADR 0016, ADR 0017): speedruns: the run clock, a run's proof (`.wsrun`), the verifier and its verdicts.
export { isRankable, verifyRun } from '../tools/speedrun/verify';
export type { SpeedrunVerdict, SpeedrunVerifyResult, VerifyContext } from '../tools/speedrun/verify';
export type { SpeedrunEnvelope } from '../tools/speedrun/envelope';
export type { TrustLevel } from '../tools/speedrun/records';
export type { RunClock } from '../core/run-clock';
