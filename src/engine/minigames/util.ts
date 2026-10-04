import type { MinigameCtx } from './types';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/** Creates the minigame's container in root; it's removed when the signal is cancelled or at the end. */
export function stage(ctx: MinigameCtx): HTMLDivElement {
  const box = el('div', 'mg');
  ctx.root.append(box);
  ctx.signal.addEventListener('abort', () => box.remove(), { once: true });
  return box;
}

/** Image positioned by its feet (bottom-center) in logical 640 × 400 coordinates, height h. */
export interface Spr { el: HTMLImageElement; id: string; x: number; y: number; h: number }
export function put(ctx: MinigameCtx, parent: HTMLElement, id: string, x: number, y: number, h: number, z = Math.round(y), flip = false): Spr {
  const im = el('img', 'mg-img') as HTMLImageElement;
  im.alt = '';
  im.draggable = false;
  if (flip) im.style.transform = 'scaleX(-1)';
  parent.append(im);
  const s: Spr = { el: im, id: '', x, y, h };
  move(ctx, s, x, y, h, id);
  im.style.zIndex = String(z);
  return s;
}
export function move(ctx: MinigameCtx, s: Spr, x: number, y: number, h = s.h, id = s.id) {
  if (id !== s.id) { s.el.src = ctx.img(id); s.id = id; }
  const [w0, h0] = ctx.size(id);
  const w = h * (w0 / (h0 || 1));
  const u = ctx.u;
  Object.assign(s.el.style, { left: `${(x - w / 2) * u}px`, top: `${(y - h) * u}px`, width: `${w * u}px`, height: `${h * u}px` });
  s.x = x; s.y = y; s.h = h;
}

/** Always-present "Skip" button. */
export function skipButton(ctx: MinigameCtx, parent: HTMLElement, onSkip: () => void): HTMLButtonElement {
  const b = el('button', 'mg-skip', ctx.labels.skip);
  b.type = 'button';
  b.style.fontSize = `${Math.max(12, 13 * ctx.u)}px`;
  b.addEventListener('click', (e) => { e.stopPropagation(); onSkip(); });
  parent.append(b);
  // Tests drive the minigames with bare element stubs: focus is optional there.
  queueMicrotask(() => b.focus?.({ preventScroll: true }));
  return b;
}

export function toast(parent: HTMLElement, text: string, ms = 1400) {
  const t = el('div', 'mg-toast', text);
  parent.append(t);
  setTimeout(() => t.remove(), ms);
}

export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

export function str(v: unknown, d: string): string { return typeof v === 'string' ? v : d; }
export function num(v: unknown, d: number): number { return typeof v === 'number' && isFinite(v) ? v : d; }

/** Promise that resolves only once, and also if the signal is cancelled. */
export function finisher(signal: AbortSignal) {
  let done!: () => void;
  let finished = false;
  const p = new Promise<void>((res) => { done = res; });
  const finish = () => { if (!finished) { finished = true; done(); } };
  signal.addEventListener('abort', finish, { once: true });
  return { promise: p, finish, get finished() { return finished; } };
}
