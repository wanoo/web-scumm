// The Canvas 2D painter (D10): the same sprites as the DOM painter (dom/render-dom.ts, the reference), drawn on one
// <canvas> the size of the viewport, repainted on the next frame after any change. The room under it moves with
// the camera like the DOM painter's room, so the accessible targets laid over it (a DOM layer in `el`) stay where the
// scene model says. Depth is the draw order (`z`, then arrival); a sprite's transform pivots on its feet, as the DOM
// painter's `transform-origin: 50% 100%`; the backdrop covers the room like `object-fit: cover`.
// The stage: layers at their depth (parallax, blend, opacity), occluders (the backdrop's or a layer's pixels through a
// polygon, a black-and-white mask or the layer's alpha, feathered or inverted) at theirs, the foreground, then lights
// (they fall on the foreground too), then particles (seeded, on the presentation clock: never the engine's dice), then
// the effect layers.
// A lost context (4.1.11: the browser reclaims a canvas's memory, a GPU reset) paints nothing; once restored, the
// caches made from it (the background, the masks, the occluders' pixels) are rebuilt from the images and the frame is
// painted again.
import { must } from '../core/must';
import type { Id } from '../core/types';
import type { EmitterSpec, OccluderSpec, SceneRenderer, SpriteSpec, StageSpec } from './renderer';

export class CanvasRenderer implements SceneRenderer {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private u = 1;
  private width = 640;
  private cam = 0;
  private backdrop: HTMLImageElement | null = null;
  private sprites = new Map<Id, { s: SpriteSpec; order: number }>();
  private images = new Map<string, HTMLImageElement>();
  private order = 0;
  private frame = 0;
  /** Paints drawn so far (the Studio's performance panel, scripts/e2e-perf.mjs). */
  paints = 0;
  private st: StageSpec | null = null;
  /** The backdrop and the still backdrop layers, pre-rendered over the whole room in device pixels: one copy a frame. */
  private bgCache: HTMLCanvasElement | null = null;
  /** Each occluder's alpha mask, in device pixels over the room (rebuilt on resize or when its image arrives). */
  private masks = new Map<Id, HTMLCanvasElement>();
  /** Each occluder's hiding pixels (its source through its mask), composited once. */
  private cuts = new Map<Id, { c: HTMLCanvasElement; x: number; y: number }>();
  /** The images the background and occluder caches are drawn from. */
  private cached = new Set<string>();
  private backdropUrl = '';
  /** Particles: a seeded generator and the live particles of each emitter. */
  private parts = new Map<
    Id,
    {
      seed: number;
      acc: number;
      live: { x: number; y: number; vx: number; vy: number; life: number; age: number; r: number }[];
      last: number;
    }
  >();
  private animating = 0;
  /** The context is lost (`contextlost`) until the browser restores it (`contextrestored`). */
  lost = false;
  private listening = new AbortController();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'room canvas';
    Object.assign(this.el.style, { position: 'absolute', inset: '0' });
    // The canvas is the viewport (640 logical units wide), held in place while the room under it moves with the camera.
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const signal = this.listening.signal;
    this.canvas.addEventListener(
      'contextlost',
      () => {
        this.lost = true;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      },
      { signal },
    );
    this.canvas.addEventListener(
      'contextrestored',
      () => {
        this.lost = false;
        this.bgCache = null;
        this.masks.clear();
        this.cuts.clear();
        this.invalidate();
      },
      { signal },
    );
  }

  private image(url: string): HTMLImageElement {
    let im = this.images.get(url);
    if (!im) {
      im = new Image();
      im.decoding = 'async';
      // Only a picture the caches are made of (the backdrop, a layer, a mask) makes them stale: a character's next
      // frame arriving must not rebuild the occluders (a blur over the whole room) mid-walk.
      im.onload = () => {
        if (this.cached.has(url)) {
          this.bgCache = null;
          this.cuts.clear();
          this.masks.clear();
        }
        this.invalidate();
      };
      im.src = url;
      this.images.set(url, im);
    }
    return im;
  }

  reset(backdrop: string, width: number) {
    this.sprites.clear();
    this.st = null;
    this.bgCache = null;
    this.masks.clear();
    this.cuts.clear();
    this.parts.clear();
    this.order = 0;
    this.width = width;
    this.cached = new Set([backdrop]);
    this.backdropUrl = backdrop;
    this.backdrop = this.image(backdrop);
    this.size();
    this.invalidate();
  }

  sprite(s: SpriteSpec) {
    const prev = this.sprites.get(s.id);
    this.sprites.set(s.id, { s, order: prev?.order ?? this.order++ });
    this.invalidate();
  }

  camera(x: number, width: number, y = 0, zoom = 1) {
    const moved = x !== this.cam || y !== this.camY || zoom !== this.zoom;
    this.cam = x;
    this.camY = y;
    this.zoom = zoom;
    if (width !== this.width) {
      this.width = width;
      this.bgCache = null;
      this.masks.clear();
      this.cuts.clear();
    }
    // The room moves (and zooms) like the DOM painter's; the canvas undoes it, pinned to the viewport.
    this.el.style.transformOrigin = '0 0';
    this.canvas.style.transformOrigin = '0 0';
    if (zoom === 1 && !y) {
      this.el.style.transform = width > 640 ? `translateX(${-x * this.u}px)` : '';
      this.canvas.style.transform = width > 640 ? `translateX(${x * this.u}px)` : '';
    } else {
      this.el.style.transform = `translate(${-x * this.u * zoom}px, ${-y * this.u * zoom}px) scale(${zoom})`;
      this.canvas.style.transform = `scale(${1 / zoom}) translate(${x * this.u * zoom}px, ${y * this.u * zoom}px)`;
    }
    if (moved) this.invalidate();
  }
  private camY = 0;
  private zoom = 1;

  resize(u: number) {
    this.u = u;
    this.size();
    this.bgCache = null;
    this.masks.clear();
    this.cuts.clear();
    this.invalidate();
  }

  stage(s: StageSpec) {
    this.st = s;
    this.bgCache = null;
    this.masks.clear();
    this.cuts.clear();
    this.cached = new Set([
      this.backdropUrl,
      ...s.layers.map((l) => l.url),
      ...s.occluders.flatMap((o) => (o.mask ? [o.mask] : [])),
    ]);
    for (const l of s.layers) this.image(l.url);
    for (const o of s.occluders) if (o.mask) this.image(o.mask);
    for (const e of s.emitters) if (e.url) this.image(e.url);
    this.invalidate();
    // Particles keep the canvas repainting every frame while an emitter shows (never with reduced motion).
    cancelAnimationFrame(this.animating);
    if (!s.reduceMotion && s.emitters.some((e) => e.visible)) {
      const loop = () => {
        this.invalidate();
        this.animating = requestAnimationFrame(loop);
      };
      this.animating = requestAnimationFrame(loop);
    }
  }

  dispose() {
    this.listening.abort();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animating);
    this.sprites.clear();
    this.el.remove();
  }

  /** Device pixels per logical unit. */
  private get k() {
    return this.canvas.width / 640;
  }

  private size() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.round(640 * this.u),
      h = Math.round(400 * this.u);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const pw = Math.round(w * dpr),
      ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  private invalidate() {
    if (this.frame || this.lost) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  /** The room's height in logical units (the scene's, 400 on the reference screen). */
  private get H() {
    return this.el.parentElement?.clientHeight ? this.el.parentElement.clientHeight / this.u : 400;
  }

  /** A canvas over the whole room in device pixels (the background cache, masks, occluders' pixels). */
  private roomCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const m = document.createElement('canvas');
    m.width = Math.ceil(this.width * this.k);
    m.height = this.canvas.height;
    const t = m.getContext('2d')!;
    t.imageSmoothingEnabled = this.smooth;
    t.setTransform(this.k, 0, 0, this.k, 0, 0);
    return [m, t];
  }

  private get smooth() {
    return !this.el.closest('.scene')?.classList.contains('pixel');
  }

  /** The backdrop (as `object-fit: cover`) and the backdrop layers that do not move with a parallax, drawn once. */
  private background(): HTMLCanvasElement | null {
    if (this.bgCache) return this.bgCache;
    const bg = this.backdrop;
    if (!bg?.complete || !bg.naturalWidth) return null;
    const [m, t] = this.roomCanvas();
    const H = this.H;
    const s = Math.max(this.width / bg.naturalWidth, H / bg.naturalHeight);
    const w = bg.naturalWidth * s,
      h = bg.naturalHeight * s;
    t.drawImage(bg, (this.width - w) / 2, (H - h) / 2, w, h);
    for (const l of this.st?.layers ?? [])
      if (l.role === 'backdrop' && l.visible && l.parallax[0] === 1 && l.parallax[1] === 1) this.drawLayer(l, t);
    this.bgCache = m;
    return m;
  }

  /** Copies the visible part of a room-wide canvas onto the viewport, pixel for pixel. */
  private blit(src: HTMLCanvasElement) {
    // The camera's offset as it is, fractions included: the DOM painter translates its room by the same amount.
    const c = this.ctx,
      sx = this.cam * this.k,
      sy = this.camY * this.k;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(
      src,
      sx,
      sy,
      this.canvas.width / this.zoom,
      this.canvas.height / this.zoom,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    c.restore();
  }

  /** Paints now (also what `invalidate` schedules); nothing while the context is lost. */
  paint() {
    if (this.lost) return;
    const c = this.ctx,
      k = this.k,
      cam = this.cam,
      H = this.H;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = this.smooth;
    const bg = this.background();
    if (bg) this.blit(bg);
    // From here, room coordinates: the camera's corner at the canvas's corner, zoomed.
    const kz = k * this.zoom;
    c.setTransform(kz, 0, 0, kz, -cam * kz, -this.camY * kz);
    // Shadows, sprites, layers and occluders, by depth (a shadow sits just under its character), then by arrival.
    const items: { z: number; o: number; draw: () => void }[] = [];
    const st = this.st;
    if (st) {
      st.layers.forEach((l, i) => {
        if (l.visible && !(l.role === 'backdrop' && l.parallax[0] === 1 && l.parallax[1] === 1))
          items.push({ z: l.role === 'backdrop' ? -1e6 + i : l.z, o: -1000 + i, draw: () => this.drawLayer(l, c) });
      });
      st.occluders.forEach((o, i) => items.push({ z: o.z, o: -500 + i, draw: () => this.drawOccluder(o) }));
      const lightZ = 19999;
      st.lights.forEach((l, i) => {
        if (l.visible)
          items.push({
            z: lightZ,
            o: i,
            draw: () => {
              c.save();
              c.globalCompositeOperation = l.blend;
              if (l.kind === 'ambient' || !l.at || !l.radius) {
                c.globalAlpha = l.intensity;
                c.fillStyle = l.color;
                c.fillRect(cam, this.camY, 640 / this.zoom, H / this.zoom);
              } else {
                const g = c.createRadialGradient(l.at[0], l.at[1], 0, l.at[0], l.at[1], l.radius);
                g.addColorStop(0, l.color);
                g.addColorStop(1, 'rgba(0,0,0,0)');
                c.globalAlpha = l.intensity;
                c.fillStyle = g;
                c.fillRect(l.at[0] - l.radius, l.at[1] - l.radius, l.radius * 2, l.radius * 2);
              }
              c.restore();
            },
          });
      });
      if (!st.reduceMotion)
        st.emitters.forEach((e, i) => {
          if (e.visible) items.push({ z: 19999.5, o: i, draw: () => this.drawParticles(e) });
        });
    }
    for (const { s, order } of this.sprites.values()) {
      if (!s.url || !s.visible) continue;
      // Off screen: nothing to draw (a wide room's far end).
      if (s.fx + s.w / 2 < cam - 2 || s.fx - s.w / 2 > cam + 640 / this.zoom + 2) continue;
      const alpha = s.opacity;
      if (s.shadow?.visible) {
        const sh = s.shadow;
        items.push({
          z: sh.z,
          o: order,
          draw: () => {
            c.globalAlpha = alpha;
            c.fillStyle = 'rgba(25, 5, 35, .35)';
            c.beginPath();
            c.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, sh.w / 2, sh.h / 2, 0, 0, Math.PI * 2);
            c.fill();
          },
        });
      }
      const im = this.image(s.url);
      items.push({
        z: Math.round(s.z),
        o: order,
        draw: () => {
          if (!im.complete || !im.naturalWidth) return;
          c.save();
          c.globalAlpha = alpha;
          if (s.filter) c.filter = s.filter;
          if (!s.rot && !s.flipV) {
            // Like the DOM's layout, an upright sprite's box is snapped to device pixels in the room, before the camera's
            // translation (which, like the DOM room's, keeps its fractions).
            const snap = (v: number) => Math.round(v * kz) / kz;
            const x0 = snap(s.fx - s.w / 2),
              x1 = snap(s.fx + s.w / 2);
            const y0 = snap(s.fy - s.h - s.bob),
              y1 = snap(s.fy - s.bob);
            if (s.flip) {
              c.translate(x0 + x1, 0);
              c.scale(-1, 1);
            }
            c.drawImage(im, x0, y0, x1 - x0, y1 - y0);
          } else {
            c.translate(s.fx, s.fy - s.bob);
            if (s.rot) c.rotate((s.rot * Math.PI) / 180);
            if (s.flip || s.flipV) c.scale(s.flip ? -1 : 1, s.flipV ? -1 : 1);
            c.drawImage(im, -s.w / 2, -s.h, s.w, s.h);
          }
          c.restore();
        },
      });
    }
    items.sort((a, b) => a.z - b.z || a.o - b.o);
    for (const it of items) it.draw();
    c.globalAlpha = 1;
    c.filter = 'none';
    c.globalCompositeOperation = 'source-over';
    this.paints++;
  }

  /** A layer at its place, moved by its parallax (the room already moves with the camera: the difference). */
  private drawLayer(l: StageSpec['layers'][number], c: CanvasRenderingContext2D) {
    const im = this.image(l.url);
    if (!im.complete || !im.naturalWidth) return;
    const dx = this.st?.reduceMotion ? 0 : this.cam * (1 - l.parallax[0]);
    c.save();
    c.globalAlpha = l.opacity;
    if (l.blend !== 'normal') c.globalCompositeOperation = l.blend;
    c.drawImage(im, l.x + dx, l.y, l.w, l.h);
    c.restore();
  }

  /**
   * An occluder: what hides is the backdrop (or the layer it names), drawn through its mask: a polygon, a black-and-
   * white image (white hides) or the layer's own alpha; `feather` blurs the mask's edge, `invert` swaps inside and out.
   */
  private drawOccluder(o: OccluderSpec) {
    const st = this.st!;
    const layer = o.layer ? st.layers.find((l) => l.id === o.layer) : undefined;
    if (layer && !o.polygon && !o.mask && !o.feather && !o.invert) {
      if (layer.visible) this.drawLayer(layer, this.ctx);
      return;
    }
    // The pixels that hide never change in a room: composited once (source through mask), then one draw per frame.
    let cut = this.cuts.get(o.id);
    if (!cut) {
      const mask = this.maskOf(o);
      const src = layer ? this.image(layer.url) : this.backdrop;
      if (!mask || !src?.complete || !src.naturalWidth) return;
      const box = layer ? { x: layer.x, y: layer.y, w: layer.w, h: layer.h } : st.backdrop;
      const [m, t] = this.roomCanvas();
      t.drawImage(src, box.x, box.y, box.w, box.h);
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(mask, 0, 0);
      // Kept to the pixels that hide: an occluder is usually a small part of the room, and copying the whole viewport
      // for each one every frame was most of a staged room's frame (BENCH 3.4).
      const b = this.opaqueBox(o, m, t);
      if (!b) {
        this.cuts.set(o.id, (cut = { c: document.createElement('canvas'), x: 0, y: 0 }));
        return;
      }
      const c = document.createElement('canvas');
      c.width = b.w;
      c.height = b.h;
      c.getContext('2d')!.drawImage(m, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
      cut = { c, x: b.x, y: b.y };
      this.cuts.set(o.id, cut);
    }
    if (!cut.c.width) return;
    // The same mapping as `blit`, for a part of the room canvas that starts at (x, y).
    const ctx = this.ctx,
      z = this.zoom,
      sx = this.cam * this.k,
      sy = this.camY * this.k;
    const dx = (cut.x - sx) * z,
      dy = (cut.y - sy) * z,
      dw = cut.c.width * z,
      dh = cut.c.height * z;
    if (dx >= this.canvas.width || dy >= this.canvas.height || dx + dw <= 0 || dy + dh <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cut.c, dx, dy, dw, dh);
    ctx.restore();
  }

  /** The device-pixel box of what an occluder hides: its polygon's bounds widened by the feather, else read from the
   * composited pixels (a mask image, a layer's alpha, an inverted mask). Null when nothing shows. */
  private opaqueBox(
    o: OccluderSpec,
    m: HTMLCanvasElement,
    t: CanvasRenderingContext2D,
  ): { x: number; y: number; w: number; h: number } | null {
    const clamp = (x0: number, y0: number, x1: number, y1: number) => {
      const x = Math.max(0, Math.floor(x0)),
        y = Math.max(0, Math.floor(y0));
      const w = Math.min(m.width, Math.ceil(x1)) - x,
        h = Math.min(m.height, Math.ceil(y1)) - y;
      return w > 0 && h > 0 ? { x, y, w, h } : null;
    };
    if (o.polygon && !o.invert) {
      const k = this.k,
        pad = Math.ceil(3 * o.feather * k) + 2;
      const xs = o.polygon.map((p) => p[0] * k),
        ys = o.polygon.map((p) => p[1] * k);
      return clamp(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad);
    }
    const d = t.getImageData(0, 0, m.width, m.height).data;
    let x0 = m.width,
      y0 = m.height,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < m.height; y++)
      for (let x = 0, i = y * m.width * 4 + 3; x < m.width; x++, i += 4)
        if (d[i]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    return x1 < 0 ? null : clamp(x0, y0, x1 + 1, y1 + 1);
  }

  /** The occluder's alpha mask over the whole room, in device pixels: built once per size, or null until its image loads. */
  private maskOf(o: OccluderSpec): HTMLCanvasElement | null {
    const hit = this.masks.get(o.id);
    if (hit) return hit;
    const [m, t] = this.roomCanvas();
    if (o.feather) t.filter = `blur(${o.feather * this.k}px)`;
    if (o.polygon) {
      t.fillStyle = '#fff';
      t.beginPath();
      o.polygon.forEach(([x, y], i) => (i ? t.lineTo(x, y) : t.moveTo(x, y)));
      t.closePath();
      t.fill();
    } else if (o.mask) {
      const im = this.image(o.mask);
      if (!im.complete || !im.naturalWidth) return null;
      const b = this.st!.backdrop;
      t.drawImage(im, b.x, b.y, b.w, b.h);
      // White hides: the mask's luminance becomes its alpha.
      t.setTransform(1, 0, 0, 1, 0, 0);
      const px = t.getImageData(0, 0, m.width, m.height),
        d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        // RGBA: i + 3 < d.length.
        const red = must(d[i], 'red'),
          green = must(d[i + 1], 'green'),
          blue = must(d[i + 2], 'blue'),
          alpha = must(d[i + 3], 'alpha');
        d[i + 3] = Math.round((red * 0.299 + green * 0.587 + blue * 0.114) * (alpha / 255));
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
      t.putImageData(px, 0, 0);
    } else if (o.layer) {
      const l = this.st!.layers.find((x) => x.id === o.layer);
      const im = l ? this.image(l.url) : null;
      if (!l || !im?.complete || !im.naturalWidth) return null;
      t.drawImage(im, l.x, l.y, l.w, l.h);
    }
    if (o.invert) {
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.filter = 'none';
      t.globalCompositeOperation = 'xor';
      t.fillStyle = '#fff';
      t.fillRect(0, 0, m.width, m.height);
    }
    this.masks.set(o.id, m);
    return m;
  }

  /** An emitter's particles, advanced to now: born at `rate` per second in its area, moving by kind, seeded by its id. */
  private drawParticles(e: EmitterSpec) {
    const c = this.ctx,
      now = performance.now();
    let p = this.parts.get(e.id);
    if (!p) {
      let h = 2166136261;
      for (const ch of e.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      p = { seed: h >>> 0, acc: 0, live: [], last: now };
      this.parts.set(e.id, p);
    }
    const rnd = () => {
      p!.seed = (p!.seed + 0x6d2b79f5) >>> 0;
      let t = p!.seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const dt = Math.min(0.1, (now - p.last) / 1000);
    p.last = now;
    const [ax, ay, aw, ah] = e.area;
    const motion: Record<EmitterSpec['kind'], () => [number, number, number, number]> = {
      dust: () => [(rnd() - 0.5) * 6, (rnd() - 0.5) * 6, 6, 1.2],
      rain: () => [-20, 420, 1.2, 1],
      snow: () => [(rnd() - 0.5) * 20, 30 + rnd() * 20, 8, 2],
      sparks: () => [(rnd() - 0.5) * 80, -60 - rnd() * 60, 0.8, 1.2],
      smoke: () => [(rnd() - 0.5) * 10, -20 - rnd() * 10, 5, 4],
      leaves: () => [20 + rnd() * 20, 25 + rnd() * 15, 9, 3],
    };
    p.acc += dt * e.rate;
    while (p.acc >= 1 && p.live.length < 400) {
      p.acc -= 1;
      const [vx, vy, life, r] = motion[e.kind]();
      p.live.push({
        x: ax + rnd() * aw,
        y: e.kind === 'rain' || e.kind === 'snow' || e.kind === 'leaves' ? ay : ay + rnd() * ah,
        vx,
        vy,
        life,
        age: 0,
        r,
      });
    }
    c.save();
    c.fillStyle = e.color;
    c.strokeStyle = e.color;
    const im = e.url ? this.image(e.url) : null;
    p.live = p.live.filter((q) => {
      q.age += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.age > q.life || q.y > ay + ah + 20) return false;
      c.globalAlpha = Math.max(0, 1 - q.age / q.life) * (e.kind === 'smoke' ? 0.35 : 0.8);
      if (im?.complete && im.naturalWidth) c.drawImage(im, q.x - q.r * 2, q.y - q.r * 2, q.r * 4, q.r * 4);
      else if (e.kind === 'rain') {
        c.beginPath();
        c.moveTo(q.x, q.y);
        c.lineTo(q.x - 2, q.y + 9);
        c.lineWidth = 1;
        c.stroke();
      } else {
        c.beginPath();
        c.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        c.fill();
      }
      return true;
    });
    c.restore();
  }
}
