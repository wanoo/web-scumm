// How long things take, in one place: the DOM presenter plays them, the Studio's cutscene timeline
// (src/engine/tools/timeline.ts) estimates them, and the run clock (core/run-clock.ts, 4.1.14, ADR 0016) adds up their
// logical durations: the in-game time a speedrun is ranked on.
/** A line stays at least this long… */
const SAY_MIN = 2200;
/** …plus this much per character, divided by the text speed setting. */
const SAY_PER_CHAR = 70;
export const sayMs = (text: string, textSpeed = 1) => Math.max(SAY_MIN, text.length * SAY_PER_CHAR) / textSpeed;
/** Walking speed, logical units (640 × 400 room) per second. */
export const WALK_SPEED = 150;
/** Default length of an `anim` command. */
export const ANIM_MS = 800;
/** Default length of a camera pan. */
export const CAMERA_MS = 600;
/** Default frames per second of character poses and prop animations. */
export const FPS = 8;
/** Default lengths of the stage motions (`launch`, `spring`, `path`; a `follow` lasts its `ms` or nothing). */
export const MOTION_MS = { launch: 900, spring: 1200, path: 1500 } as const;

/**
 * The version of the logical durations below (ADR 0016): a run records it, a verifier refuses another one. Bump it
 * when any logical duration changes, never silently.
 */
export const TIMING_VERSION = 1;
/** Microticks per millisecond: the unit of `RunClock.logicalTime`. */
export const MICROTICKS_PER_MS = 1000n;
/**
 * The logical cost of a line, whatever its text, language or the player's text speed (ADR 0016: a translation is
 * presentation, two languages of one route have one in-game time).
 */
export const SAY_LOGICAL_MS = SAY_MIN;
/** The logical length of a walk of `distance` logical units, in milliseconds (rounded to the millisecond). */
export const walkLogicalMs = (distance: number) => Math.round((distance / WALK_SPEED) * 1000);
