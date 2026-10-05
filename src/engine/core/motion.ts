// Stage physics (3.4): motions computed, never simulated. Each one is a closed form of time (an arc, a damped spring,
// a Catmull-Rom spline, a fixed offset from a leader), so the same command draws the same flight on every device and
// every frame rate, and nothing logical depends on a collision. A motion only moves a picture: the state it leaves is
// the end position of a character (like `place`); a prop lands where its motion ends until the room is entered again.
// A puzzle effect is the next command (`{ hide }`, `{ prop }`, `{ set }`).
import type { Point } from './types';

export type MotionSpec =
  /** `from` absent: where the target stands; `height` absent: a third of the distance. */
  | { kind: 'launch'; from?: Point; to: Point; height?: number; ms: number; rotate: number }
  | { kind: 'spring'; axis: 'x' | 'y' | 'rot'; amplitude: number; frequency: number; damping: number; ms: number }
  | { kind: 'path'; points: Point[]; ms: number; orient: boolean }
  | { kind: 'follow'; offset: Point; ms: number };

/** Where a motion has its target at `t` ∈ [0, 1]: an offset from its rest (spring) or a position, and a rotation. */
export interface MotionFrame { at?: Point; dx?: number; dy?: number; rot: number }

/** Ease in-out for paths (a start and an arrival without a jolt). */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** A ballistic arc from `from` to `to`, peaking `height` above the straight line at mid-flight. */
export function arc(from: Point, to: Point, height: number, t: number): Point {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t - 4 * height * t * (1 - t)];
}

/** A damped oscillation: amplitude × e^(−ζωt) × cos(ω√(1−ζ²) t), t in seconds, frequency in hertz. */
export function spring(amplitude: number, frequency: number, damping: number, seconds: number): number {
  const w = 2 * Math.PI * frequency, z = Math.min(0.999, Math.max(0, damping));
  return amplitude * Math.exp(-z * w * seconds) * Math.cos(w * Math.sqrt(1 - z * z) * seconds);
}

/** A point on a Catmull-Rom spline through `pts` at `t` ∈ [0, 1] (uniform per segment). */
export function spline(pts: Point[], t: number): Point {
  if (pts.length === 1) return pts[0];
  const n = pts.length - 1, f = Math.min(n - 1e-9, Math.max(0, t * n)), i = Math.floor(f), u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u * u + (-a + 3 * b - 3 * cc + d) * u * u * u);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}

/** The frame of a motion at `t` ∈ [0, 1] of its duration. */
export function motionAt(m: MotionSpec, t: number): MotionFrame {
  const k = Math.max(0, Math.min(1, t));
  switch (m.kind) {
    case 'launch': { const from = m.from ?? m.to; return { at: arc(from, m.to, m.height ?? Math.hypot(m.to[0] - from[0], m.to[1] - from[1]) / 3, k), rot: m.rotate * k }; }
    case 'spring': { const v = k >= 1 ? 0 : spring(m.amplitude, m.frequency, m.damping, (k * m.ms) / 1000); return m.axis === 'rot' ? { rot: v } : m.axis === 'x' ? { dx: v, rot: 0 } : { dy: v, rot: 0 }; }
    case 'path': {
      const e = ease(k), at = spline(m.points, e);
      if (!m.orient) return { at, rot: 0 };
      const b = spline(m.points, Math.min(1, e + 0.01)), a = spline(m.points, Math.max(0, e - 0.01));
      return { at, rot: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
    }
    case 'follow': return { dx: m.offset[0], dy: m.offset[1], rot: 0 };
  }
}

/** Where a motion leaves its target (null: back to rest, a spring; a follower keeps its leader's offset). */
export function motionEnd(m: MotionSpec): Point | null {
  return m.kind === 'launch' ? m.to : m.kind === 'path' ? m.points[m.points.length - 1] : null;
}
