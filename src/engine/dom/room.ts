import { characterImages, roomImages } from '../core/asset-graph';
import type { Engine } from '../core/engine';
import type { CharacterDef, Id, Layout, Point, RoomDef } from '../core/types';
import type { AssetBank } from './assets';
import { PaletteCache } from './palette';
import { Walker } from './walker';
import { Camera } from './camera';
import type { Ent } from './scene-entity';
import type { NormalLink } from '../core/stage';
import { DomRenderer } from './render-dom';
import { rendererOf, stageOf } from '../core/stage';
import { check } from '../core/cond';
import { defaultVerb } from '../core/default-verb';
import type { SceneRenderer, SpriteSpec, StageSpec } from './renderer';
import { hitTest, sceneFrame, stageOfFrame, type SceneFrame } from '../scene/frame';
import { stageKey, stageSpecOf } from './room-stage';
import { PainterRenderer } from './frame-renderer';

/**
 * The scene model of a room: backdrop, props, characters, depth sort, walking, poses, the camera and the hit test, in
 * logical units (640 × 400 per screen). What paints it is a `SceneRenderer` (dom/renderer.ts): the DOM painter by
 * default, the reference (D10). Everything a tap, a walk or a line depends on is decided here, never by the painter.
 * 4.1.11 (ADR 0011): the model makes a `SceneFrame` (scene/frame.ts) and paints it when a room is built; between
 * builds, an entity that changes paints its own sprite (the frame's part that changed); the hit test and the
 * accessible targets read the frame.
 */
export class RoomView {
  /** The painter's surface (moves with the camera; the accessible targets go in it). */
  get el(): HTMLElement {
    return this.r.el;
  }
  /** The painter (the DOM reference or the Canvas one), as the scene frame's `Renderer` (dom/frame-renderer.ts). */
  readonly out: PainterRenderer;
  /** The painter itself (its surface, its paint counter). */
  get r(): SceneRenderer {
    return this.out.painter;
  }
  /** Which painter draws the current room (`RoomDef.renderer`, else `GameDef.renderer`, else the DOM reference). */
  painter: 'dom' | 'canvas' = 'dom';
  /** Forces a painter for every room (`?renderer=canvas|dom`: the visual parity check, the Studio's comparison). */
  forced: 'dom' | 'canvas' | null = null;
  /** Called with the new surface when a room changes painter: the App puts it where the old one was. */
  onSurface: ((el: HTMLElement, old: HTMLElement) => void) | null = null;
  u = 1;
  room!: RoomDef;
  layout!: Layout;
  private ents = new Map<Id, Ent>();
  /** A walk stopped before a closed link (`stage.links[id].locked` is what the App says then). */
  onBlocked: ((link: NormalLink) => void) | null = null;
  private raf = 0;
  private last = 0;
  private acc = 0;
  /** Recoloured sprites of characters with a `palette` (one blob URL per image and palette, kept across rooms). */
  private palettes = new PaletteCache();
  talking: Id | null = null;
  /** Reduced motion (settings): instant camera moves, a teleport for every crossing. */
  reduceMotion = false;
  /** The camera (4.1.5, dom/camera.ts): edges, zoom, follow, pans; where a logical point is on the screen. */
  camera = new Camera({
    hero: () => {
      const h = this.ents.get(this.heroId);
      return h ? [h.x, h.y] : undefined;
    },
    zoomAt: (p) => this.walker.zoneAt(p)?.zoom ?? 1,
    reduced: () => this.reduceMotion,
    paint: (cam, width, camY, zoom) => {
      this.version++;
      this.r.camera(cam, width, camY, zoom);
    },
  });
  /** The walking (4.1.5, dom/walker.ts): the floor's topology, walks, crossings, motions. */
  walker = new Walker({
    ent: (id) => this.ents.get(id),
    draw: (e) => this.draw(e),
    sprites: (e) => this.char(e)?.sprites,
    reduced: () => this.reduceMotion,
    passable: (l) => {
      const st = this.engine.state;
      return !l.if || !st || check(l.if, st, this.room.id);
    },
    blocked: (l) => this.onBlocked?.(l),
  });

  constructor(
    private engine: Engine,
    private bank: AssetBank,
    renderer?: SceneRenderer,
  ) {
    this.out = new PainterRenderer(renderer ?? new DomRenderer());
    this.custom = !!renderer;
  }
  /** A painter given by the caller (tests): kept for every room. */
  private custom = false;
  /** The stage last handed to the painter: given again only when a condition changes it. */
  private stageKey = '';

  /** The stage the painter was last given (the frame's layers, occluders and effects). */
  private stageNow: StageSpec | null = null;

  /** The room's stage for the painter (dom/room-stage.ts): conditions evaluated, images placed on the backdrop. */
  stageSpec(): StageSpec {
    return stageSpecOf(this.room, this.layout, this.engine.state, this.bank, this.camera.width, this.reduceMotion);
  }

  /**
   * The room as it is to be drawn now (scene/frame.ts): pure, from the state, the layout and what this model animates.
   * The hit test and the accessible targets read it; a renderer paints it.
   */
  frame(): SceneFrame {
    // Memoised by a version every change bumps (a sprite drawn, a prop, the camera, a state change, a room built): a
    // tap or a hover reuses the frame instead of building and hashing it again.
    if (this.cache?.version === this.version) return this.cache.frame;
    const frame = this.makeFrame();
    this.framesBuilt++;
    this.cache = { version: this.version, frame };
    return frame;
  }
  /** Bumped by every change the frame reads (`frame()` is memoised on it). */
  private version = 0;
  private cache: { version: number; frame: SceneFrame } | null = null;
  /** @internal Frames built (the memo's test). */
  framesBuilt = 0;
  /** The state may have changed outside this view (the App's `engine.onChange`): the next frame is made again. */
  invalidate() {
    this.version++;
  }

  private makeFrame(): SceneFrame {
    const room = this.room;
    const stage = this.stageNow ?? this.stageSpec();
    return sceneFrame(
      { ...this.engine.state, room: room.id },
      { [room.id]: this.layout },
      {
        stage,
        camera: { x: this.camera.cam, y: this.camera.camY, zoom: this.camera.zoom, width: this.camera.width },
        entities: [...this.ents.values()].flatMap((e) =>
          e.spec
            ? [
                {
                  id: e.id,
                  kind: e.kind,
                  ...(e.charId ? { cell: e.charId } : {}),
                  sprite: e.spec,
                  ...(e.drawn && e.bbox ? { bbox: e.bbox } : {}),
                  moving: !!e.over?.startsWith('walk'),
                },
              ]
            : [],
        ),
        targets: this.engine.targets(room).map((id) => ({
          id,
          label: this.engine.nameOf(id, room),
          verb: defaultVerb(this.engine.game, room, id),
        })),
        talking: this.talking,
        transition: stageOf(room, this.layout).transition,
      },
    );
  }

  /** Paints a whole frame (a room built): its renderer resets the painter, gives the stage, every sprite in order. */
  private paintFrame(f: SceneFrame) {
    const st = stageOfFrame(f);
    this.stageNow = st;
    this.stageKey = stageKey(st);
    this.out.invalidate();
    this.out.render(f);
  }

  /** How the room appears (`stage.transition`): a fade or a wipe of the painter's surface, a cut with reduced motion. */
  private enterTransition() {
    const t = stageOf(this.room, this.layout).transition;
    if (t.kind === 'cut' || this.reduceMotion || !this.r.el.animate) return;
    this.r.el.animate(
      t.kind === 'fade'
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
      { duration: t.ms, easing: 'ease-out' },
    );
  }

  /**
   * The painter this room asks for, swapped in when it differs from the current one. The Canvas painter is loaded the
   * first time a room asks for it (4.1.0): a game that paints with the DOM never downloads it.
   */
  private async usePainter(room: RoomDef) {
    if (this.custom) return;
    const want = this.forced ?? rendererOf(room, this.engine.game);
    if (want === this.painter) return;
    const next = want === 'canvas' ? new (await import('./render-canvas')).CanvasRenderer() : new DomRenderer();
    const old = this.r.el;
    this.out.swap(next);
    this.painter = want;
    this.r.resize(this.u);
    this.onSurface?.(this.r.el, old);
  }

  get heroId() {
    return this.engine.heroId();
  }

  resize(u: number) {
    this.u = u;
    this.r.resize(u);
    this.camera.u = u;
    this.camera.apply();
  }

  /** Builds the room from the game state. */
  async build(room: RoomDef) {
    cancelAnimationFrame(this.raf);
    await this.usePainter(room);
    this.room = room;
    this.layout = this.engine.layout(room.id);
    this.walker.enter(this.layout, room);
    this.ents.clear();
    const s = this.engine.state;
    // The room's part of the asset graph (core/asset-graph.ts) for who is actually here: never a file outside its scope.
    const ids = new Set<Id>(roomImages(room, this.layout));
    const chars = new Set<Id>([
      this.heroId,
      ...Object.values(room.actors ?? {}).map((a) => a.char),
      ...Object.keys(this.engine.guests(room)),
    ]);
    for (const c of chars) characterImages(this.engine.game, c).forEach((f) => ids.add(f));
    await this.bank.preload(ids);
    // Palette swaps: every frame of the character, under its own palette and each variant's, ready before drawing.
    const swaps: Promise<string>[] = [];
    for (const c of chars) {
      const def = this.engine.game.characters[c];
      if (!def) continue;
      const frames = new Set<Id>();
      for (const set of [def.sprites, ...(def.variants ?? []).map((v) => v.sprites)])
        for (const f of Object.values(set ?? {})) f.forEach((x) => frames.add(x));
      for (const m of [def.mouths, ...(def.variants ?? []).map((v) => v.mouths)])
        for (const ms of Object.values(m ?? {}))
          [ms.closed, ...ms.open, ms.blink, ms.smile].forEach((x) => x && frames.add(x));
      const pals: { pal?: Record<string, string>; tol?: number }[] = [
        { pal: def.palette, tol: def.paletteTolerance },
        ...(def.variants ?? []).map((v) =>
          v.palette ? { pal: v.palette, tol: v.paletteTolerance } : { pal: def.palette, tol: def.paletteTolerance },
        ),
      ];
      for (const { pal, tol } of pals)
        if (pal && Object.keys(pal).length)
          for (const f of frames) swaps.push(this.palettes.load(this.bank.img(f), pal, tol ?? 0));
    }
    await Promise.all(swaps);

    this.camera.width = Math.max(640, this.layout.width ?? 640);
    this.stageNow = this.stageSpec();

    for (const [id, def] of Object.entries(room.props ?? {})) {
      const L = this.layout.props?.[id];
      if (!L) continue;
      const e = this.add({
        id,
        kind: 'prop',
        x: L.x,
        y: L.y,
        h: L.h,
        z: L.z != null ? L.z : L.on ? L.y + 200 : undefined,
        flip: !!L.flip,
        pose: '',
        scaleWithDepth: false,
      });
      e.img = this.propImage(id);
      this.applyPropState(e);
      e.visible = this.engine.visible(id, room);
      void def;
    }
    // Inactive playable characters standing here (no actor declared for them): drawn at their saved position.
    for (const [id, g] of Object.entries(this.engine.guests(room))) {
      const char = this.engine.character(g.char);
      this.add({
        id,
        kind: 'actor',
        x: g.at[0],
        y: g.at[1],
        h: char?.height ?? this.engine.game.skin?.heights?.hero ?? 84,
        flip: g.at[0] > 320,
        charId: g.char,
        pose: 'idle',
        scaleWithDepth: true,
        visible: true,
      });
    }
    for (const [id, a] of Object.entries(room.actors ?? {})) {
      if (a.char === this.heroId) continue; // the active player is the hero entity, not this actor
      const L = this.layout.actors?.[id];
      const o = s.actors[`${room.id}.${id}`] ?? {};
      const char = this.engine.character(a.char);
      const x = o.x ?? L?.x ?? 320,
        y = o.y ?? L?.y ?? 360;
      const facing = o.facing ?? a.facing ?? (L?.flip ? 'left' : 'right');
      this.add({
        id,
        kind: 'actor',
        x,
        y,
        h: L?.h ?? char?.height ?? this.engine.game.skin?.heights?.actor ?? 110,
        z: L?.z ?? undefined,
        flip: facing === 'left',
        charId: a.char,
        pose: o.pose ?? a.pose ?? 'idle',
        scaleWithDepth: true,
        visible: this.engine.visible(id, room),
      });
    }
    if (room.hero !== false) {
      const [x, y] = s.hero[room.id] ?? this.layout.entries?.default ?? [320, 360];
      const char = this.engine.character(this.heroId);
      this.add({
        id: this.heroId,
        kind: 'hero',
        x,
        y,
        h: char?.height ?? this.engine.game.skin?.heights?.hero ?? 84,
        flip: false,
        charId: this.heroId,
        pose: 'idle',
        scaleWithDepth: true,
        visible: true,
      });
    }
    // The frame of the room, made then painted (its sprites resolved first, nothing painted on the way).
    for (const e of this.ents.values()) this.spriteOf(e);
    this.version++;
    this.paintFrame(this.frame());
    this.enterTransition();
    this.camera.enter(this.layout.width ?? 640, s.camera);
    this.last = performance.now();
    const tick = (t: number) => {
      this.tick(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.out.unmount(); // the painter
    this.palettes.dispose(); // the blob URLs of the recoloured images
  }

  /**
   * Stops every animation on a fixed picture: first frame of each pose and loop, mouths closed, no bob, no walk pose,
   * the camera where it rests. For the visual baselines (scripts/e2e-visual.mjs) and the Studio's painter comparison;
   * the next `build` starts the clock again.
   */
  still() {
    cancelAnimationFrame(this.raf);
    for (const e of this.ents.values()) {
      e.frame = 0;
      e.mouth = undefined;
      e.bob = 0;
      e.over = undefined;
      if (e.loop) {
        e.loop.i = 0;
        e.frameImg = e.loop.frames[0];
        e.loop = undefined;
      }
      this.draw(e);
    }
    this.camera.rest();
  }

  private add(p: Partial<Ent> & Pick<Ent, 'id' | 'kind' | 'x' | 'y' | 'h' | 'flip' | 'pose' | 'scaleWithDepth'>): Ent {
    const e: Ent = {
      frame: 0,
      visible: true,
      mouthAt: 0,
      blinkAt: performance.now() + 2000 + Math.random() * 4000,
      bob: 0,
      drawn: false,
      opacity: 1,
      hasShadow: p.kind !== 'prop',
      ...p,
    };
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
      e.x = o?.x ?? L.x;
      e.y = o?.y ?? L.y;
      e.h = o?.h ?? L.h;
      e.rot = o?.rot ?? L.rot ?? 0;
      e.flip = !!(o?.flip ?? L.flip);
      e.flipV = !!(o?.flipV ?? L.flipV);
      const z = o?.z ?? L.z;
      e.z = z != null ? z : L.on ? L.y + 200 : undefined;
    }
    e.img = this.propImage(e.id);
  }

  // ------------------------------------------------------------ drawing

  private char(e: Ent): CharacterDef | undefined {
    return e.charId ? this.engine.character(e.charId) : undefined;
  }

  /** Current image of a character: pose (or walk), and mouth if the pose has one. */
  private frames(e: Ent): Id[] {
    const c = this.char(e);
    const sp = c?.sprites ?? {};
    const pose = e.over ?? e.pose;
    const m = e.over && e.over.startsWith('walk') ? undefined : c?.mouths?.[pose];
    if (m) return [e.mouth ?? m.closed];
    return sp[pose] ?? sp[e.pose] ?? sp.idle ?? Object.values(sp)[0] ?? [];
  }

  /** Resolves an entity's sprite now and paints it: its part of the frame. */
  private draw(e: Ent) {
    this.version++;
    this.out.sprite(this.spriteOf(e));
  }

  /** An entity's sprite as it is now (its image, size, depth, look), and the box a tap is tested against. */
  private spriteOf(e: Ent): SpriteSpec {
    let img: Id | undefined,
      h = e.h;
    if (e.kind === 'prop') img = e.frameImg ?? e.img;
    else {
      const fr = this.frames(e);
      img = fr[e.frame % Math.max(1, fr.length)];
      const idle = this.char(e)?.sprites?.idle?.[0];
      // same scale for all of a character's poses: a crouching pose stays smaller
      const ref = idle ? this.bank.size(idle)[1] : 0;
      const scale = e.scaleWithDepth ? this.walker.scaleAt([e.x, e.y]) : 1;
      if (img && ref) h = (this.bank.size(img)[1] / ref) * e.h * scale;
      else h = e.h * scale;
    }
    const base = {
      id: e.id,
      fx: e.x,
      fy: e.y,
      bob: e.bob,
      z: e.z ?? e.y,
      flip: e.flip,
      flipV: !!e.flipV,
      rot: e.rot ?? 0,
      visible: e.visible,
      opacity: e.opacity,
    };
    if (!img) {
      e.drawn = false;
      e.spec = { ...base, url: null, w: 0, h: 0 };
      return e.spec;
    }
    const w = this.bank.widthFor(img, h);
    const c = e.kind === 'prop' ? undefined : this.char(e);
    const pal = c?.palette && Object.keys(c.palette).length ? c.palette : undefined;
    const url = this.bank.img(img);
    const glow = e.charId ? this.engine.game.characters[e.charId]?.glow : undefined;
    const sw = Math.min(w * 0.7, 46);
    const spec: SpriteSpec = {
      ...base,
      url: (pal && this.palettes.get(url, pal, c?.paletteTolerance ?? 0)) || url,
      w,
      h,
      ...(glow ? { filter: `drop-shadow(0 0 6px ${glow}) drop-shadow(0 0 14px ${glow})` } : {}),
      ...(e.hasShadow
        ? { shadow: { x: e.x - sw / 2, y: e.y - 4, w: sw, h: 8, z: Math.round(e.y) - 1, visible: e.visible } }
        : {}),
    };
    e.spec = spec;
    e.drawn = true;
    // The box a tap is tested against (rotation included): the model's, whatever paints it.
    const rot = e.rot ?? 0;
    const y0 = e.flipV ? 0 : -h,
      y1 = e.flipV ? h : 0;
    if (rot) {
      const a = (rot * Math.PI) / 180,
        co = Math.cos(a),
        sn = Math.sin(a);
      const corners: [number, number][] = [
        [-w / 2, y0],
        [w / 2, y0],
        [-w / 2, y1],
        [w / 2, y1],
      ];
      const pts = corners.map(([px, py]): [number, number] => [e.x + px * co - py * sn, e.y + px * sn + py * co]);
      const xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]);
      e.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    } else e.bbox = [e.x - w / 2, e.y + y0 - e.bob, w, h];
    return spec;
  }

  private tick(t: number) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.camera.tick(t, dt);
    // Prop animations that loop.
    for (const e of this.ents.values()) {
      if (!e.loop) continue;
      e.loop.acc += dt;
      if (e.loop.acc >= 1 / e.loop.fps) {
        e.loop.acc = 0;
        e.loop.i = (e.loop.i + 1) % e.loop.frames.length;
        e.frameImg = e.loop.frames[e.loop.i];
        this.draw(e);
        e.loop.onFrame?.(e.loop.i);
      }
    }
    // Mouths: during speech, t2/t3/t4 at random every 160 to 220 ms; at rest, an occasional blink.
    for (const e of this.ents.values()) {
      if (e.kind === 'prop' || e.over?.startsWith('walk')) continue;
      const m = this.char(e)?.mouths?.[e.over ?? e.pose];
      if (this.talking === e.id) {
        if (t >= e.mouthAt) {
          if (m) {
            const opts = m.open.filter((f) => f !== e.mouth);
            e.mouth = opts[Math.floor(Math.random() * opts.length)] ?? m.closed;
          } else e.bob = e.bob ? 0 : 1.5; // no mouth: same image, slight bob
          e.mouthAt = t + (m ? 160 + Math.random() * 60 : 350);
          this.draw(e);
        }
      } else if (m?.blink) {
        if (e.mouth === m.blink && t >= e.mouthAt) {
          e.mouth = undefined;
          this.draw(e);
        } else if (!e.mouth && t >= e.blinkAt) {
          e.mouth = m.blink;
          e.mouthAt = t + 150;
          e.blinkAt = t + 3000 + Math.random() * 4000;
          this.draw(e);
        }
      }
    }
    // Animated poses (walk, sleeping cat…) at 8 frames per second.
    this.acc += dt;
    if (this.acc < 1 / 8) return;
    this.acc = 0;
    for (const e of this.ents.values()) {
      if (e.kind === 'prop') continue;
      const n = this.frames(e).length;
      if (n > 1) {
        e.frame = (e.frame + 1) % n;
        this.draw(e);
      }
    }
  }

  // ------------------------------------------------------------ queries

  /** Point above the head (for dialogue lines). null if the person isn't in the scene. */
  head(id: Id): Point | null {
    const e = this.ents.get(id);
    if (!e || !e.visible || e.kind === 'prop') return null;
    const scale = e.scaleWithDepth ? this.walker.scaleAt([e.x, e.y]) : 1;
    return [e.x, e.y - e.h * scale - 6];
  }

  pos(id: Id): Point | null {
    const e = this.ents.get(id);
    return e ? [e.x, e.y] : null;
  }

  /** Box of an entity or hotspot, in logical units [x, y, w, h]. */
  box(id: Id): [number, number, number, number] | null {
    const e = this.ents.get(id);
    if (e?.drawn && e.bbox) return e.bbox;
    const h = this.layout.hotspots?.[id];
    if (h?.rect) return h.rect;
    if (h?.poly) {
      const xs = h.poly.map((p) => p[0]),
        ys = h.poly.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    }
    return null;
  }

  /** Whatever is under the finger: the smallest visible thing that contains the point (the frame's hit test). */
  hit(p: Point): Id | null {
    return hitTest(this.frame(), p);
  }

  // ------------------------------------------------------------ presenter commands

  setProp(id: Id, _state: string) {
    this.version++;
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
    if (!frames.length) {
      e.loop = undefined;
      e.frameImg = undefined;
      this.draw(e);
      return;
    }
    void this.bank.preload(new Set(frames));
    e.loop = { frames, fps: fps || 8, i: 0, acc: 0, onFrame };
    e.frameImg = frames[0];
    this.draw(e);
    onFrame?.(0);
  }

  refreshVisibility() {
    this.version++;
    // The stage's conditions (a lit window, a light switched on) are read again with the entities'.
    // Only its conditions can change a built stage (4.1.5): the key is their answers, not the whole spec serialized.
    if (this.room) {
      const st = this.stageSpec();
      const key = stageKey(st);
      if (key !== this.stageKey) {
        this.stageKey = key;
        this.stageNow = st;
        this.out.stage(st);
      }
    }
    for (const e of this.ents.values()) {
      if (e.kind === 'hero') continue;
      const v = this.engine.visible(e.id, this.room);
      if (v !== e.visible) {
        e.visible = v;
        this.draw(e);
      }
    }
  }

  async show(id: Id, visible: boolean, fade: number, fast: boolean) {
    const e = this.ents.get(id);
    if (!e) return;
    if (fast || !fade) {
      e.visible = visible;
      e.opacity = 1;
      this.draw(e);
      return;
    }
    // The fade is the model's (an opacity the painter is given each frame), so every painter fades the same way.
    e.visible = true;
    const from = visible ? 0 : 1,
      to = visible ? 1 : 0,
      t0 = performance.now();
    await new Promise<void>((done) => {
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / fade);
        e.opacity = from + (to - from) * k;
        this.draw(e);
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    e.visible = visible;
    e.opacity = 1;
    this.draw(e);
  }

  face(id: Id, dir: 'left' | 'right') {
    const e = this.ents.get(id);
    if (e) {
      e.flip = dir === 'left';
      this.draw(e);
    }
  }
  pose(id: Id, pose: string) {
    const e = this.ents.get(id);
    if (e) {
      e.pose = pose;
      e.frame = 0;
      this.draw(e);
    }
  }
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
    e.over = pose;
    e.frame = 0;
    this.draw(e);
    await new Promise((r) => setTimeout(r, ms));
    if (e.over === pose) {
      e.over = undefined;
      this.draw(e);
    }
  }

  /**
   * Start or end of a line. The body doesn't change while speaking (only the mouth moves).
   * A long line from a character with no mouths starts with a gesture (`talk`) played once.
   */
  setTalking(id: Id | null, long = false) {
    const prev = this.talking;
    this.talking = id;
    this.version++;
    const now = performance.now();
    const p = prev ? this.ents.get(prev) : undefined;
    if (p) {
      p.mouth = undefined;
      p.bob = 0;
      this.draw(p);
    }
    const e = id ? this.ents.get(id) : undefined;
    if (e) {
      e.mouthAt = now;
      const c = this.char(e);
      if (long && !c?.mouths?.[e.pose] && c?.sprites?.talk && !e.over) void this.anim(e.id, 'talk', 900, false);
      this.draw(e);
    }
  }

  /** Redraws everything (after a state change affecting variants, e.g. a picked-up item). */
  redraw() {
    for (const e of this.ents.values()) {
      if (e.kind === 'prop') this.applyPropState(e);
      this.draw(e);
    }
  }
}
