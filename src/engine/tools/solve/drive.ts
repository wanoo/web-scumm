// Driving the engine in a search: a promise of the engine awaited, the guided tutorial's steps played meanwhile
// (moved out of expansion.ts in 4.1.13; the search drives the start and the intro's choices with it too).
import type { Action, Engine } from '../../core/engine';

/**
 * The engine's promise or the next turn of the event loop, whichever comes first; the timer is cleared when the
 * engine wins (3.6). A search runs in microtasks and never reaches the timers' phase: before this, every uncleared
 * tick stayed queued, with its promise, until the process went idle (15 MB per audit, out of memory over a corpus).
 */
const raceTick = async (settled: Promise<unknown>) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      settled,
      new Promise<void>((r) => {
        t = setTimeout(r, 0);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
};

/**
 * Waits for an engine promise to settle, playing the guided-tutorial steps whenever one is pending.
 * `onGuide` receives the action played (for the path).
 */
export async function drive(engine: Engine, p: Promise<unknown>, onGuide: (a: Action) => void): Promise<void> {
  let done = false;
  let error: unknown;
  const settled = p.then(
    () => {
      done = true;
    },
    (e) => {
      done = true;
      error = e;
    },
  );
  for (let guard = 0; !done && guard < 500; guard++) {
    // The silent presenter resolves everything in microtasks: without a tutorial, we never wait on the timer.
    await raceTick(settled);
    const g = engine.guiding;
    if (g && !done) {
      const act: Action = { verb: g.verb, a: g.target };
      onGuide(act);
      await engine.act(act);
    }
  }
  if (!done) throw new Error('the engine never yields control back (tutorial or stuck choice?)');
  if (error) throw error;
}
