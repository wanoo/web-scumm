// Reality Bridge (4.1.1): the signals a game may receive from the world outside, as data. A signal is an identifier
// from a finite alphabet the game declares; it reaches the game as an event (`events: [{ on: '<signal id>' }]`),
// never as text from outside (docs/en/REALITY.md). (core/types.ts re-exports every name.)
import type { Cmd, Id } from './content';

export interface SignalDef {
  /** The signal's identifier, also the event it emits: `mail.answer.correct`. */
  id: Id;
  /** Where it comes from (a connector's family): `mail`, `webhook`, `badge`… Informative for the Bridge's policy. */
  source: string;
  /**
   * `optional`: the game can be finished without it. `required`: the main ending needs it, so the game declares a
   * `fallback` (what a player does when the outside never answers) and a scenario proves it (`npm run solve`).
   */
  availability: 'optional' | 'required';
  /** How a session keeps it: `record`, an entry replayed offline (the only mode of 4.1.1). */
  replay: 'record';
  /**
   * `true` (the default): its effect applies once per game, whatever the deliveries. `false`: each distinct signal
   * (a new id from the Bridge) applies again; a delivery repeated with the same id never does.
   */
  once?: boolean;
  /** For a `required` signal: the commands a player can trigger instead (`npm run validate` checks they exist). */
  fallback?: { verb: Id; a: Id; b?: Id; do?: Cmd[] };
}

export interface RealityDef {
  signals: SignalDef[];
}

/** What a save keeps of the link (`GameState.reality`): no token, no email, no payload. */
export interface RealityState {
  /** The pseudonymous id the Bridge gave this game when it was paired. */
  playerId?: string;
  /** The last sequence delivered without a gap. */
  cursor: number;
  /**
   * Signal ids applied above the cursor, with their sequence (at or below the cursor everything was applied: they
   * are compacted away, so the set stays small).
   */
  applied: Record<string, number>;
}
