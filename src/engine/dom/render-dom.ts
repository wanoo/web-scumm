// The DOM painter (the reference, D10): the backdrop is an <img>, each sprite an <img> with its shadow a <div>, depth
// is the z-index, the camera a CSS translation of the room. The scene model (dom/room.ts) decides everything else.
import type { Id } from '../core/types';
import type { SceneRenderer, SpriteSpec } from './renderer';

export class DomRenderer implements SceneRenderer {
  readonly el: HTMLDivElement;
  private u = 1;
  private width = 640;
  private bg: HTMLImageElement | null = null;
  private sprites = new Map<Id, { img: HTMLImageElement; shadow?: HTMLDivElement; last?: SpriteSpec }>();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'room';
    Object.assign(this.el.style, { position: 'absolute', inset: '0' });
  }

  reset(backdrop: string, width: number) {
    this.el.innerHTML = '';
    this.sprites.clear();
    this.width = width;
    const bg = document.createElement('img');
    bg.className = 'bg'; bg.alt = ''; bg.draggable = false; bg.src = backdrop;
    bg.style.width = `${width * this.u}px`;
    this.el.append(bg);
    this.bg = bg;
  }

  sprite(s: SpriteSpec) {
    let r = this.sprites.get(s.id);
    if (!r) {
      const img = document.createElement('img');
      img.className = 'spr'; img.alt = ''; img.draggable = false;
      r = { img };
      if (s.shadow) { r.shadow = document.createElement('div'); r.shadow.className = 'shadow'; this.el.append(r.shadow); }
      this.el.append(img);
      this.sprites.set(s.id, r);
    }
    r.last = s;
    this.paint(r.img, r.shadow, s);
  }

  private paint(el: HTMLImageElement, shadow: HTMLDivElement | undefined, s: SpriteSpec) {
    const u = this.u;
    if (!s.url) { el.style.display = 'none'; if (shadow) shadow.style.display = 'none'; return; }
    if (el.dataset.src !== s.url) { el.src = s.url; el.dataset.src = s.url; }
    if ((el.style.filter || '') !== (s.filter ?? '')) el.style.filter = s.filter ?? '';
    Object.assign(el.style, {
      display: '', left: `${(s.fx - s.w / 2) * u}px`, top: `${(s.fy - s.h - s.bob) * u}px`, width: `${s.w * u}px`, height: `${s.h * u}px`,
      zIndex: String(Math.round(s.z)), opacity: !s.visible ? '0' : s.opacity < 1 ? String(s.opacity) : '', visibility: s.visible ? '' : 'hidden',
    });
    el.classList.toggle('flip', s.flip);
    el.style.transform = s.rot || s.flipV ? `rotate(${s.rot}deg) scale(${s.flip ? -1 : 1}, ${s.flipV ? -1 : 1})` : '';
    if (shadow && s.shadow) Object.assign(shadow.style, { display: s.shadow.visible ? '' : 'none', left: `${s.shadow.x * u}px`, top: `${s.shadow.y * u}px`, width: `${s.shadow.w * u}px`, height: `${s.shadow.h * u}px`, zIndex: String(Math.round(s.shadow.z)) });
  }

  camera(x: number, width: number) {
    this.width = width;
    this.el.style.transform = width > 640 ? `translateX(${-x * this.u}px)` : '';
  }

  resize(u: number) {
    this.u = u;
    if (this.bg) this.bg.style.width = `${this.width * u}px`;
    for (const r of this.sprites.values()) if (r.last) this.paint(r.img, r.shadow, r.last);
  }

  dispose() { this.el.innerHTML = ''; this.sprites.clear(); }
  /** Paints done (the DOM paints as it goes: always 0). */
  paints = 0;
}
