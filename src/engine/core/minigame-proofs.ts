// The minigames whose result a replay computes again (4.1.17, D31, ADR 0020): for each, a pure function of the
// command's params (as the world gave them) and the recorded transcript, giving the result or why it is not one. The
// game's data never holds such a function: the engine does, so a game stays declarative.
import { type CodeWheelParams, verifyWheelTranscript } from './remix/code-wheel';
import type { Id, MinigameResult } from './types';

/** How a replay says a transcript was refused (the verifier reads it: `invalid-replay`, not a crash). */
export const TRANSCRIPT_REFUSED = 'minigame transcript refused:';

type Prover = (params: Record<string, unknown>, transcript: unknown) => { result: MinigameResult } | { error: string };

const PROVERS: Record<string, Prover> = {
  'code-wheel': (p, t) => verifyWheelTranscript(p as unknown as CodeWheelParams, t),
};

/** The result a minigame's transcript gives, or why it does not; an unknown minigame has no transcript to give. */
export function proveMinigame(id: Id, params: Record<string, unknown>, transcript: unknown) {
  const prove = Object.hasOwn(PROVERS, id) ? PROVERS[id]! : undefined;
  return prove ? prove(params, transcript) : { error: `the minigame ${id} records no transcript` };
}
