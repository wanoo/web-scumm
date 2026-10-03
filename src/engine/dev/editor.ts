import { Pane } from 'tweakpane';
import type { App } from '../dom/app';
import type { Id, Layout, Point } from '../core/types';
import { FLOOR } from '../core/define';
import { Overlay, type Handle } from './overlay';

type Drag = { h: Handle; start: Point; orig: unknown };

const clampPt = (p: Point): Point => [Math.max(0, Math.min(640, p[0])), Math.max(0, Math.min(400, p[1]))];

/** Rounds coordinates to the unit (scale factors keep two decimals). */
export function roundLayout(L: Layout): Layout {
  const r = (v: unknown): unknown => {
    if (typeof v === 'number') return Math.round(v);
    if (Array.isArray(v)) return v.map(r);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r(x)]));
    return v;
  };
  const out = r({ ...L, scale: undefined }) as Layout;
  if (L.scale) out.scale = L.scale.map(([y, s]) => [Math.round(y), Math.round(s * 100) / 100]) as Layout['scale'];
  else delete out.scale;
  return out;
}

/**
 * Placement editor (?edit=<room>): drag clickable zones, props, characters, approach and entry points,
 * the walkable zone and the scale with the mouse, then save the JSON layout (dev server only).
 */
export interface EditorOptions {
  /** Where a layout goes when there is no dev server (a Studio demo build): e.g. the demo's edits in this browser. */
  saveOffline?: (room: Id, layout: Layout) => void | Promise<void>;
}

export class Editor {
  readonly overlay: Overlay;
  private drag: Drag | null = null;
  private pane!: Pane;
  private selected = { item: '(none)', values: '' };
  private rebuilding = false;
  private rebuildAgain = false;
  private dirty = false;
  private status = { state: 'up to date' };

  constructor(private app: App, private opts: EditorOptions = {}) {
    this.overlay = new Overlay(app, { edit: true, all: true });
    const svg = this.overlay.svg;
    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => { e.stopPropagation(); this.move(e); });
    svg.addEventListener('pointerup', (e) => { e.stopPropagation(); this.up(); });
    svg.addEventListener('dblclick', (e) => { e.stopPropagation(); this.dbl(e); });
    svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('beforeunload', (e) => { if (this.dirty) e.preventDefault(); });
    this.buildPane();
    this.overlay.draw();
    this.bridge();
  }

  // -------------------------------------------------------------- Studio bridge
  // Inside the Studio (an iframe of /__studio/), the editor tells the parent page what is selected, whether the
  // layout has unsaved changes and when it was saved; the Studio can ask it to select, place or save something.

  private post(msg: Record<string, unknown>) {
    if (window.parent === window) return;
    window.parent.postMessage({ source: 'web-scumm-editor', room: this.room.id, ...msg }, location.origin);
  }

  private bridge() {
    if (window.parent === window) return;
    window.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as { source?: string; type?: string; kind?: 'prop' | 'hotspot' | 'actor'; id?: string; at?: Point };
      if (e.origin !== location.origin || m?.source !== 'web-scumm-studio') return;
      if (m.type === 'save') void this.save();
      else if ((m.type === 'select' || m.type === 'create') && m.kind && m.id) {
        if (m.type === 'create' && this.missing().some((x) => x.kind === m.kind && x.id === m.id)) this.addMissing({ kind: m.kind, id: m.id }, m.at);
        const key = `${m.kind === 'hotspot' ? 'hs' : m.kind}:${m.id}`;
        this.overlay.o.selected = key;
        this.selected.item = key;
        this.overlay.draw();
        this.pane?.refresh();
      }
    });
    this.post({ type: 'ready', missing: this.missing() });
  }

  private get L(): Layout { return this.overlay.layout(); }
  private get room() { return this.app.view.room; }

  // -------------------------------------------------------------- mouse

  private handleOf(e: Event): Handle | { t: 'bg' } | { t: 'edge'; hole: number; i: number } | null {
    const t = (e.target as Element).closest?.('[data-h]');
    return t ? JSON.parse(t.getAttribute('data-h')!) : null;
  }

  private down(e: PointerEvent) {
    e.stopPropagation(); e.preventDefault();
    const h = this.handleOf(e);
    if (!h || h.t === 'bg' || h.t === 'edge') return;
    const p = this.overlay.toLogical(e);
    // alt-click: remove a vertex (walkable zone or hotspot polygon)
    if (e.altKey && (h.t === 'walk' || h.t === 'hs-vert')) { this.removeVertex(h); return; }
    this.drag = { h, start: p, orig: structuredClone(this.snapshot(h)) };
    this.select(h);
    this.overlay.svg.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent) {
    if (!this.drag) return;
    const p = clampPt(this.overlay.toLogical(e));
    const d: Point = [p[0] - this.drag.start[0], p[1] - this.drag.start[1]];
    this.apply(this.drag.h, p, d, this.drag.orig);
    this.changed(this.drag.h);
  }

  private up() {
    if (!this.drag) return;
    const h = this.drag.h;
    this.drag = null;
    this.changed(h, true);
  }

  private dbl(e: MouseEvent) {
    const h = this.handleOf(e);
    if (!h || h.t !== 'edge') return;
    const ring = h.hole < 0 ? this.L.walk!.area : this.L.walk!.holes![h.hole];
    ring.splice(h.i + 1, 0, clampPt(this.overlay.toLogical(e)));
    this.changed({ t: 'walk', hole: h.hole, i: h.i + 1 }, true);
  }

  private wheel(e: WheelEvent) {
    const h = this.handleOf(e);
    if (!h || (h.t !== 'prop-pos' && h.t !== 'prop-h' && h.t !== 'actor-pos' && h.t !== 'actor-h')) return;
    e.preventDefault(); e.stopPropagation();
    const k = e.deltaY < 0 ? 1.04 : 1 / 1.04;
    if (h.t.startsWith('prop')) { const t = this.propTarget(h.id, 'h'); t.h = Math.max(4, (t.h ?? this.L.props![h.id].h) * k); }
    else { const a = this.L.actors![h.id]; a.h = Math.max(8, (a.h ?? this.charHeight(h.id)) * k); }
    this.changed(h, true);
  }

  private removeVertex(h: Handle) {
    if (h.t === 'walk') {
      const ring = h.hole < 0 ? this.L.walk!.area : this.L.walk!.holes![h.hole];
      if (ring.length > 3) ring.splice(h.i, 1);
      else if (h.hole >= 0) this.L.walk!.holes!.splice(h.hole, 1);
    } else if (h.t === 'hs-vert') {
      const poly = this.L.hotspots![h.id].poly!;
      if (poly.length > 3) poly.splice(h.i, 1);
    }
    this.changed(h, true);
  }

  // -------------------------------------------------------------- model

  private charHeight(id: Id) {
    const a = this.room.actors?.[id];
    return (a && this.app.engine.game.characters[a.char]?.height) ?? this.app.engine.game.skin?.heights?.actor ?? 110;
  }

  /** Object to modify for a prop: the current state's variant if it exists. */
  private propTarget(id: Id, field: 'pos' | 'h' | 'approach'): { x: number; y: number; h?: number; approach?: Point } {
    const p = this.L.props![id];
    const st = this.app.engine.propState(id, this.room);
    const ov = st ? p.states?.[st] : undefined;
    if (!ov) return p;
    if (field === 'h' && ov.h === undefined) return p;
    if (field === 'approach' && !ov.approach && p.approach) return p;
    return ov;
  }

  private snapshot(h: Handle): unknown {
    const L = this.L;
    switch (h.t) {
      case 'hs-move': case 'hs-corner': case 'hs-vert': return L.hotspots![h.id];
      case 'approach': return h.kind === 'hs' ? L.hotspots![h.id].approach : h.kind === 'actor' ? L.actors![h.id].approach : this.propTarget(h.id, 'approach').approach;
      case 'prop-pos': case 'prop-h': return this.propTarget(h.id, h.t === 'prop-h' ? 'h' : 'pos');
      case 'actor-pos': case 'actor-h': return L.actors![h.id];
      case 'entry': return L.entries![h.name];
      case 'walk': return h.hole < 0 ? L.walk!.area[h.i] : L.walk!.holes![h.hole][h.i];
      case 'scale': return L.scale![h.k];
    }
  }

  private apply(h: Handle, p: Point, d: Point, orig: unknown) {
    const L = this.L;
    const eng = this.app.engine;
    switch (h.t) {
      case 'hs-move': {
        const o = orig as NonNullable<Layout['hotspots']>[string];
        const hs = L.hotspots![h.id];
        if (o.rect) hs.rect = [o.rect[0] + d[0], o.rect[1] + d[1], o.rect[2], o.rect[3]];
        if (o.approach) hs.approach = [o.approach[0] + d[0], o.approach[1] + d[1]];
        break;
      }
      case 'hs-corner': {
        const [x, y, w, hh] = (orig as { rect: [number, number, number, number] }).rect;
        let x0 = x, y0 = y, x1 = x + w, y1 = y + hh;
        if (h.c === 0 || h.c === 3) x0 = p[0]; else x1 = p[0];
        if (h.c === 0 || h.c === 1) y0 = p[1]; else y1 = p[1];
        L.hotspots![h.id].rect = [Math.min(x0, x1), Math.min(y0, y1), Math.max(4, Math.abs(x1 - x0)), Math.max(4, Math.abs(y1 - y0))];
        break;
      }
      case 'hs-vert': L.hotspots![h.id].poly![h.i] = p; break;
      case 'approach': {
        if (h.kind === 'hs') L.hotspots![h.id].approach = p;
        else if (h.kind === 'actor') L.actors![h.id].approach = p;
        else this.propTarget(h.id, 'approach').approach = p;
        break;
      }
      case 'prop-pos': {
        const t = this.propTarget(h.id, 'pos');
        const o = orig as { x: number; y: number; approach?: Point };
        t.x = o.x + d[0]; t.y = o.y + d[1];
        if (o.approach) t.approach = [o.approach[0] + d[0], o.approach[1] + d[1]];
        break;
      }
      case 'prop-h': { const t = this.propTarget(h.id, 'h'); const base = this.propTarget(h.id, 'pos'); t.h = Math.max(4, base.y - p[1]); break; }
      case 'actor-pos': {
        const a = L.actors![h.id]; const o = orig as { x: number; y: number; approach?: Point };
        a.x = o.x + d[0]; a.y = o.y + d[1];
        if (o.approach) a.approach = [o.approach[0] + d[0], o.approach[1] + d[1]];
        // a remembered scripted move would hide the edited position
        delete eng.state.actors[`${this.room.id}.${h.id}`]?.x; delete eng.state.actors[`${this.room.id}.${h.id}`]?.y;
        break;
      }
      case 'actor-h': { const a = L.actors![h.id]; a.h = Math.max(8, a.y - p[1]); break; }
      case 'entry': L.entries![h.name] = p; break;
      case 'walk': (h.hole < 0 ? L.walk!.area : L.walk!.holes![h.hole])[h.i] = p; break;
      case 'scale': L.scale![h.k] = [p[1], L.scale![h.k][1]]; break;
    }
  }

  private select(h: Handle) {
    const key = 'id' in h ? `${h.t.startsWith('hs') || (h.t === 'approach' && h.kind === 'hs') ? 'hs' : h.t.startsWith('prop') || (h.t === 'approach' && h.kind === 'prop') ? 'prop' : 'actor'}:${h.id}` : h.t === 'entry' ? `entry:${h.name}` : h.t;
    this.overlay.o.selected = key;
    this.selected.item = key;
    const [k, id] = key.split(':');
    const kind = k === 'hs' ? 'hotspot' : k === 'prop' || k === 'actor' ? k : undefined;
    this.post({ type: 'select', key, kind, id: kind ? id : undefined });
  }

  /** After an edit: redraw, and rebuild the scene for whatever is shown. */
  private changed(h: Handle, final = false) {
    if (!this.dirty) this.post({ type: 'dirty', dirty: true });
    this.dirty = true;
    this.status.state = 'modified, not saved';
    const v = this.snapshot(h);
    this.selected.values = JSON.stringify(v && typeof v === 'object' ? roundLayout(v as Layout) : v);
    const visual = h.t.startsWith('prop') || h.t.startsWith('actor') || h.t === 'scale';
    if (visual || final) this.rebuild(); else this.overlay.draw();
    this.pane?.refresh();
  }

  /** Rebuilds the room view (preload already cached: fast). */
  rebuild() {
    if (this.rebuilding) { this.rebuildAgain = true; return; }
    this.rebuilding = true;
    void (async () => {
      do {
        this.rebuildAgain = false;
        await this.app.view.build(this.room);
        this.app.view.resize(this.app.view.u);
        this.overlay.draw();
      } while (this.rebuildAgain);
      this.rebuilding = false;
    })();
  }

  // -------------------------------------------------------------- saving

  /**
   * Writes layout/<room>.json through the dev server. Without one (a Studio demo build, or no /__layout endpoint),
   * the layout goes to the Studio around this view (postMessage; it keeps it with the demo's edits) or, standalone,
   * straight into the demo's edits in localStorage: the engine applies them on the next load.
   */
  async save() {
    const L = roundLayout(this.L);
    this.app.engine.layouts[this.room.id] = L;
    let error = '';
    let offline = import.meta.env.VITE_STUDIO_DEMO === '1';
    if (!offline) {
      try {
        const r = await fetch(`/__layout/${this.room.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(L) });
        if (r.status === 404 || r.status === 405) offline = true;
        else if (!r.ok) error = await r.text();
      } catch { offline = true; }
    }
    const done = () => { this.dirty = false; this.status.state = `saved (${new Date().toLocaleTimeString()})`; };
    if (error) { this.status.state = `error: ${error}`; this.post({ type: 'saved', ok: false, error: this.status.state }); }
    else if (!offline) { done(); this.post({ type: 'saved', ok: true }); }
    else if (window.parent !== window) { done(); this.post({ type: 'saved', ok: true, layout: L }); }
    else if (this.opts.saveOffline) { await this.opts.saveOffline(this.room.id, L); done(); this.status.state += ' in this browser'; }
    else this.status.state = 'error: no dev server, the layout is not saved';
    this.pane.refresh();
  }

  // -------------------------------------------------------------- panel

  /** Ids defined in the room but with no geometry in the layout. */
  missing(): { kind: 'hotspot' | 'prop' | 'actor'; id: Id }[] {
    const L = this.L, R = this.room;
    return [
      ...Object.keys(R.hotspots ?? {}).filter((id) => !L.hotspots?.[id]).map((id) => ({ kind: 'hotspot' as const, id })),
      ...Object.keys(R.props ?? {}).filter((id) => !L.props?.[id]).map((id) => ({ kind: 'prop' as const, id })),
      ...Object.keys(R.actors ?? {}).filter((id) => !L.actors?.[id]).map((id) => ({ kind: 'actor' as const, id })),
    ];
  }

  private addMissing(m: { kind: 'hotspot' | 'prop' | 'actor'; id: Id }, at?: Point) {
    const L = this.L;
    if (m.kind === 'hotspot') (L.hotspots ??= {})[m.id] = { rect: at ? [at[0] - 30, at[1] - 30, 60, 60] : [290, 170, 60, 60] };
    else if (m.kind === 'prop') (L.props ??= {})[m.id] = { x: at?.[0] ?? 320, y: at?.[1] ?? 300, h: 60 };
    else (L.actors ??= {})[m.id] = { x: at?.[0] ?? 320, y: at?.[1] ?? 340 };
    this.changed(m.kind === 'hotspot' ? { t: 'hs-move', id: m.id } : m.kind === 'prop' ? { t: 'prop-pos', id: m.id } : { t: 'actor-pos', id: m.id }, true);
    this.buildPane();
  }

  buildPane() {
    this.pane?.dispose();
    const pane = new Pane({ title: `Editor: ${this.room.id}` });
    // Inside the Studio the panel starts folded: the Studio has its own Save button and the room stays visible.
    if (!this.pane && window.parent !== window) pane.expanded = false;
    (pane.element.parentElement as HTMLElement).style.zIndex = '9000';
    this.pane = pane;
    pane.addBinding(this.status, 'state', { readonly: true });
    pane.addButton({ title: 'Save the layout' }).on('click', () => void this.save());
    pane.addButton({ title: 'Reload (undo)' }).on('click', () => location.reload());
    pane.addBinding(this.overlay.o, 'all', { label: 'hidden zones' }).on('change', () => this.overlay.draw());

    const sel = pane.addFolder({ title: 'Selection' });
    sel.addBinding(this.selected, 'item', { readonly: true });
    sel.addBinding(this.selected, 'values', { readonly: true, multiline: true, rows: 3 });

    const miss = this.missing();
    if (miss.length) {
      const f = pane.addFolder({ title: `To place (${miss.length})` });
      for (const m of miss) f.addButton({ title: `+ ${m.kind} ${m.id}` }).on('click', () => this.addMissing(m));
    }

    const w = pane.addFolder({ title: 'Walkable zone', expanded: false });
    if (!this.L.walk) w.addButton({ title: 'Create the zone' }).on('click', () => { const fl = this.L.floor ?? FLOOR; this.L.walk = { area: [[40, 220], [600, 220], [630, fl], [10, fl]], holes: [] }; this.changed({ t: 'walk', hole: -1, i: 0 }, true); this.buildPane(); });
    else w.addButton({ title: 'Add a hole (furniture)' }).on('click', () => { (this.L.walk!.holes ??= []).push([[290, 290], [350, 290], [350, 330], [290, 330]]); this.changed({ t: 'walk', hole: 0, i: 0 }, true); });

    const s = pane.addFolder({ title: 'Depth scale', expanded: false });
    if (!this.L.scale) s.addButton({ title: 'Add the scale' }).on('click', () => { this.L.scale = [[214, 0.86], [396, 1]]; this.changed({ t: 'scale', k: 0 }, true); this.buildPane(); });
    else {
      const proxy = { back: this.L.scale[0][1], front: this.L.scale[1][1] };
      s.addBinding(proxy, 'back', { min: 0.2, max: 1.5, step: 0.01 }).on('change', (ev) => { this.L.scale![0][1] = ev.value; this.changed({ t: 'scale', k: 0 }); });
      s.addBinding(proxy, 'front', { min: 0.2, max: 1.5, step: 0.01 }).on('change', (ev) => { this.L.scale![1][1] = ev.value; this.changed({ t: 'scale', k: 1 }); });
    }

    const en = pane.addFolder({ title: 'Entry points', expanded: false });
    const nu = { name: '' };
    en.addBinding(nu, 'name');
    en.addButton({ title: 'Add the entry point' }).on('click', () => { if (!nu.name) return; (this.L.entries ??= {})[nu.name] = [320, 360]; this.changed({ t: 'entry', name: nu.name }, true); });

    const help = { text: 'Drag: move. Corners: resize.\nSquare above a foot: height (or scroll wheel).\nDouble-click a zone edge: add a vertex.\nAlt-click a vertex: remove it.' };
    pane.addBinding(help, 'text', { readonly: true, multiline: true, rows: 4 });
  }
}
