// The Canvas 2D painter (D10): the same sprites as the DOM painter (dom/render-dom.ts, the reference), drawn on one
// <canvas> per room, repainted on the next frame after any change. The canvas spans the room's width and moves with
// the camera like the DOM painter's room, so the accessible targets laid over it (a DOM layer in `el`) stay where the
// scene model says. Depth is the draw order (`z`, then arrival); a sprite's transform pivots on its feet, as the DOM
// painter's `transform-origin: 50% 100%`; the backdrop covers the room like `object-fit: cover`.
import type { Id } from '../core/types';
import type { SceneRenderer, SpriteSpec } from './renderer';

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

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'room canvas';
    Object.assign(this.el.style, { position: 'absolute', inset: '0' });
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  private image(url: string): HTMLImageElement {
    let im = this.images.get(url);
    if (!im) {
      im = new Image();
      im.decoding = 'async';
      im.onload = () => this.invalidate();
      im.src = url;
      this.images.set(url, im);
    }
    return im;
  }

  reset(backdrop: string, width: number) {
    this.sprites.clear();
    this.order = 0;
    this.width = width;
    this.backdrop = this.image(backdrop);
    this.size();
    this.invalidate();
  }

  sprite(s: SpriteSpec) {
    const prev = this.sprites.get(s.id);
    this.sprites.set(s.id, { s, order: prev?.order ?? this.order++ });
    this.invalidate();
  }

  camera(x: number, width: number) {
    this.cam = x;
    if (width !== this.width) { this.width = width; this.size(); }
    this.el.style.transform = width > 640 ? `translateX(${-x * this.u}px)` : '';
  }

  resize(u: number) { this.u = u; this.size(); this.invalidate(); }

  dispose() { cancelAnimationFrame(this.frame); this.sprites.clear(); this.el.remove(); }

  private size() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.round(this.width * this.u), h = Math.round(400 * this.u);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
  }

  private invalidate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); });
  }

  /** Paints now (also what `invalidate` schedules). */
  paint() {
    const c = this.ctx, k = this.canvas.width / Math.max(1, this.width);
    const H = this.el.parentElement?.clientHeight ? this.el.parentElement.clientHeight / this.u : 400;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = !this.el.closest('.scene')?.classList.contains('pixel');
    c.setTransform(k, 0, 0, k, 0, 0);
    // The backdrop, as `object-fit: cover` over the room's width and the scene's height.
    const bg = this.backdrop;
    if (bg?.complete && bg.naturalWidth) {
      const s = Math.max(this.width / bg.naturalWidth, H / bg.naturalHeight);
      const w = bg.naturalWidth * s, h = bg.naturalHeight * s;
      c.drawImage(bg, (this.width - w) / 2, (H - h) / 2, w, h);
    }
    // Shadows and sprites, by depth (a shadow sits just under its character), then by arrival.
    const items: { z: number; o: number; draw: () => void }[] = [];
    for (const { s, order } of this.sprites.values()) {
      if (!s.url || !s.visible) continue;
      const alpha = s.opacity;
      if (s.shadow?.visible) { const sh = s.shadow; items.push({ z: sh.z, o: order, draw: () => { c.globalAlpha = alpha; c.fillStyle = 'rgba(25, 5, 35, .35)'; c.beginPath(); c.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, sh.w / 2, sh.h / 2, 0, 0, Math.PI * 2); c.fill(); } }); }
      const im = this.image(s.url);
      items.push({ z: Math.round(s.z), o: order, draw: () => {
        if (!im.complete || !im.naturalWidth) return;
        c.save();
        c.globalAlpha = alpha;
        if (s.filter) c.filter = s.filter;
        if (!s.rot && !s.flipV) {
          // Like the DOM's layout, an upright sprite's box is snapped to device pixels (else every edge resamples).
          const x0 = Math.round((s.fx - s.w / 2) * k) / k, x1 = Math.round((s.fx + s.w / 2) * k) / k;
          const y0 = Math.round((s.fy - s.h - s.bob) * k) / k, y1 = Math.round((s.fy - s.bob) * k) / k;
          if (s.flip) { c.translate(x0 + x1, 0); c.scale(-1, 1); }
          c.drawImage(im, x0, y0, x1 - x0, y1 - y0);
        } else {
          c.translate(s.fx, s.fy - s.bob);
          if (s.rot) c.rotate((s.rot * Math.PI) / 180);
          if (s.flip || s.flipV) c.scale(s.flip ? -1 : 1, s.flipV ? -1 : 1);
          c.drawImage(im, -s.w / 2, -s.h, s.w, s.h);
        }
        c.restore();
      } });
    }
    items.sort((a, b) => a.z - b.z || a.o - b.o);
    for (const it of items) it.draw();
    c.globalAlpha = 1;
    c.filter = 'none';
    this.paints++;
  }
}
