import earcut from 'earcut';
import NavMesh from 'navmesh';
import type { Layout, Point } from '../core/types';

/** A room's walkable zone: triangulated once, then shortest paths between two points. */
export class WalkArea {
  private mesh: NavMesh | null = null;
  private tris: Point[][] = [];

  constructor(layout: Layout) {
    const w = layout.walk;
    if (!w || w.area.length < 3) return;
    const flat: number[] = [];
    const holes: number[] = [];
    for (const p of w.area) flat.push(p[0], p[1]);
    for (const h of w.holes ?? []) { holes.push(flat.length / 2); for (const p of h) flat.push(p[0], p[1]); }
    const tri = earcut(flat, holes.length ? holes : undefined);
    const polys: { x: number; y: number }[][] = [];
    for (let i = 0; i < tri.length; i += 3) polys.push([0, 1, 2].map((k) => ({ x: flat[tri[i + k] * 2], y: flat[tri[i + k] * 2 + 1] })));
    this.tris = polys.map((t) => t.map((v) => [v.x, v.y] as Point));
    this.mesh = new NavMesh(polys);
  }

  /** Closest point inside the zone. */
  clamp(p: Point): Point {
    if (!this.mesh || this.mesh.isPointInMesh({ x: p[0], y: p[1] })) return p;
    // projection onto the nearest triangle edge, nudged in by half a pixel
    let best: Point = p, bd = Infinity;
    for (const t of this.tris) for (let i = 0; i < 3; i++) {
      const a = t[i], b = t[(i + 1) % 3];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
      const q: Point = [a[0] + dx * k, a[1] + dy * k];
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < bd) { bd = d; const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3; best = [q[0] + (cx - q[0]) * 0.02, q[1] + (cy - q[1]) * 0.02]; }
    }
    return best;
  }

  /** Path (successive points, excluding the start). With no defined zone: a straight line. */
  path(from: Point, to: Point): Point[] {
    if (!this.mesh) return [to];
    const a = this.clamp(from), b = this.clamp(to);
    const res = this.mesh.findPath({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
    if (!res || !res.length) return [b];
    return res.slice(1).map((v) => [v.x, v.y] as Point);
  }
}

/** A character's scale based on its depth (feet y). */
export function depthScale(layout: Layout, y: number): number {
  const s = layout.scale;
  if (!s) return 1;
  const [[y0, s0], [y1, s1]] = s;
  const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
  return s0 + (s1 - s0) * t;
}
