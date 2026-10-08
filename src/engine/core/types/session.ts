// Inputs and sessions: what a player did, replayable. (core/types.ts re-exports every name; 4.1.0 "Clarity".)
import type { Cmd, Id, VerbId } from './content';
import type { GameState } from './state';
import type { WorldVariant } from '../remix/compile';

// ---------------------------------------------------------------------------
// Session: the player's inputs since the game started (or a save was loaded), enough to replay them
// ---------------------------------------------------------------------------

/** A player action: VERB a (with/to b). `a` can be an inventory item, `b` is always a target. @public */
export interface Action {
  verb: VerbId;
  a: Id;
  b?: Id;
}

/**
 * How a minigame that says so ended (4.1.16): won, let through (`passed`, a parody's mercy), skipped, lost
 * (`failed`, the story goes on with it), or not played (`disabled`). A minigame that says nothing records nothing.
 * @public
 */
export type MinigameResult = 'won' | 'passed' | 'skipped' | 'failed' | 'disabled';

/**
 * One input of a session (`Engine.session`). The answers given while it ran (`picks`, `maps`, `rnd`) are what makes it
 * replayable; `ran` lists the rules, topics, listeners and scripts that answered (the ids of the puzzle graph).
 * @public
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
  /** The results the entry's minigames reported, in order (4.1.16): fed back when replaying, like `picks`. */
  mg?: MinigameResult[];
  /** `skip()` was called after that many commands. */
  skipAt?: number;
  ran?: string[];
  /** The state after the entry (`stateDigest`), to spot where a replay diverges. */
  digest?: string;
  /** Milliseconds since the session started (`Engine.clock`; absent in the solver and the tests): playtests read it, replay ignores it. */
  t?: number;
};

/**
 * A player's inputs since the game started or a save was loaded, with the state they started from: enough to replay
 * them.
 * @public
 */
export interface Session {
  v: number;
  /** How it started: a new game (the intro's answers are in the first entry), a save, a checkpoint. */
  start: { kind: 'new' } | { kind: 'load' } | { kind: 'checkpoint'; id: Id };
  /** The state it started from. */
  base: GameState;
  log: SessionEntry[];
  /** When it started (epoch ms), when a clock was set. */
  at?: number;
  /**
   * The run's seed (4.1.14, ADR 0016): the `logic` stream `engine.random` draws from (`core/prng.ts`). A new game or a
   * checkpoint takes a new one, a load continues the run's. Absent in a session recorded before 4.1.14.
   */
  seed?: string;
  /**
   * The world the session was played in (4.1.15, ADR 0018), when the game was compiled from a variant: a replay and a
   * speedrun verifier rebuild that very world from it (its assignment, never regenerated).
   */
  variant?: WorldVariant;
}

/**
 * What a session keeps of a signal from outside (4.1.1): its id and sequence on the Bridge, the signal, the source
 * and when it arrived. Never a token, an email, a credential or the connector's payload: a replay applies it offline.
 * @public
 */
export interface ExternalEntry {
  id: string;
  sequence: number;
  signal: Id;
  source: string;
  receivedAt: number;
  /**
   * The pseudonymous player the Bridge delivered it to (`p-…`, 4.1.2). The first delivery binds the save to it
   * (`GameState.reality.playerId`); a delivery for another player is refused as `mismatch`, so a save imported on a
   * device linked to someone else is neither changed nor acknowledged. Absent in the solver's worlds.
   */
  playerId?: string;
  evidenceHash?: string;
  /**
   * Signed by the Bridge but refused for good (expired, a signal the game no longer declares): recorded so the
   * cursor moves past it, with no effect.
   */
  skipped?: 'expired' | 'signal';
}
