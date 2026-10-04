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
  // The focus goes to Skip unless the minigame already put it on one of its own controls (a keyboard-playable game).
  // Tests drive the minigames with bare element stubs: focus is optional there.
  queueMicrotask(() => {
    const active = (globalThis as { document?: Document }).document?.activeElement;
    if (active && active !== b && (parent as { contains?: (n: Node) => boolean }).contains?.(active)) return;
    b.focus?.({ preventScroll: true });
  });
  return b;
}

/**
 * Keys the minigame answers while it runs, on the page (removed when the minigame is cancelled; call the returned
 * function when it ends). Never steals Tab, nor Enter / Space from a focused button (Skip): those stay the browser's.
 */
export function keys(ctx: MinigameCtx, map: Record<string, (e: KeyboardEvent) => void>): () => void {
  const doc = (ctx.root as unknown as { ownerDocument?: Document }).ownerDocument ?? (globalThis as { document?: Document }).document;
  if (!doc?.addEventListener) return () => {};
  const on = (e: KeyboardEvent) => {
    const f = map[e.key];
    if (!f) return;
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
    e.preventDefault();
    f(e);
  };
  doc.addEventListener('keydown', on);
  const off = () => doc.removeEventListener('keydown', on);
  ctx.signal.addEventListener('abort', off, { once: true });
  return off;
}

/** A non-button element (an image in the scenery, a plug) made operable at the keyboard: focusable, named, Enter / Space. */
export function operable(target: HTMLElement, label: string, onActivate: () => void) {
  target.tabIndex = 0;
  target.setAttribute('role', 'button');
  target.setAttribute('aria-label', label);
  target.addEventListener('keydown', (e: Event) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); onActivate(); }
  });
}

/** Arrow keys move the focus among `items` (a row, or a grid of `cols` columns). */
export function arrowFocus(ctx: MinigameCtx, items: () => HTMLElement[], cols = 0): () => void {
  const step = (d: number) => () => {
    const list = items();
    if (!list.length) return;
    const doc = (globalThis as { document?: Document }).document;
    const i = list.indexOf(doc?.activeElement as HTMLElement);
    const next = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + d));
    list[next].focus?.({ preventScroll: true });
  };
  const v = cols || 1;
  return keys(ctx, { ArrowRight: step(1), ArrowLeft: step(-1), ArrowDown: step(cols ? v : 1), ArrowUp: step(cols ? -v : -1) });
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
