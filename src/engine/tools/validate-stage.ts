// The stage's geometry, checked (4.1.11; out of tools/validate.ts): occluders, lights and emitters placed for
// something the room declares, walk links between known zones, every zone reachable, and two rules the Studio's stage
// editor (src/studio/rooms-stage.ts) applies before it saves: a mask polygon closes a surface, and in a room of several
// walk zones every zone has a link (a portal) to another.
import { must } from '../core/must';
import { inPolygon, stageOf } from '../core/stage';
import type { Id, Layout, Point, RoomDef } from '../core/types';

/** Whether a polygon closes a surface: three distinct points or more, an area, and no edge crossing another. */
export function closesSurface(poly: readonly Point[]): boolean {
  const pts = poly.filter((p, i) => i === 0 || p[0] !== poly[i - 1]![0] || p[1] !== poly[i - 1]![1]);
  const last = pts[pts.length - 1],
    first = pts[0];
  if (pts.length > 1 && last && first && last[0] === first[0] && last[1] === first[1]) pts.pop();
  if (new Set(pts.map((p) => `${p[0]},${p[1]}`)).size < 3) return false;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!,
      [x1, y1] = pts[(i + 1) % pts.length]!;
    area += x0 * y1 - x1 * y0;
  }
  if (Math.abs(area) < 1e-9) return false;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const n = pts.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a vertex
      const a = pts[i]!,
        b = pts[(i + 1) % n]!,
        c = pts[j]!,
        d = pts[(j + 1) % n]!;
      const d1 = cross(a, b, c),
        d2 = cross(a, b, d),
        d3 = cross(c, d, a),
        d4 = cross(c, d, b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return false;
    }
  return true;
}

/** In a room of several walk zones, the zones no link touches (a single zone needs none). */
export function zonesWithoutPortal(L: Layout): Id[] {
  const zones = Object.keys(L.walkZones ?? {});
  if (zones.length < 2) return [];
  const linked = new Set(Object.values(L.walkLinks ?? {}).flatMap((k) => [k.from.zone, k.to.zone]));
  return zones.filter((z) => !linked.has(z));
}

interface Report {
  err(where: string, msg: string): void;
  warn(where: string, msg: string): void;
  img(id: Id | undefined, where: string): void;
}

/** The layout's stage geometry of room `w` (`st`: the room's stage, `layerIds`: its layers and `decor`). */
export function stageLayoutChecks(
  w: string,
  r: RoomDef,
  L: Layout,
  st: RoomDef['stage'],
  layerIds: Set<Id>,
  { err, warn, img }: Report,
) {
  for (const [id, o] of Object.entries(L.occluders ?? {})) {
    const ow = `layout ${w}.occluders.${id}`;
    if (!o.polygon && !o.mask && !o.layer) err(ow, 'an occluder needs a polygon, a mask image or a layer');
    if (o.layer && !layerIds.has(o.layer)) err(ow, `no stage layer "${o.layer}"`);
    if (o.polygon && o.polygon.length < 3) err(ow, 'a polygon needs three points');
    else if (o.polygon && !closesSurface(o.polygon))
      err(ow, 'the polygon does not close a surface (three distinct points, an area, no edge crossing another)');
    img(o.mask, ow);
  }
  for (const id of Object.keys(L.lights ?? {}))
    if (!(st?.lights ?? []).some((l) => l.id === id))
      warn(`layout ${w}.lights.${id}`, `no stage light "${id}" in the room`);
  for (const id of Object.keys(L.emitters ?? {}))
    if (!(st?.emitters ?? []).some((e) => e.id === id))
      warn(`layout ${w}.emitters.${id}`, `no stage emitter "${id}" in the room`);
  if (L.walkZones && L.walk) warn(`layout ${w}`, 'both walk and walkZones: walkZones replace walk, which is ignored');
  const zones = new Set(Object.keys(L.walkZones ?? {}));
  for (const [id, k] of Object.entries(L.walkLinks ?? {}))
    for (const end of [k.from, k.to])
      if (!zones.has(end.zone)) err(`layout ${w}.walkLinks.${id}`, `unknown walk zone "${end.zone}"`);
  for (const [id, z] of Object.entries(L.walkZones ?? {}))
    if (z.area.length >= 3 && !closesSurface(z.area))
      err(
        `layout ${w}.walkZones.${id}`,
        'the zone does not close a surface (three distinct points, an area, no edge crossing another)',
      );
  for (const z of zonesWithoutPortal(L))
    err(`layout ${w}.walkZones.${z}`, `no walk link (portal) joins walk zone "${z}" to another`);
  // Every zone reachable from the zone of the default entry, all links open (a closed link is a puzzle, not a wall).
  if (L.walkZones && zones.size > 1) {
    const S = stageOf(r, L);
    const start =
      S.zones.find((z) => L.entries?.default && inPolygon(L.entries.default, z.area))?.id ??
      must(S.zones[0], 'first walk zone').id;
    const seen = new Set([start]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const k of S.links)
        for (const [a, b] of [
          [k.from.zone, k.to.zone] as const,
          ...(k.oneWay ? [] : [[k.to.zone, k.from.zone] as const]),
        ])
          if (seen.has(a) && !seen.has(b)) {
            seen.add(b);
            grew = true;
          }
    }
    for (const z of zones)
      if (!seen.has(z))
        err(
          `layout ${w}.walkZones.${z}`,
          `walk zone "${z}" cannot be reached from "${start}" (the zone of the default entry), even with every link open`,
        );
  }
}
