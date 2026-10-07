// The Rooms tab's stage editor (4.1.11 "Viewport", programme §7.6): the room's layers (depth, parallax, opacity,
// blend), its occlusion masks drawn as polygons on the backdrop, its walk zones and the links (portals) between
// them. It edits the layout's stage geometry (`layout.layers`, `occluders`, `walkZones`, `walkLinks`) and writes it
// through the same PUT the placement view saves with, after the view's own changes are flushed. What the validator
// refuses (src/engine/tools/validate-stage.ts: a mask that closes no surface, a zone with no portal) is said here and
// keeps Save disabled.
import type { Id, Layout, Point } from '@engine/core/types';
import { closesSurface, zonesWithoutPortal } from '@engine/tools/validate-stage';
import { api, imgUrl, type RoomData } from './api';
import { append, h, select, toast } from './ui';

/** What the editor reads from the Rooms tab and tells it. */
export interface StageHost {
  room(): Id;
  data(): RoomData | null;
  /** Saves what the placement view holds first (its own layout changes). */
  flushEditor(): Promise<void>;
  /** After a write: our own (the watcher's echo is not news), the room reloaded, Check run. */
  written(): void;
}

type Drawing = { kind: 'mask' | 'zone'; points: Point[] } | { kind: 'link'; from: Id; to: Id; points: Point[] } | null;
type LinkMode = 'walk' | 'stairs' | 'ladder' | 'jump' | 'teleport';
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
/** The first id `base1`, `base2`… not in `taken`. */
const freshId = (base: string, taken: object | undefined) => {
  let n = 1;
  while (taken && `${base}${n}` in taken) n++;
  return `${base}${n}`;
};

export class StageEditor {
  readonly el = h('section', { class: 'stage-editor' });
  /** The layout being edited: its stage geometry only is written back. */
  draft: Layout = {};
  private drawing: Drawing = null;
  private message = '';
  private linkMode: LinkMode = 'stairs';
  private surface = svg('svg', { class: 'stage-surface', role: 'img' }) as SVGSVGElement;

  constructor(private host: StageHost) {
    this.surface.addEventListener('click', (e) => this.onClick(e as MouseEvent));
  }

  /** A new room or a reload: the draft is the layout as saved. */
  load() {
    const d = this.host.data();
    this.draft = structuredClone(d?.layout ?? {});
    this.drawing = null;
    this.message = '';
    this.render();
  }

  /** What the validator would refuse in the draft. */
  issues(): string[] {
    const L = this.draft;
    return [
      ...Object.entries(L.occluders ?? {})
        .filter(([, o]) => o.polygon && !closesSurface(o.polygon))
        .map(([id]) => `mask "${id}": the polygon does not close a surface`),
      ...zonesWithoutPortal(L).map((z) => `no walk link (portal) joins walk zone "${z}" to another`),
    ];
  }

  private get width() {
    return Math.max(640, this.draft.width ?? 640);
  }

  /** A click on the surface, in the room's logical units. */
  private onClick(e: MouseEvent) {
    if (!this.drawing) return;
    const r = this.surface.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const p: Point = [
      Math.round(((e.clientX - r.left) / r.width) * this.width),
      Math.round(((e.clientY - r.top) / r.height) * 400),
    ];
    this.drawing.points.push(p);
    if (this.drawing.kind === 'link' && this.drawing.points.length === 2) this.finishLink();
    else this.render();
  }

  private start(d: NonNullable<Drawing>) {
    this.drawing = d;
    this.message =
      d.kind === 'link'
        ? `Click where the link leaves "${d.from}", then where it arrives in "${d.to}".`
        : 'Click the corners on the backdrop, then Close the polygon.';
    this.render();
  }

  /** Ends a mask or a zone: kept only when it closes a surface. */
  private close() {
    const d = this.drawing;
    if (!d || d.kind === 'link') return;
    if (!closesSurface(d.points)) {
      this.message =
        'The polygon does not close a surface yet (three distinct points, an area, no edge crossing another).';
      this.render();
      return;
    }
    if (d.kind === 'mask') {
      const id = freshId('mask', this.draft.occluders);
      (this.draft.occluders ??= {})[id] = { polygon: d.points, z: 300 };
      this.message = `Mask "${id}" added (depth 300: whoever stands above y = 300 passes behind).`;
    } else {
      const id = freshId('zone', this.draft.walkZones);
      (this.draft.walkZones ??= {})[id] = { area: d.points };
      this.message = `Walk zone "${id}" added.`;
    }
    this.drawing = null;
    this.render();
  }

  private finishLink() {
    const d = this.drawing;
    if (d?.kind !== 'link') return;
    const [a, b] = d.points as [Point, Point];
    const id = freshId('link', this.draft.walkLinks);
    (this.draft.walkLinks ??= {})[id] = {
      from: { zone: d.from, at: a },
      to: { zone: d.to, at: b },
      mode: this.linkMode,
    };
    this.drawing = null;
    this.message = `Link "${id}" (${this.linkMode}) from "${d.from}" to "${d.to}" added.`;
    this.render();
  }

  /** Writes the stage geometry: the view's changes saved first, then the room's latest layout with ours on top. */
  async save() {
    if (this.issues().length) return;
    const room = this.host.room();
    try {
      await this.host.flushEditor();
      const latest = (await api.room(room)).layout;
      const { layers, occluders, walkZones, walkLinks } = this.draft;
      await api.setLayout(room, { ...latest, layers, occluders, walkZones, walkLinks });
      toast('Stage saved');
      this.host.written();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  // -------------------------------------------------------------- rendering

  render() {
    const d = this.host.data();
    if (!d) return;
    const issues = this.issues();
    this.el.replaceChildren();
    append(this.el, [
      h('h3', null, 'Layers, masks, zones ', h('span', { class: 'muted small' }, 'stage geometry')),
      this.drawSurface(d),
      this.message ? h('p', { class: 'muted small', role: 'status' }, this.message) : null,
      this.drawing && this.drawing.kind !== 'link'
        ? h(
            'div',
            { class: 'row' },
            h('button', { class: 'small primary', onclick: () => this.close() }, 'Close the polygon'),
            h(
              'button',
              { class: 'small', onclick: () => ((this.drawing = null), (this.message = ''), this.render()) },
              'Cancel',
            ),
          )
        : null,
      this.layersBlock(d),
      this.masksBlock(),
      this.zonesBlock(),
      issues.length
        ? h(
            'ul',
            { class: 'issues' },
            issues.map((x) => h('li', { class: 'error' }, x)),
          )
        : null,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'primary',
            disabled: issues.length > 0,
            title: issues.length ? 'The validator would refuse this stage' : 'Write the stage geometry to the layout',
            onclick: () => void this.save(),
          },
          'Save stage',
        ),
        h('button', { class: 'small', onclick: () => this.load() }, 'Revert'),
      ),
    ]);
  }

  /** The backdrop with the masks (red), the zones (green), the links and the polygon being drawn. */
  private drawSurface(d: RoomData) {
    const s = this.surface,
      L = this.draft,
      W = this.width;
    s.setAttribute('viewBox', `0 0 ${W} 400`);
    s.setAttribute('aria-label', `The backdrop of ${d.def.name}: masks, walk zones and links`);
    s.replaceChildren();
    s.append(
      svg('image', {
        href: imgUrl(d.def.decor),
        x: 0,
        y: 0,
        width: W,
        height: 400,
        preserveAspectRatio: 'xMidYMid slice',
      }),
    );
    const poly = (pts: Point[], cls: string, closed = true) =>
      svg(closed ? 'polygon' : 'polyline', { points: pts.map((p) => p.join(',')).join(' '), class: cls });
    for (const [id, z] of Object.entries(L.walkZones ?? {})) {
      const p = poly(z.area, 'zone');
      p.setAttribute('data-zone', id);
      s.append(p);
    }
    for (const [id, o] of Object.entries(L.occluders ?? {}))
      if (o.polygon) {
        const p = poly(o.polygon, 'mask');
        p.setAttribute('data-mask', id);
        s.append(p);
      }
    for (const [id, k] of Object.entries(L.walkLinks ?? {}))
      s.append(
        svg('line', {
          x1: k.from.at[0],
          y1: k.from.at[1],
          x2: k.to.at[0],
          y2: k.to.at[1],
          class: 'link',
          'data-link': id,
        }),
      );
    if (this.drawing?.points.length) s.append(poly(this.drawing.points, 'drawing', false));
    s.classList.toggle('drawing', !!this.drawing);
    return s;
  }

  private layersBlock(d: RoomData) {
    const L = this.draft;
    const ids = ['decor', ...(d.def.stage?.layers ?? []).map((l) => l.id)];
    const num = (id: Id, label: string, get: () => number, set: (v: number) => void, step = 1) =>
      h(
        'label',
        { class: 'small' },
        `${label} `,
        (() => {
          const i = h('input', { type: 'number', step, value: String(get()), 'aria-label': `${id} ${label}` });
          i.addEventListener('change', () => {
            const v = Number(i.value);
            if (Number.isFinite(v)) set(v);
          });
          return i;
        })(),
      );
    const g = (id: Id) => ((L.layers ??= {})[id] ??= {});
    return h(
      'div',
      { class: 'block' },
      h('h4', null, 'Layers'),
      h(
        'ul',
        { class: 'layers' },
        ids.map((id) => {
          const role = d.def.stage?.layers?.find((l) => l.id === id)?.role ?? 'backdrop';
          const cur = L.layers?.[id] ?? {};
          return h(
            'li',
            { 'data-layer': id },
            h('b', null, id),
            h('span', { class: 'muted small' }, ` ${role} `),
            num(
              id,
              'z',
              () => cur.z ?? 0,
              (v) => (g(id).z = v),
            ),
            num(
              id,
              'parallax x',
              () => cur.parallax?.[0] ?? 1,
              (v) => (g(id).parallax = [v, g(id).parallax?.[1] ?? 1]),
              0.05,
            ),
            num(
              id,
              'parallax y',
              () => cur.parallax?.[1] ?? 1,
              (v) => (g(id).parallax = [g(id).parallax?.[0] ?? 1, v]),
              0.05,
            ),
            num(
              id,
              'opacity',
              () => cur.opacity ?? 1,
              (v) => (g(id).opacity = Math.max(0, Math.min(1, v))),
              0.05,
            ),
            select(
              [
                ['normal', 'normal'],
                ['multiply', 'multiply'],
                ['screen', 'screen'],
                ['overlay', 'overlay'],
              ],
              cur.blend ?? 'normal',
              (v) => (g(id).blend = v as 'normal'),
              { 'aria-label': `${id} blend` },
            ),
          );
        }),
      ),
    );
  }

  private masksBlock() {
    const L = this.draft;
    return h(
      'div',
      { class: 'block' },
      h('h4', null, 'Occlusion masks'),
      h(
        'ul',
        null,
        Object.entries(L.occluders ?? {}).map(([id, o]) =>
          h(
            'li',
            { 'data-mask': id },
            h('b', null, id),
            ` ${o.polygon ? `${o.polygon.length} points` : o.mask ? `image ${o.mask}` : `layer ${o.layer}`} `,
            h(
              'label',
              { class: 'small' },
              'depth ',
              (() => {
                const i = h('input', { type: 'number', value: String(o.z), 'aria-label': `${id} depth` });
                i.addEventListener('change', () => {
                  if (Number.isFinite(Number(i.value))) o.z = Number(i.value);
                });
                return i;
              })(),
            ),
            h('button', { class: 'small', onclick: () => (delete L.occluders![id], this.render()) }, 'Delete'),
          ),
        ),
      ),
      h('button', { class: 'small', onclick: () => this.start({ kind: 'mask', points: [] }) }, 'Draw a mask'),
    );
  }

  private zonesBlock() {
    const L = this.draft;
    const zones = Object.keys(L.walkZones ?? {});
    let from = zones[0] ?? '',
      to = zones[1] ?? zones[0] ?? '';
    return h(
      'div',
      { class: 'block' },
      h('h4', null, 'Walk zones and links'),
      h(
        'ul',
        null,
        zones.map((id) =>
          h(
            'li',
            { 'data-zone': id },
            h('b', null, id),
            ` ${L.walkZones![id]!.area.length} points `,
            h('button', { class: 'small', onclick: () => (delete L.walkZones![id], this.render()) }, 'Delete'),
          ),
        ),
        Object.entries(L.walkLinks ?? {}).map(([id, k]) =>
          h(
            'li',
            { 'data-link': id },
            h('b', null, id),
            ` ${k.from.zone} → ${k.to.zone} (${k.mode}${k.oneWay ? ', one way' : ''}) `,
            h('button', { class: 'small', onclick: () => (delete L.walkLinks![id], this.render()) }, 'Delete'),
          ),
        ),
      ),
      h('button', { class: 'small', onclick: () => this.start({ kind: 'zone', points: [] }) }, 'Draw a zone'),
      zones.length > 1
        ? h(
            'div',
            { class: 'row' },
            select(
              zones.map((z) => [z, z]),
              from,
              (v) => (from = v),
              { 'aria-label': 'Link from' },
            ),
            select(
              zones.map((z) => [z, z]),
              to,
              (v) => (to = v),
              { 'aria-label': 'Link to' },
            ),
            select(
              (['walk', 'stairs', 'ladder', 'jump', 'teleport'] as const).map((m) => [m, m]),
              this.linkMode,
              (v) => (this.linkMode = v as LinkMode),
              { 'aria-label': 'Link mode' },
            ),
            h(
              'button',
              { class: 'small', onclick: () => from !== to && this.start({ kind: 'link', from, to, points: [] }) },
              'Link them',
            ),
          )
        : null,
    );
  }
}
