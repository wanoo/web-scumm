// The DOM painter (the reference, D10): the backdrop is an <img>, each sprite an <img> with its shadow a <div>, depth
// is the z-index, the camera a CSS translation of the room. The scene model (dom/room.ts) decides everything else.
// The stage: layers are <img>s at their depth with their parallax, an occluder with a polygon is the backdrop's
// pixels clipped to it at its depth; masks from images or layers, lights and particles are the canvas painter's.
import type { Id } from '../core/types';
import type { SceneRenderer, SpriteSpec, StageSpec } from './renderer';

export class DomRenderer implements SceneRenderer {
  readonly el: HTMLDivElement;
  private u = 1;
  private width = 640;
  private bg: HTMLImageElement | null = null;
  private sprites = new Map<Id, { img: HTMLImageElement; shadow?: HTMLDivElement; last?: SpriteSpec }>();
  private stageEls: HTMLElement[] = [];
  private st: StageSpec | null = null;
  private cam = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'room';
    Object.assign(this.el.style, { position: 'absolute', inset: '0' });
  }

  reset(backdrop: string, width: number) {
    this.el.innerHTML = '';
    this.sprites.clear();
    this.stageEls = [];
    this.st = null;
    this.width = width;
    const bg = document.createElement('img');
    bg.className = 'bg';
    bg.alt = '';
    bg.draggable = false;
    bg.src = backdrop;
    bg.style.width = `${width * this.u}px`;
    this.el.append(bg);
    this.bg = bg;
  }

  sprite(s: SpriteSpec) {
    let r = this.sprites.get(s.id);
    if (!r) {
      const img = document.createElement('img');
      img.className = 'spr';
      img.alt = '';
      img.draggable = false;
      r = { img };
      if (s.shadow) {
        r.shadow = document.createElement('div');
        r.shadow.className = 'shadow';
        this.el.append(r.shadow);
      }
      this.el.append(img);
      this.sprites.set(s.id, r);
    }
    r.last = s;
    this.paint(r.img, r.shadow, s);
  }

  private paint(el: HTMLImageElement, shadow: HTMLDivElement | undefined, s: SpriteSpec) {
    const u = this.u;
    if (!s.url) {
      el.style.display = 'none';
      if (shadow) shadow.style.display = 'none';
      return;
    }
    if (el.dataset.src !== s.url) {
      el.src = s.url;
      el.dataset.src = s.url;
    }
    if ((el.style.filter || '') !== (s.filter ?? '')) el.style.filter = s.filter ?? '';
    Object.assign(el.style, {
      display: '',
      left: `${(s.fx - s.w / 2) * u}px`,
      top: `${(s.fy - s.h - s.bob) * u}px`,
      width: `${s.w * u}px`,
      height: `${s.h * u}px`,
      zIndex: String(Math.round(s.z)),
      opacity: !s.visible ? '0' : s.opacity < 1 ? String(s.opacity) : '',
      visibility: s.visible ? '' : 'hidden',
    });
    el.classList.toggle('flip', s.flip);
    el.style.transform = s.rot || s.flipV ? `rotate(${s.rot}deg) scale(${s.flip ? -1 : 1}, ${s.flipV ? -1 : 1})` : '';
    if (shadow && s.shadow)
      Object.assign(shadow.style, {
        display: s.shadow.visible ? '' : 'none',
        left: `${s.shadow.x * u}px`,
        top: `${s.shadow.y * u}px`,
        width: `${s.shadow.w * u}px`,
        height: `${s.shadow.h * u}px`,
        zIndex: String(Math.round(s.shadow.z)),
      });
  }

  camera(x: number, width: number, y = 0, zoom = 1) {
    this.width = width;
    this.cam = x;
    // Zoom 1 and no vertical move: the same translation as ever (the old rooms' pictures do not change).
    this.el.style.transformOrigin = '0 0';
    this.el.style.transform =
      zoom === 1 && !y
        ? width > 640
          ? `translateX(${-x * this.u}px)`
          : ''
        : `translate(${-x * this.u * zoom}px, ${-y * this.u * zoom}px) scale(${zoom})`;
    if (this.st?.layers.some((l) => l.parallax[0] !== 1)) this.placeStage();
  }

  resize(u: number) {
    this.u = u;
    if (this.bg) this.bg.style.width = `${this.width * u}px`;
    for (const r of this.sprites.values()) if (r.last) this.paint(r.img, r.shadow, r.last);
    if (this.st) this.placeStage();
  }

  stage(s: StageSpec) {
    this.st = s;
    for (const e of this.stageEls) e.remove();
    this.stageEls = [];
    for (const l of s.layers) {
      const im = document.createElement('img');
      im.className = 'layer';
      im.alt = '';
      im.draggable = false;
      im.src = l.url;
      im.dataset.layer = l.id;
      this.el.append(im);
      this.stageEls.push(im);
    }
    for (const o of s.occluders) {
      if (!o.polygon) continue; // masks and layer alphas: the canvas painter's
      const d = document.createElement('div');
      d.className = 'occluder';
      d.dataset.occluder = o.id;
      this.el.append(d);
      this.stageEls.push(d);
    }
    this.placeStage();
  }

  /** Positions the stage's elements (after a resize, a camera move with parallax, a new stage). */
  private placeStage() {
    const s = this.st,
      u = this.u;
    if (!s) return;
    const b = s.backdrop;
    for (const e of this.stageEls) {
      const l = e.dataset.layer ? s.layers.find((x) => x.id === e.dataset.layer) : undefined;
      if (l) {
        const dx = s.reduceMotion ? 0 : this.cam * (1 - l.parallax[0]);
        Object.assign(e.style, {
          position: 'absolute',
          pointerEvents: 'none',
          left: `${(l.x + dx) * u}px`,
          top: `${l.y * u}px`,
          width: `${l.w * u}px`,
          height: `${l.h * u}px`,
          zIndex: String(Math.round(l.role === 'backdrop' ? 1 : l.z)),
          opacity: l.visible ? String(l.opacity) : '0',
          visibility: l.visible ? '' : 'hidden',
        });
        continue;
      }
      const o = s.occluders.find((x) => x.id === e.dataset.occluder);
      if (!o?.polygon) continue;
      // The backdrop's own pixels inside the polygon, at the occluder's depth: whoever stands deeper passes behind.
      Object.assign(e.style, {
        position: 'absolute',
        pointerEvents: 'none',
        left: '0',
        top: '0',
        width: `${this.width * u}px`,
        height: `${400 * u}px`,
        zIndex: String(Math.round(o.z)),
        backgroundImage: `url("${b.url}")`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${b.w * u}px ${b.h * u}px`,
        backgroundPosition: `${b.x * u}px ${b.y * u}px`,
        clipPath: `polygon(${o.polygon.map(([x, y]) => `${x * u}px ${y * u}px`).join(', ')})`,
      });
    }
  }

  dispose() {
    this.el.innerHTML = '';
    this.sprites.clear();
  }
  /** Paints done (the DOM paints as it goes: always 0). */
  paints = 0;
}
