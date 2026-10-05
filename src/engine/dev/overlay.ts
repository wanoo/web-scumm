import type { App } from '../dom/app';
import type { Id, Layout, Point } from '../core/types';

const NS = 'http://www.w3.org/2000/svg';

/** Draggable handle in the editor (serialised in the data-h attribute). */
export type Handle =
  | { t: 'hs-move'; id: Id }
  | { t: 'hs-corner'; id: Id; c: number }
  | { t: 'hs-vert'; id: Id; i: number }
  | { t: 'approach'; kind: 'hs' | 'prop' | 'actor'; id: Id }
  | { t: 'prop-pos'; id: Id }
  | { t: 'prop-h'; id: Id }
  | { t: 'actor-pos'; id: Id }
  | { t: 'actor-h'; id: Id }
  | { t: 'entry'; name: string }
  | { t: 'walk'; hole: number; i: number }
  | { t: 'scale'; k: 0 | 1 }
  // The stage's geometry (3.4): walk zones and links, layers, occluders, lights, particle areas.
  | { t: 'zone'; zone: Id; hole: number; i: number }
  | { t: 'link'; id: Id; end: 'from' | 'to' }
  | { t: 'layer'; id: Id }
  | { t: 'occ'; id: Id; i: number }
  | { t: 'light'; id: Id; part: 'at' | 'r' }
  | { t: 'emit'; id: Id; c: number };

export interface OverlayOptions {
  /** Active handles (editor) or just drawing (?dev). */
  edit: boolean;
  /** Also show invisible zones (false conditions). */
  all: boolean;
  selected?: string;
}

/** SVG layer in logical 640 × 400 coordinates, laid over the scene. */
export class Overlay {
  readonly svg: SVGSVGElement;
  visible = true;

  constructor(
    private app: App,
    public o: OverlayOptions,
  ) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 640 400');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    Object.assign(this.svg.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '2000',
      pointerEvents: o.edit ? 'all' : 'none',
      touchAction: 'none',
    });
    app.scene.append(this.svg);
  }

  /** Geometry of the shown room (created if the room has no layout yet). */
  layout(): Layout {
    const room = this.app.view.room;
    const eng = this.app.engine;
    if (!eng.layouts[room.id]) eng.layouts[room.id] = { entries: { default: [320, 360] } };
    return eng.layouts[room.id];
  }

  toLogical(e: { clientX: number; clientY: number }): Point {
    const r = this.app.scene.getBoundingClientRect();
    return this.app.view.toLogical((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.svg.style.display = v ? '' : 'none';
    if (v) this.draw();
  }

  /** Pans with the camera of a wide room. */
  pan(cam: number) {
    this.svg.setAttribute('viewBox', `${cam} 0 640 400`);
  }

  draw() {
    if (!this.visible || !this.app.view.room) return;
    const svg = this.svg;
    svg.replaceChildren();
    const room = this.app.view.room;
    const L = this.layout();
    const eng = this.app.engine;
    const E = this.o.edit;
    const add = (tag: string, attrs: Record<string, string | number>, h?: Handle | object, parent: Element = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (h) e.setAttribute('data-h', JSON.stringify(h));
      if (tag !== 'text') e.setAttribute('vector-effect', 'non-scaling-stroke');
      e.style.pointerEvents = h && E ? 'all' : 'none';
      if (h && E) e.style.cursor = 'move';
      parent.append(e);
      return e;
    };
    const label = (x: number, y: number, text: string, color: string) => {
      const t = add('text', {
        x,
        y,
        fill: color,
        'font-size': 9,
        'font-family': 'monospace',
        'paint-order': 'stroke',
        stroke: '#000',
        'stroke-width': 2.5,
      });
      t.textContent = text;
    };
    const dot = (p: Point, color: string, h?: Handle, r = 4, hollow = false) =>
      add(
        'circle',
        { cx: p[0], cy: p[1], r, fill: hollow ? 'none' : color, stroke: hollow ? color : '#000', 'stroke-width': 1.5 },
        h,
      );
    const poly = (pts: Point[], attrs: Record<string, string | number>) =>
      add('polygon', { points: pts.map((p) => p.join(',')).join(' '), ...attrs });
    const sel = (key: string) => this.o.selected === key;

    // background that catches clicks in edit mode (otherwise the game would react)
    if (E) add('rect', { x: 0, y: 0, width: 640, height: 400, fill: 'transparent' }, { t: 'bg' });

    // depth scale
    if (L.scale) {
      L.scale.forEach(([y, s], k) => {
        add(
          'line',
          { x1: 0, x2: 640, y1: y, y2: y, stroke: '#ff9f43', 'stroke-width': E ? 3 : 1, 'stroke-dasharray': '6 4' },
          E ? { t: 'scale', k } : undefined,
        );
        label(4, y - 3, `scale ${s} @ y=${Math.round(y)}`, '#ff9f43');
      });
    }

    // several floors (3.4): every walk zone (its vertices and edges are handles), and each link between its ends
    for (const [zid, z] of Object.entries(L.walkZones ?? {}))
      for (const [ri, ring] of [z.area, ...(z.holes ?? [])].entries()) {
        const hole = ri - 1;
        poly(ring, {
          fill: hole >= 0 ? 'rgba(255,60,60,.18)' : 'rgba(80,220,120,.12)',
          stroke: hole >= 0 ? '#ff5050' : '#50dc78',
          'stroke-width': 1.5,
        });
        if (hole < 0)
          label(
            ring[0][0] + 3,
            ring[0][1] + 10,
            `zone ${zid}${z.zoom && z.zoom !== 1 ? ` ×${z.zoom}` : ''}`,
            '#50dc78',
          );
        if (E) {
          ring.forEach((p, i) => {
            const q = ring[(i + 1) % ring.length];
            add(
              'line',
              { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: 'transparent', 'stroke-width': 10 },
              { t: 'zedge', zone: zid, hole, i },
            );
          });
          ring.forEach((p, i) => dot(p, hole >= 0 ? '#ff5050' : '#50dc78', { t: 'zone', zone: zid, hole, i }, 3.5));
        }
      }
    for (const [id, k] of Object.entries(L.walkLinks ?? {})) {
      add('line', {
        x1: k.from.at[0],
        y1: k.from.at[1],
        x2: k.to.at[0],
        y2: k.to.at[1],
        stroke: '#ffd84d',
        'stroke-width': 2,
        'stroke-dasharray': '4 3',
      });
      label((k.from.at[0] + k.to.at[0]) / 2 + 4, (k.from.at[1] + k.to.at[1]) / 2, `${k.mode} ${id}`, '#ffd84d');
      dot(k.from.at, '#ffd84d', E ? { t: 'link', id, end: 'from' } : undefined, 4);
      dot(k.to.at, '#ffd84d', E ? { t: 'link', id, end: 'to' } : undefined, 4, true);
    }
    // the stage: layer boxes, occluder polygons, lights, particle areas
    const st = room.stage ? this.app.view.stageSpec() : null;
    for (const l of st?.layers ?? []) {
      const c = sel(`layer:${l.id}`) ? '#ffd84d' : '#c08bff';
      add(
        'rect',
        {
          x: l.x,
          y: l.y,
          width: l.w,
          height: l.h,
          fill: 'rgba(192,139,255,.05)',
          stroke: c,
          'stroke-width': 1,
          'stroke-dasharray': l.visible ? '6 3' : '1 3',
        },
        E ? { t: 'layer', id: l.id } : undefined,
      );
      label(
        l.x + 3,
        l.y + 10,
        `${l.role} ${l.id} z${Math.round(l.z)}${l.parallax[0] !== 1 ? ` ⇆${l.parallax[0]}` : ''}`,
        c,
      );
    }
    for (const [id, o] of Object.entries(L.occluders ?? {}))
      if (o.polygon) {
        const c = sel(`occ:${id}`) ? '#ffd84d' : '#ff9f43';
        poly(o.polygon, { fill: 'rgba(255,159,67,.12)', stroke: c, 'stroke-width': 1.5, 'stroke-dasharray': '3 2' });
        label(o.polygon[0][0] + 3, o.polygon[0][1] - 3, `occluder ${id} z${o.z}`, c);
        if (E) o.polygon.forEach((p, i) => dot(p, c, { t: 'occ', id, i }, 3.5));
      }
    for (const [id, g] of Object.entries(L.lights ?? {})) {
      add('circle', {
        cx: g.at[0],
        cy: g.at[1],
        r: g.radius,
        fill: 'rgba(255,220,120,.08)',
        stroke: '#ffdc78',
        'stroke-width': 1,
        'stroke-dasharray': '2 3',
      });
      dot(g.at, '#ffdc78', E ? { t: 'light', id, part: 'at' } : undefined, 4);
      if (E) dot([g.at[0] + g.radius, g.at[1]], '#ffdc78', { t: 'light', id, part: 'r' }, 3, true);
      label(g.at[0] + 6, g.at[1] - 6, `light ${id}`, '#ffdc78');
    }
    for (const [id, m] of Object.entries(L.emitters ?? {})) {
      const [x, y, w, hh] = m.area;
      add(
        'rect',
        {
          x,
          y,
          width: w,
          height: hh,
          fill: 'rgba(160,220,255,.05)',
          stroke: '#a0dcff',
          'stroke-width': 1,
          'stroke-dasharray': '2 2',
        },
        E ? { t: 'emit', id, c: -1 } : undefined,
      );
      if (E)
        [
          [x, y],
          [x + w, y],
          [x + w, y + hh],
          [x, y + hh],
        ].forEach((p, c) =>
          add(
            'rect',
            { x: p[0] - 3, y: p[1] - 3, width: 6, height: 6, fill: '#a0dcff', stroke: '#000' },
            { t: 'emit', id, c },
          ),
        );
      label(x + 3, y + hh - 3, `particles ${id}`, '#a0dcff');
    }
    // walkable zone
    if (L.walk && !L.walkZones) {
      const rings: Point[][] = [L.walk.area, ...(L.walk.holes ?? [])];
      rings.forEach((ring, ri) => {
        const hole = ri - 1;
        poly(ring, {
          fill: hole < 0 ? 'rgba(80,220,120,.12)' : 'rgba(255,60,60,.18)',
          stroke: hole < 0 ? '#50dc78' : '#ff5050',
          'stroke-width': 1.5,
        });
        if (E) {
          ring.forEach((p, i) => {
            const q = ring[(i + 1) % ring.length];
            add(
              'line',
              { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: 'transparent', 'stroke-width': 10 },
              { t: 'edge', hole, i },
            );
          });
          ring.forEach((p, i) => dot(p, hole < 0 ? '#50dc78' : '#ff5050', { t: 'walk', hole, i }, 3.5));
        }
      });
    }

    // hotspots
    for (const [id, h] of Object.entries(L.hotspots ?? {})) {
      const vis = room.hotspots?.[id] ? eng.visible(id, room) : true;
      if (!vis && !this.o.all) continue;
      const color = sel(`hs:${id}`) ? '#ffd84d' : '#58c8ff';
      const dash = vis ? '' : '4 3';
      if (h.rect) {
        const [x, y, w, hh] = h.rect;
        add(
          'rect',
          {
            x,
            y,
            width: w,
            height: hh,
            fill: 'rgba(88,200,255,.08)',
            stroke: color,
            'stroke-width': 1.5,
            'stroke-dasharray': dash,
          },
          E ? { t: 'hs-move', id } : undefined,
        );
        if (E)
          [
            [x, y],
            [x + w, y],
            [x + w, y + hh],
            [x, y + hh],
          ].forEach((p, c) =>
            add(
              'rect',
              { x: p[0] - 3.5, y: p[1] - 3.5, width: 7, height: 7, fill: color, stroke: '#000' },
              { t: 'hs-corner', id, c },
            ),
          );
        label(x + 2, y + 10, id, color);
      } else if (h.poly) {
        poly(h.poly, { fill: 'rgba(88,200,255,.08)', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': dash });
        if (E) h.poly.forEach((p, i) => dot(p, color, { t: 'hs-vert', id, i }, 3.5));
        label(h.poly[0][0], h.poly[0][1] - 3, id, color);
      }
      const ap = h.approach ?? eng.approach(id, room);
      if (ap) dot(ap, '#58c8ff', E ? { t: 'approach', kind: 'hs', id } : undefined, 3, !h.approach);
    }

    // props
    for (const [id, p0] of Object.entries(L.props ?? {})) {
      const st = eng.propState(id, room);
      const ov = st ? p0.states?.[st] : undefined;
      const x = ov?.x ?? p0.x,
        y = ov?.y ?? p0.y,
        h = ov?.h ?? p0.h;
      const vis = room.props?.[id] ? eng.visible(id, room) || !room.props[id].visible : true;
      if (!vis && !this.o.all) continue;
      const color = sel(`prop:${id}`) ? '#ffd84d' : '#d29bff';
      const b = this.app.view.box(id);
      if (b)
        add('rect', {
          x: b[0],
          y: b[1],
          width: b[2],
          height: b[3],
          fill: 'none',
          stroke: color,
          'stroke-width': 1,
          'stroke-dasharray': vis ? '3 2' : '1 3',
        });
      add('line', { x1: x, y1: y, x2: x, y2: y - h, stroke: color, 'stroke-width': 1 });
      dot([x, y], color, E ? { t: 'prop-pos', id } : undefined, 4.5);
      if (E)
        add(
          'rect',
          { x: x - 3.5, y: y - h - 3.5, width: 7, height: 7, fill: color, stroke: '#000' },
          { t: 'prop-h', id },
        );
      label(x + 6, y - 4, `${id}${st && p0.states?.[st] ? ` [${st}]` : ''}`, color);
      const ap = ov?.approach ?? p0.approach ?? eng.approach(id, room);
      if (ap && room.props?.[id]?.name)
        dot(ap, color, E ? { t: 'approach', kind: 'prop', id } : undefined, 3, !(ov?.approach ?? p0.approach));
    }

    // actors
    for (const [id, a] of Object.entries(L.actors ?? {})) {
      const color = sel(`actor:${id}`) ? '#ffd84d' : '#8fe36a';
      const char = room.actors?.[id] ? eng.game.characters[room.actors[id].char] : undefined;
      const h = a.h ?? char?.height ?? eng.game.skin?.heights?.actor ?? 110;
      const b = this.app.view.box(id);
      if (b)
        add('rect', {
          x: b[0],
          y: b[1],
          width: b[2],
          height: b[3],
          fill: 'none',
          stroke: color,
          'stroke-width': 1,
          'stroke-dasharray': '3 2',
        });
      add('line', { x1: a.x, y1: a.y, x2: a.x, y2: a.y - h, stroke: color, 'stroke-width': 1 });
      dot([a.x, a.y], color, E ? { t: 'actor-pos', id } : undefined, 4.5);
      if (E)
        add(
          'rect',
          { x: a.x - 3.5, y: a.y - h - 3.5, width: 7, height: 7, fill: color, stroke: '#000' },
          { t: 'actor-h', id },
        );
      label(a.x + 6, a.y - 4, id, color);
      const ap = a.approach ?? eng.approach(id, room);
      if (ap) dot(ap, color, E ? { t: 'approach', kind: 'actor', id } : undefined, 3, !a.approach);
    }

    // entry points
    for (const [name, p] of Object.entries(L.entries ?? {})) {
      add(
        'path',
        {
          d: `M${p[0] - 6} ${p[1]} L${p[0]} ${p[1] - 9} L${p[0] + 6} ${p[1]} Z`,
          fill: '#ff6fb5',
          stroke: '#000',
          'stroke-width': 1,
        },
        E ? { t: 'entry', name } : undefined,
      );
      label(p[0] + 7, p[1] + 3, `entry ${name}`, '#ff6fb5');
    }
  }
}
