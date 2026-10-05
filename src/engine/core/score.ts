// The music director's plan (3.5): pure functions of a score, the clock and the game's state, so what plays when is
// decided (and tested) without a sound card. A score is one piece cut into stems of the same length, rendered from
// the same arrangement (`npm run audio -- stems`): started at the same instant they stay sample-locked, and a change
// of state only moves gains, on a beat or a bar boundary, over a crossfade counted in beats. dom/director.ts plays it.
import type { Cond, Id, ScoreDef } from './types';

export type { ScoreDef, ScoreState } from './types';

export const beatSec = (s: ScoreDef) => 60 / s.bpm;
export const barSec = (s: ScoreDef) => (60 / s.bpm) * (s.beatsPerBar ?? 4);

/** The stems the state asks for. */
export function stemsFor(s: ScoreDef, holds: (c: Cond) => boolean): Id[] {
  const all = Object.keys(s.stems);
  for (const st of s.states ?? []) if (st.if === undefined || holds(st.if)) return st.stems.filter((x) => all.includes(x));
  return all;
}

/** The loop's window in seconds within a file of `duration` seconds. */
export function loopWindow(s: ScoreDef, duration: number): [number, number] {
  if (!s.loop) return [0, duration];
  const b = barSec(s);
  return [Math.min(duration, s.loop[0] * b), Math.min(duration, s.loop[1] * b)];
}

/**
 * Where the music is at `p` seconds after the score started, in seconds of the file: straight through the first
 * pass, then round the loop `[a, b)` (a file that does not loop back to 0 replays only its loop).
 */
export function positionAt(p: number, [a, b]: [number, number]): number {
  if (p < b) return p;
  return a + ((p - b) % (b - a));
}

/**
 * The first grid point at or after `t` (seconds on the audio clock) for a score started at `start`: a beat or a bar
 * of the music, counted in the file (so through the loop: a loop that is not a whole number of bars restarts the
 * count where it restarts the music, and the loop's start is always a point of the grid). `duration` is the file's
 * length; `lead`, the least time a change needs to be scheduled ahead (a boundary closer than that moves on).
 */
export function nextBoundary(s: ScoreDef, start: number, t: number, unit: 'beat' | 'bar' = s.quantize ?? 'bar', lead = 0, duration = Infinity): number {
  const u = unit === 'beat' ? beatSec(s) : barSec(s);
  const from = t + lead;
  if (from <= start) return start;
  const [a, b] = loopWindow(s, duration);
  const p = from - start;
  const eps = 1e-9;
  // In the first pass: the next multiple of the unit, unless the loop's end comes first.
  if (p < b) {
    const k = Math.ceil(p / u - eps) * u;
    return start + Math.min(k, b);
  }
  // Round the loop: cycles of length L from `b`; inside one, the grid is the file's grid from `a`.
  const L = b - a;
  const n = Math.floor((p - b) / L);
  const cycle = b + n * L; // when this pass of the loop began (time since start)
  const m = a + (p - cycle); // where the file is
  const k = Math.ceil(m / u - eps) * u;
  return start + (k < b ? cycle + (k - a) : cycle + L);
}

/** One gain change: a stem from its gain to another, ramped linearly between two instants of the audio clock. */
export interface GainStep { stem: Id; from: number; to: number; at: number; until: number }

/** The ramps that take the mix from `prev` to `next` at a boundary, over `fadeBeats`. Stems already right: none. */
export function crossfade(s: ScoreDef, prev: Id[], next: Id[], at: number): GainStep[] {
  const until = at + (s.fadeBeats ?? 2) * beatSec(s);
  const out: GainStep[] = [];
  for (const stem of Object.keys(s.stems)) {
    const a = prev.includes(stem) ? 1 : 0, b = next.includes(stem) ? 1 : 0;
    if (a !== b) out.push({ stem, from: a, to: b, at, until });
  }
  return out;
}
