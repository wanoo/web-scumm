// How long things take on screen, in one place: the DOM presenter plays them, the Studio's cutscene timeline
// (src/engine/tools/timeline.ts) estimates them.
/** A line stays at least this long… */
export const SAY_MIN = 2200;
/** …plus this much per character, divided by the text speed setting. */
export const SAY_PER_CHAR = 70;
export const sayMs = (text: string, textSpeed = 1) => Math.max(SAY_MIN, text.length * SAY_PER_CHAR) / textSpeed;
/** Walking speed, logical units (640 × 400 room) per second. */
export const WALK_SPEED = 150;
/** Default length of an `anim` command. */
export const ANIM_MS = 800;
/** Default length of a camera pan. */
export const CAMERA_MS = 600;
/** Default frames per second of character poses and prop animations. */
export const FPS = 8;
/** A toast stays this long. */
export const TOAST_MS = 2400;
