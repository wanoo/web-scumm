import { characterImages, roomImages } from '../core/asset-graph';
import type { Engine } from '../core/engine';
import { WALK_SPEED } from '../core/timing';
import type { CharacterDef, Id, Layout, Point, RoomDef } from '../core/types';
import type { AssetBank } from './assets';
import { PaletteCache } from './palette';
import { depthScale, WalkArea } from './walk';
import { DomRenderer } from './render-dom';
import type { SceneRenderer, SpriteSpec } from './renderer';

/** Something drawn in the scene: prop, actor or hero. */
interface Ent {
  id: Id;
  kind: 'prop' | 'actor' | 'hero';
  /** Drawn at least once with an image (its `bbox` is then up to date). */
  drawn: boolean;
  /** 0–1 during a fade (`show`), 1 otherwise. */
  opacity: number;
  x: number; y: number;
  /** Reference height (idle pose), in logical units. */
  h: number;
  z?: number;
  flip: boolean;
  /** Vertical mirror and rotation (degrees, clockwise, around the feet): props only, from the layout. */
  flipV?: boolean;
  rot?: number;
  /** Displayed box (logical units), rotation included: used for touch. */
  bbox?: [number, number, number, number];
  /** Character id (the sheet is re-read on every draw: its variants depend on the state). */
  charId?: Id;
  /** Speech: current mouth image, next change, next blink, slight bob. */
  mouth?: Id;
  mouthAt: number;
  blinkAt: number;
  bob: number;
  pose: string;
  /** Temporary (anim) or walk pose, takes priority over `pose`. */
  over?: string;
  frame: number;
  img?: Id;
  /** Props: a frame of an animation shown instead of the state image, and a running loop. */
  frameImg?: Id;
  loop?: { frames: Id[]; fps: number; i: number; acc: number; onFrame?: (i: number) => void };
  visible: boolean;
  /** Characters stand on a shadow; props do not. */
  hasShadow: boolean;
  /** Character that keeps its size (placed) or follows depth (hero, walking actor). */
  scaleWithDepth: boolean;
}


/**
 * The scene model of a room: backdrop, props, characters, depth sort, walking, poses, the camera and the hit test, in
 * logical units (640 × 400 per screen). What paints it is a `SceneRenderer` (dom/renderer.ts): the DOM painter by
 * default, the reference (D10). Everything a tap, a walk or a line depends on is decided here, never by the painter.
 */
export class RoomView {
  /** The painter's surface (moves with the camera; the accessible targets go in it). */
  get el(): HTMLElement { return this.r.el; }
  readonly r: SceneRenderer;
  u = 1;
  room!: RoomDef;
  layout!: Layout;
  private ents = new Map<Id, Ent>();
  private walk!: WalkArea;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private walkTokens = new Map<Id, number>();
  /** Recoloured sprites of characters with a `palette` (one blob URL per image and palette, kept across rooms). */
  private palettes = new PaletteCache();
  talking: Id | null = null;
  /** Wide rooms: logical width, and the camera (left edge, logical units). `follow`: it tracks the hero. */
  width = 640;
  cam = 0;
  follow = true;
  private pan: { from: number; to: number; t0: number; ms: number; done: () => void } | null = null;
  /** Called whenever the camera moves (the dev overlay pans with it). */
  onCamera: ((cam: number) => void) | null = null;
  /** Reduced motion (settings): instant camera moves. */
  reduceMotion = false;

  constructor(private engine: Engine, private bank: AssetBank, renderer?: SceneRenderer) {
    this.r = renderer ?? new DomRenderer();
  }

  get heroId() { return this.engine.heroId(); }

  resize(u: number) {
    this.u = u;
    this.r.resize(u);
    this.applyCam();
  }

  // ------------------------------------------------------------ camera

  private clampCam(x: number) { return Math.max(0, Math.min(this.width - 640, x)); }
  private applyCam() {
    this.r.camera(this.cam, this.width);
    this.onCamera?.(this.cam);
  }
  /** The camera the hero would have at this instant (centred on them, clamped). */
  private heroCam(): number {
    const h = this.ents.get(this.heroId);
    return this.clampCam((h?.x ?? 320) - 320);
  }
  followHero() { this.follow = true; this.pan = null; }
  /** Moves the camera to left edge `x` (follow off), animated over `ms`. */
  setCamera(x: number, ms = 0): Promise<void> {
    this.follow = false;
    const to = this.clampCam(x);
    if (this.width <= 640 || ms <= 0 || this.reduceMotion || Math.abs(to - this.cam) < 1) { this.pan = null; this.cam = to; this.applyCam(); return Promise.resolve(); }
    return new Promise((done) => { this.pan = { from: this.cam, to, t0: performance.now(), ms, done }; });
  }

  /** Builds the room from the game state. */
  async build(room: RoomDef) {
    cancelAnimationFrame(this.raf);
    this.room = room;
    this.layout = this.engine.layout(room.id);
    this.walk = new WalkArea(this.layout);
    this.ents.clear();
    const s = this.engine.state;
    // The room's part of the asset graph (core/asset-graph.ts) for who is actually here: never a file outside its scope.
    const ids = new Set<Id>(roomImages(room));
    const chars = new Set<Id>([this.heroId, ...Object.values(room.actors ?? {}).map((a) => a.char), ...Object.keys(this.engine.guests(room))]);
    for (const c of chars) characterImages(this.engine.game, c).forEach((f) => ids.add(f));
    await this.bank.preload(ids);
    // Palette swaps: every frame of the character, under its own palette and each variant's, ready before drawing.
    const swaps: Promise<string>[] = [];
    for (const c of chars) {
      const def = this.engine.game.characters[c];
      if (!def) continue;
      const frames = new Set<Id>();
      for (const set of [def.sprites, ...(def.variants ?? []).map((v) => v.sprites)]) for (const f of Object.values(set ?? {})) f.forEach((x) => frames.add(x));
      for (const m of [def.mouths, ...(def.variants ?? []).map((v) => v.mouths)]) for (const ms of Object.values(m ?? {})) [ms.closed, ...ms.open, ms.blink, ms.smile].forEach((x) => x && frames.add(x));
      const pals: { pal?: Record<string, string>; tol?: number }[] = [{ pal: def.palette, tol: def.paletteTolerance },
        ...(def.variants ?? []).map((v) => (v.palette ? { pal: v.palette, tol: v.paletteTolerance } : { pal: def.palette, tol: def.paletteTolerance }))];
      for (const { pal, tol } of pals) if (pal && Object.keys(pal).length) for (const f of frames) swaps.push(this.palettes.load(this.bank.img(f), pal, tol ?? 0));
    }
    await Promise.all(swaps);

    this.width = Math.max(640, this.layout.width ?? 640);
    this.r.reset(this.bank.img(room.decor), this.width);

    for (const [id, def] of Object.entries(room.props ?? {})) {
      const L = this.layout.props?.[id];
      if (!L) continue;
      const e = this.add({ id, kind: 'prop', x: L.x, y: L.y, h: L.h, z: L.z != null ? L.z : L.on ? L.y + 200 : undefined, flip: !!L.flip, pose: '', scaleWithDepth: false });
      e.img = this.propImage(id);
      this.applyPropState(e);
      e.visible = this.engine.visible(id, room);
      void def;
    }
    // Inactive playable characters standing here (no actor declared for them): drawn at their saved position.
    for (const [id, g] of Object.entries(this.engine.guests(room))) {
      const char = this.engine.character(g.char);
      this.add({ id, kind: 'actor', x: g.at[0], y: g.at[1], h: char?.height ?? this.engine.game.skin?.heights?.hero ?? 84, flip: g.at[0] > 320, charId: g.char, pose: 'idle', scaleWithDepth: true, visible: true });
    }
    for (const [id, a] of Object.entries(room.actors ?? {})) {
      if (a.char === this.heroId) continue; // the active player is the hero entity, not this actor
      const L = this.layout.actors?.[id];
      const o = s.actors[`${room.id}.${id}`] ?? {};
      const char = this.engine.character(a.char);
      const x = o.x ?? L?.x ?? 320, y = o.y ?? L?.y ?? 360;
      const facing = o.facing ?? a.facing ?? (L?.flip ? 'left' : 'right');
      this.add({ id, kind: 'actor', x, y, h: L?.h ?? char?.height ?? this.engine.game.skin?.heights?.actor ?? 110, z: L?.z ?? undefined, flip: facing === 'left', charId: a.char, pose: o.pose ?? a.pose ?? 'idle', scaleWithDepth: true, visible: this.engine.visible(id, room) });
    }
    if (room.hero !== false) {
      const [x, y] = s.hero[room.id] ?? this.layout.entries?.default ?? [320, 360];
      const char = this.engine.character(this.heroId);
      this.add({ id: this.heroId, kind: 'hero', x, y, h: char?.height ?? this.engine.game.skin?.heights?.hero ?? 84, flip: false, charId: this.heroId, pose: 'idle', scaleWithDepth: true, visible: true });
    }
    for (const e of this.ents.values()) this.draw(e);
    // The camera: as saved (a pan left it somewhere), or on the hero.
    const c = s.camera;
    this.pan = null;
    this.follow = c?.follow ?? true;
    this.cam = this.follow ? this.heroCam() : this.clampCam(c?.x ?? 0);
    this.applyCam();
    this.last = performance.now();
    const tick = (t: number) => { this.tick(t); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  destroy() { cancelAnimationFrame(this.raf); this.r.dispose(); }

  /**
   * Stops every animation on a fixed picture: first frame of each pose and loop, mouths closed, no bob, no walk pose,
   * the camera where it rests. For the visual baselines (scripts/e2e-visual.mjs) and the Studio's painter comparison;
   * the next `build` starts the clock again.
   */
  still() {
    cancelAnimationFrame(this.raf);
    for (const e of this.ents.values()) {
      e.frame = 0; e.mouth = undefined; e.bob = 0; e.over = undefined;
      if (e.loop) { e.loop.i = 0; e.frameImg = e.loop.frames[0]; e.loop = undefined; }
      this.draw(e);
    }
    this.pan = null;
    if (this.follow) this.cam = this.heroCam();
    this.applyCam();
  }

  private add(p: Partial<Ent> & Pick<Ent, 'id' | 'kind' | 'x' | 'y' | 'h' | 'flip' | 'pose' | 'scaleWithDepth'>): Ent {
    const e: Ent = { frame: 0, visible: true, mouthAt: 0, blinkAt: performance.now() + 2000 + Math.random() * 4000, bob: 0, drawn: false, opacity: 1, hasShadow: p.kind !== 'prop', ...p };
    this.ents.set(e.id, e);
    return e;
  }

  private propImage(id: Id): Id | undefined {
    const def = this.room.props?.[id];
    if (!def) return undefined;
    const st = this.engine.propState(id, this.room);
    return (st && def.states?.[st]) || def.img;
  }

  private applyPropState(e: Ent) {
    const L = this.layout.props?.[e.id];
    const st = this.engine.propState(e.id, this.room);
    const o = st ? L?.states?.[st] : undefined;
    if (L) {
      e.x = o?.x ?? L.x; e.y = o?.y ?? L.y; e.h = o?.h ?? L.h;
      e.rot = o?.rot ?? L.rot ?? 0; e.flip = !!(o?.flip ?? L.flip); e.flipV = !!(o?.flipV ?? L.flipV);
      const z = o?.z ?? L.z;
      e.z = z != null ? z : L.on ? L.y + 200 : undefined;
    }
    e.img = this.propImage(e.id);
  }

  // ------------------------------------------------------------ drawing

  private char(e: Ent): CharacterDef | undefined { return e.charId ? this.engine.character(e.charId) : undefined; }

  /** Current image of a character: pose (or walk), and mouth if the pose has one. */
  private frames(e: Ent): Id[] {
    const c = this.char(e);
    const sp = c?.sprites ?? {};
    const pose = e.over ?? e.pose;
    const m = e.over && e.over.startsWith('walk') ? undefined : c?.mouths?.[pose];
    if (m) return [e.mouth ?? m.closed];
    return sp[pose] ?? sp[e.pose] ?? sp.idle ?? Object.values(sp)[0] ?? [];
  }

  private draw(e: Ent) {
    let img: Id | undefined, h = e.h;
    if (e.kind === 'prop') img = e.frameImg ?? e.img;
    else {
      const fr = this.frames(e);
      img = fr[e.frame % Math.max(1, fr.length)];
      const idle = this.char(e)?.sprites?.idle?.[0];
      // same scale for all of a character's poses: a crouching pose stays smaller
      const ref = idle ? this.bank.size(idle)[1] : 0;
      const scale = e.scaleWithDepth ? depthScale(this.layout, e.y) : 1;
      if (img && ref) h = (this.bank.size(img)[1] / ref) * e.h * scale; else h = e.h * scale;
    }
    const base = { id: e.id, fx: e.x, fy: e.y, bob: e.bob, z: e.z ?? e.y, flip: e.flip, flipV: !!e.flipV, rot: e.rot ?? 0, visible: e.visible, opacity: e.opacity };
    if (!img) { e.drawn = false; this.r.sprite({ ...base, url: null, w: 0, h: 0 }); return; }
    const w = this.bank.widthFor(img, h);
    const c = e.kind === 'prop' ? undefined : this.char(e);
    const pal = c?.palette && Object.keys(c.palette).length ? c.palette : undefined;
    const url = this.bank.img(img);
    const glow = e.charId ? this.engine.game.characters[e.charId]?.glow : undefined;
    const sw = Math.min(w * 0.7, 46);
    const spec: SpriteSpec = {
      ...base, url: (pal && this.palettes.get(url, pal, c?.paletteTolerance ?? 0)) || url, w, h,
      ...(glow ? { filter: `drop-shadow(0 0 6px ${glow}) drop-shadow(0 0 14px ${glow})` } : {}),
      ...(e.hasShadow ? { shadow: { x: e.x - sw / 2, y: e.y - 4, w: sw, h: 8, z: Math.round(e.y) - 1, visible: e.visible } } : {}),
    };
    this.r.sprite(spec);
    e.drawn = true;
    // The box a tap is tested against (rotation included): the model's, whatever paints it.
    const rot = e.rot ?? 0;
    const y0 = e.flipV ? 0 : -h, y1 = e.flipV ? h : 0;
    if (rot) {
      const a = (rot * Math.PI) / 180, co = Math.cos(a), sn = Math.sin(a);
      const pts = [[-w / 2, y0], [w / 2, y0], [-w / 2, y1], [w / 2, y1]].map(([px, py]) => [e.x + px * co - py * sn, e.y + px * sn + py * co]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      e.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    } else e.bbox = [e.x - w / 2, e.y + y0 - e.bob, w, h];
  }

  private tick(t: number) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    // Camera: a pan in progress, or following the hero (smoothed).
    if (this.width > 640) {
      if (this.pan) {
        const p = this.pan;
        const k = Math.min(1, (t - p.t0) / p.ms);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.cam = p.from + (p.to - p.from) * ease;
        if (k >= 1) { this.pan = null; p.done(); }
        this.applyCam();
      } else if (this.follow) {
        const target = this.heroCam();
        if (Math.abs(target - this.cam) > 0.5) { this.cam += (target - this.cam) * Math.min(1, dt * (this.reduceMotion ? 60 : 5)); this.applyCam(); }
      }
    }
    // Prop animations that loop.
    for (const e of this.ents.values()) {
      if (!e.loop) continue;
      e.loop.acc += dt;
      if (e.loop.acc >= 1 / e.loop.fps) { e.loop.acc = 0; e.loop.i = (e.loop.i + 1) % e.loop.frames.length; e.frameImg = e.loop.frames[e.loop.i]; this.draw(e); e.loop.onFrame?.(e.loop.i); }
    }
    // Mouths: during speech, t2/t3/t4 at random every 160 to 220 ms; at rest, an occasional blink.
    for (const e of this.ents.values()) {
      if (e.kind === 'prop' || e.over?.startsWith('walk')) continue;
      const m = this.char(e)?.mouths?.[e.over ?? e.pose];
      if (this.talking === e.id) {
        if (t >= e.mouthAt) {
          if (m) { const opts = m.open.filter((f) => f !== e.mouth); e.mouth = opts[Math.floor(Math.random() * opts.length)] ?? m.closed; }
          else e.bob = e.bob ? 0 : 1.5; // no mouth: same image, slight bob
          e.mouthAt = t + (m ? 160 + Math.random() * 60 : 350);
          this.draw(e);
        }
      } else if (m?.blink) {
        if (e.mouth === m.blink && t >= e.mouthAt) { e.mouth = undefined; this.draw(e); }
        else if (!e.mouth && t >= e.blinkAt) { e.mouth = m.blink; e.mouthAt = t + 150; e.blinkAt = t + 3000 + Math.random() * 4000; this.draw(e); }
      }
    }
    // Animated poses (walk, sleeping cat…) at 8 frames per second.
    this.acc += dt;
    if (this.acc < 1 / 8) return;
    this.acc = 0;
    for (const e of this.ents.values()) {
      if (e.kind === 'prop') continue;
      const n = this.frames(e).length;
      if (n > 1) { e.frame = (e.frame + 1) % n; this.draw(e); }
    }
  }

  // ------------------------------------------------------------ queries

  /** Point above the head (for dialogue lines). null if the person isn't in the scene. */
  head(id: Id): Point | null {
    const e = this.ents.get(id);
    if (!e || !e.visible || e.kind === 'prop') return null;
    const scale = e.scaleWithDepth ? depthScale(this.layout, e.y) : 1;
    return [e.x, e.y - e.h * scale - 6];
  }

  pos(id: Id): Point | null { const e = this.ents.get(id); return e ? [e.x, e.y] : null; }

  /** Box of an entity or hotspot, in logical units [x, y, w, h]. */
  box(id: Id): [number, number, number, number] | null {
    const e = this.ents.get(id);
    if (e?.drawn && e.bbox) return e.bbox;
    const h = this.layout.hotspots?.[id];
    if (h?.rect) return h.rect;
    if (h?.poly) { const xs = h.poly.map((p) => p[0]), ys = h.poly.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; }
    return null;
  }

  /** Whatever is under the finger: the smallest visible thing that contains the point. */
  hit(p: Point): Id | null {
    let best: Id | null = null, area = Infinity;
    const inPoly = (pt: Point, poly: Point[]) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (const id of this.engine.targets(this.room)) {
      const hs = this.layout.hotspots?.[id];
      let inside = false, a = Infinity;
      if (hs?.poly) { inside = inPoly(p, hs.poly); const b = this.box(id)!; a = b[2] * b[3]; }
      else {
        const b = this.box(id);
        if (b) { inside = p[0] >= b[0] && p[0] <= b[0] + b[2] && p[1] >= b[1] && p[1] <= b[1] + b[3]; a = b[2] * b[3]; }
      }
      if (inside && a < area) { best = id; area = a; }
    }
    return best;
  }

  // ------------------------------------------------------------ presenter commands

  setProp(id: Id, _state: string) {
    const e = this.ents.get(id);
    if (!e) return;
    this.applyPropState(e);
    this.draw(e);
  }

  propFrame(id: Id, img: Id | null) {
    const e = this.ents.get(id);
    if (!e) return;
    e.frameImg = img ?? undefined;
    this.draw(e);
  }

  propLoop(id: Id, frames: Id[], fps: number, onFrame?: (i: number) => void) {
    const e = this.ents.get(id);
    if (!e) return;
    if (!frames.length) { e.loop = undefined; e.frameImg = undefined; this.draw(e); return; }
    void this.bank.preload(new Set(frames));
    e.loop = { frames, fps: fps || 8, i: 0, acc: 0, onFrame };
    e.frameImg = frames[0];
    this.draw(e);
    onFrame?.(0);
  }

  refreshVisibility() {
    for (const e of this.ents.values()) {
      if (e.kind === 'hero') continue;
      const v = this.engine.visible(e.id, this.room);
      if (v !== e.visible) { e.visible = v; this.draw(e); }
    }
  }

  async show(id: Id, visible: boolean, fade: number, fast: boolean) {
    const e = this.ents.get(id);
    if (!e) return;
    if (fast || !fade) { e.visible = visible; e.opacity = 1; this.draw(e); return; }
    // The fade is the model's (an opacity the painter is given each frame), so every painter fades the same way.
    e.visible = true;
    const from = visible ? 0 : 1, to = visible ? 1 : 0, t0 = performance.now();
    await new Promise<void>((done) => {
      const step = (t: number) => { const k = Math.min(1, (t - t0) / fade); e.opacity = from + (to - from) * k; this.draw(e); if (k < 1) requestAnimationFrame(step); else done(); };
      requestAnimationFrame(step);
    });
    e.visible = visible; e.opacity = 1;
    this.draw(e);
  }

  face(id: Id, dir: 'left' | 'right') { const e = this.ents.get(id); if (e) { e.flip = dir === 'left'; this.draw(e); } }
  pose(id: Id, pose: string) { const e = this.ents.get(id); if (e) { e.pose = pose; e.frame = 0; this.draw(e); } }
  place(id: Id, at: Point, face?: 'left' | 'right') {
    const e = this.ents.get(id);
    if (!e) return;
    [e.x, e.y] = at;
    if (face) e.flip = face === 'left';
    this.draw(e);
  }

  async anim(id: Id, pose: string, ms: number, fast: boolean) {
    const e = this.ents.get(id);
    if (!e || fast) return;
    e.over = pose; e.frame = 0; this.draw(e);
    await new Promise((r) => setTimeout(r, ms));
    if (e.over === pose) { e.over = undefined; this.draw(e); }
  }

  /**
   * Start or end of a line. The body doesn't change while speaking (only the mouth moves).
   * A long line from a character with no mouths starts with a gesture (`talk`) played once.
   */
  setTalking(id: Id | null, long = false) {
    const prev = this.talking;
    this.talking = id;
    const now = performance.now();
    const p = prev ? this.ents.get(prev) : undefined;
    if (p) { p.mouth = undefined; p.bob = 0; this.draw(p); }
    const e = id ? this.ents.get(id) : undefined;
    if (e) {
      e.mouthAt = now;
      const c = this.char(e);
      if (long && !c?.mouths?.[e.pose] && c?.sprites?.talk && !e.over) void this.anim(e.id, 'talk', 900, false);
      this.draw(e);
    }
  }

  /** Redraws everything (after a state change affecting variants, e.g. a picked-up item). */
  redraw() { for (const e of this.ents.values()) { if (e.kind === 'prop') this.applyPropState(e); this.draw(e); } }

  /** Walks along the path. Returns the arrival point, or null if interrupted by another walk. */
  async walkTo(id: Id, to: Point, fast: boolean): Promise<Point | null> {
    const e = this.ents.get(id);
    if (!e) return to;
    const tok = (this.walkTokens.get(id) ?? 0) + 1;
    this.walkTokens.set(id, tok);
    const pts = this.walk.path([e.x, e.y], to);
    if (fast) { const end = pts[pts.length - 1] ?? to; [e.x, e.y] = end; this.draw(e); return end; }
    const sp = this.char(e)?.sprites ?? {};
    // Actors and the hero already follow depth (as in the placement page): nothing to convert.
    const wasDepth = e.scaleWithDepth;
    if (e.kind === 'actor' && !wasDepth) { e.h = e.h / depthScale(this.layout, e.y); e.scaleWithDepth = true; }
    for (const p of pts) {
      const ok = await new Promise<boolean>((res) => {
        let last = performance.now();
        const step = (now: number) => {
          if (this.walkTokens.get(id) !== tok) return res(false);
          const dt = Math.min(0.05, (now - last) / 1000); last = now;
          const dx = p[0] - e.x, dy = p[1] - e.y, d = Math.hypot(dx, dy);
          if (d < 1.5) { e.x = p[0]; e.y = p[1]; this.draw(e); return res(true); }
          const k = Math.min(1, (WALK_SPEED * dt) / d);
          e.x += dx * k; e.y += dy * k;
          if (Math.abs(dx) > 1) e.flip = dx < 0;
          const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
          e.over = vertical ? (dy < 0 ? (sp.walk_back ? 'walk_back' : 'walk') : (sp.walk_front ? 'walk_front' : 'walk')) : (sp.walk ? 'walk' : undefined);
          this.draw(e);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      if (!ok) return null;
    }
    e.over = undefined;
    if (e.kind === 'actor' && !wasDepth) { e.h = e.h * depthScale(this.layout, e.y); e.scaleWithDepth = false; }
    this.draw(e);
    return [e.x, e.y];
  }

  clampFloor(p: Point): Point { return this.walk.clamp(p); }
}
