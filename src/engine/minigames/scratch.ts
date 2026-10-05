import { MINIGAME_META } from './meta';
import type { Minigame, MinigameCtx } from './types';
import { el, finisher, num, stage, str, keys, skipped } from './util';

// Scratch ticket: a silver layer that rubs off under a finger. Ends when `threshold` of the surface is scratched off.
// The hidden text comes from the params (the decrypted sealed ending): the engine never writes it itself.
// Params: ticket (image) required; text, color?, cover?, sfx? (sound while scratching), threshold?, hold?, background?, skippable?

export const scratch: Minigame = {
  ...MINIGAME_META.scratch,
  run(ctx: MinigameCtx) {
    const p = ctx.params;
    const ticket = str(p.ticket, '');
    const pixel = ctx.fonts ? `'${ctx.fonts.pixel}'` : "'Press Start 2P'";
    const threshold = num(p.threshold, 0.55);
    const f = finisher(ctx.signal);
    const box = stage(ctx);
    box.classList.add('mg-scratch');
    box.style.background = str(p.background, 'radial-gradient(ellipse at 50% 45%,#3b2352,#120b1c)');
    if (p.intro) ctx.instruct(str(p.intro, ''));

    const sw = 640 * ctx.u;
    const [tw0, th0] = ctx.size(ticket);
    const w = sw * 0.5, h = (w * th0) / (tw0 || 1);
    const wrap = el('div');
    Object.assign(wrap.style, { position: 'absolute', left: '50%', top: '52%', width: `${w}px`, height: `${h}px`, transform: 'translate(-50%,-50%)' });
    const tk = el('img') as HTMLImageElement; tk.src = ctx.img(ticket); tk.alt = '';
    Object.assign(tk.style, { width: '100%', height: '100%', display: 'block' });
    wrap.append(tk);
    const area = { left: 0.2, top: 0.3, width: 0.6, height: 0.4 };
    const hidden = el('div', '', str(p.text, ''));
    Object.assign(hidden.style, {
      position: 'absolute', left: `${area.left * 100}%`, top: `${area.top * 100}%`, width: `${area.width * 100}%`, height: `${area.height * 100}%`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      font: `${Math.round(w * 0.045)}px ${pixel},monospace`, color: str(p.color, '#d4145a'), lineHeight: '1.4',
    });
    hidden.setAttribute?.('aria-live', 'polite');
    hidden.setAttribute?.('aria-hidden', 'true');
    wrap.append(hidden);
    const cv = el('canvas') as HTMLCanvasElement;
    cv.width = Math.round(w * area.width); cv.height = Math.round(h * area.height);
    Object.assign(cv.style, { position: 'absolute', left: `${area.left * 100}%`, top: `${area.top * 100}%`, width: `${area.width * 100}%`, height: `${area.height * 100}%`, touchAction: 'none', cursor: 'grab', borderRadius: '6px' });
    wrap.append(cv);
    box.append(wrap);

    const g = cv.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, cv.width, cv.height);
    grad.addColorStop(0, '#b8bcc8'); grad.addColorStop(0.5, '#e8eaf0'); grad.addColorStop(1, '#9aa0b0');
    g.fillStyle = grad; g.fillRect(0, 0, cv.width, cv.height);
    if (p.cover) {
      g.fillStyle = '#6a7080'; g.textAlign = 'center';
      g.font = `${Math.round(cv.height * 0.2)}px ${pixel},monospace`;
      g.fillText(str(p.cover, ''), cv.width / 2, cv.height * 0.6);
    }

    let down = false, scratching = 0, revealed = false;
    const scrape = (e: PointerEvent) => {
      if (!down || f.finished || revealed) return;
      const r = cv.getBoundingClientRect();
      scrapeAt(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height);
    };
    const scrapeAt = (x: number, y: number) => {
      if (f.finished || revealed) return;
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(x, y, cv.height * 0.16, 0, Math.PI * 2); g.fill();
      const now = performance.now();
      if (now - scratching > 700) { scratching = now; if (typeof p.sfx === 'string') ctx.sfx(p.sfx); }
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let clear = 0, total = 0;
      for (let i = 3; i < d.length; i += 16) { total++; if (d[i] === 0) clear++; }
      if (clear / total >= threshold && !revealed) {
        // The answer stays shown for a real moment: this is THE moment of the game.
        revealed = true;
        hidden.setAttribute?.('aria-hidden', 'false');
        cv.style.transition = 'opacity .5s'; cv.style.opacity = '0';
        setTimeout(f.finish, num(p.hold, 3200));
      }
    };
    cv.addEventListener('pointerdown', (e) => { down = true; cv.setPointerCapture?.(e.pointerId); scrape(e); });
    cv.addEventListener('pointermove', scrape);
    const up = () => { down = false; };
    // At the keyboard: the arrows move a coin over the silver layer, row by row, and every step scratches.
    const coin = { x: cv.height * 0.16, y: cv.height * 0.16 };
    const stepKey = (dx: number, dy: number) => () => {
      const r = cv.height * 0.16;
      coin.x = Math.max(r * 0.5, Math.min(cv.width - r * 0.5, coin.x + dx * r * 1.2));
      coin.y = Math.max(r * 0.5, Math.min(cv.height - r * 0.5, coin.y + dy * r * 1.2));
      scrapeAt(coin.x, coin.y);
    };
    const offKeys = keys(ctx, { ArrowRight: stepKey(1, 0), ArrowLeft: stepKey(-1, 0), ArrowDown: stepKey(0, 1), ArrowUp: stepKey(0, -1) });
    cv.tabIndex = 0;
    cv.setAttribute?.('role', 'img');
    cv.setAttribute?.('aria-label', ctx.labels.scratch ?? '◀ ▶ ▲ ▼');
    queueMicrotask(() => cv.focus?.({ preventScroll: true }));
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    // No "Skip" button here: scratching is the climax of the ending. The host can add one if it wants to.
    if (p.skippable) {
      const b = el('button', 'mg-skip', ctx.labels.skip) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => { skipped(box); cv.style.opacity = '0'; setTimeout(f.finish, 400); });
      box.append(b);
    }
    return f.promise.then(() => { offKeys(); box.remove(); });
  },
};
