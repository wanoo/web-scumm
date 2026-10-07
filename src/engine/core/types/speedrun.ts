// A game's speedrun manifest (4.1.14 "Time Attack", ADR 0016/0017): its categories, its splits, the version of its
// rules. Content, like the rest of the game: a category is defined without touching the engine
// (tests/speedrun-manifest.test.ts). (core/types.ts re-exports every name.)
import type { Id, Value } from './content';
import type { SemanticEvent } from '../journal';

/**
 * A semantic trigger: the first event of this kind (and these fields, when given) in the run's journal. A room
 * entered, an item acquired or lost, a flag changed (to `value`), an objective completed, an ending reached, a
 * session started, a player switched. No pixel is ever read.
 * @public
 */
export interface SemanticTrigger {
  event: SemanticEvent['kind'];
  room?: Id;
  item?: Id;
  flag?: Id;
  value?: Value;
  objective?: Id;
  ending?: Id;
  player?: Id;
  session?: string;
}

/** A category's start or finish: a semantic trigger. @public */
export type SpeedrunTrigger = SemanticTrigger;

/**
 * A speedrun category: what counts as a run, how it is timed, what it may do. `timing` names the time it is ranked
 * on: `rta` (the wall clock, never verifiable by a replay: such a run is `valid-unranked` without a witness), `igt`
 * (the logical time, ADR 0016), `active-igt` (the logical time minus cutscenes).
 * @public
 */
export interface SpeedrunCategory {
  id: string;
  /** What players read (the leaderboard, the overlay). */
  name: string;
  timing: 'rta' | 'igt' | 'active-igt';
  start: SpeedrunTrigger;
  finish: SpeedrunTrigger;
  /** Manual saves allowed (the autosave always runs). */
  allowSaves: boolean;
  /** The pause menu may be opened during the run. */
  allowPauses: boolean;
  /** Hints may be asked for (a hint is recorded by the session: verifiable). */
  allowHints: boolean;
  /**
   * A load during the run: it disqualifies, or it is allowed (a state the run reached). `segment` (a load starting a
   * timed segment) is reserved: not implemented in 4.1.14, the validator refuses it.
   */
  reload: 'invalidates' | 'allowed' | 'segment';
  /** Signals from the world outside: none, a signed scenario replayed, or live (a category of its own). */
  realityPolicy: 'forbidden' | 'recorded' | 'live';
  /**
   * The fingerprint components a run must match with the approved package (`logic`, `trustedExtensions`,
   * `presentation`, `engine`): a mod that changes only the art keeps `logic` and may still run "Any%".
   */
  fingerprint: readonly ('logic' | 'trustedExtensions' | 'presentation' | 'engine')[];
  /** The inputs allowed (an accessibility option is never an implicit cheat: a category says what it allows). */
  inputs: { mouse: boolean; touch: boolean; keyboard: boolean; gamepad: boolean; macros: 'forbidden' | 'allowed' };
  /** `fixed`: every run draws from the same seed (`fixed:<category id>`); `random` (default): a fresh seed per run. */
  seed?: 'fixed' | 'random';
}

/** A split: a semantic trigger, a name, and the split it is a step of. @public */
export interface SpeedrunSplit {
  id: string;
  name: string;
  at: SemanticTrigger;
  parent?: string;
}

/**
 * The game's speedrun manifest (`GameDef.speedrun`): categories, splits, and the version of the rules (a change never
 * silently requalifies an old run: a run records the version it was played under).
 * @public
 */
export interface SpeedrunManifest {
  categories: readonly SpeedrunCategory[];
  splits: readonly SpeedrunSplit[];
  rulesVersion: number;
}
