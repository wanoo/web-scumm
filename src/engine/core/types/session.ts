// Inputs and sessions: what a player did, replayable. (core/types.ts re-exports every name; 4.1.0 "Clarity".)
import type { Cmd, Id, VerbId } from './content';
import type { GameState } from './state';

// ---------------------------------------------------------------------------
// Session: the player's inputs since the game started (or a save was loaded), enough to replay them
// ---------------------------------------------------------------------------

/** A player action: VERB a (with/to b). `a` can be an inventory item, `b` is always a target. */
export interface Action {
  verb: VerbId;
  a: Id;
  b?: Id;
}

/**
 * One input of a session (`Engine.session`). The answers given while it ran (`picks`, `maps`, `rnd`) are what makes it
 * replayable; `ran` lists the rules, topics, listeners and scripts that answered (the ids of the puzzle graph).
 */
export type SessionEntry = (
  | { act: Action /** The walk to the target was interrupted: nothing happened. */; aborted?: true }
  | { travel: Id }
  | { switch: Id }
  | { map: true }
  | { step: Id }
  | { script: Cmd[] }
  | { enter: Id }
  | { start: 'new' }
  /** A signal from the world outside, verified by the player before it became an input (4.1.1, Reality Bridge). */
  | { external: ExternalEntry }
) & {
  picks?: number[];
  maps?: (Id | null)[];
  rnd?: number[];
  /** `skip()` was called after that many commands. */
  skipAt?: number;
  ran?: string[];
  /** The state after the entry (`stateDigest`), to spot where a replay diverges. */
  digest?: string;
  /** Milliseconds since the session started (`Engine.clock`; absent in the solver and the tests): playtests read it, replay ignores it. */
  t?: number;
};

export interface Session {
  v: number;
  /** How it started: a new game (the intro's answers are in the first entry), a save, a checkpoint. */
  start: { kind: 'new' } | { kind: 'load' } | { kind: 'checkpoint'; id: Id };
  /** The state it started from. */
  base: GameState;
  log: SessionEntry[];
  /** When it started (epoch ms), when a clock was set. */
  at?: number;
}

/**
 * What a session keeps of a signal from outside (4.1.1): its id and sequence on the Bridge, the signal, the source
 * and when it arrived. Never a token, an email, a credential or the connector's payload: a replay applies it offline.
 */
export interface ExternalEntry {
  id: string;
  sequence: number;
  signal: Id;
  source: string;
  receivedAt: number;
  evidenceHash?: string;
  /**
   * Signed by the Bridge but refused for good (expired, a signal the game no longer declares): recorded so the
   * cursor moves past it, with no effect.
   */
  skipped?: 'expired' | 'signal';
}
