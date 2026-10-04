import type { Minigame, MinigameCtx } from './types';
import { el, finisher, num, skipButton, stage, str, toast } from './util';

// Stroke: slide a finger over the animal. Slowly, the happiness gauge rises; too fast, it drops back down.
// After 5 s with no progress, a ghost hand shows the right speed.
// Params: target (image of the animal), hand (image of the hand) required; goal?, sfx? (success sound), tooFast?, intro?, win?

const SLOW_MIN = 25, SLOW_MAX = 260; // speed in logical units per second

export const stroke: Minigame = {
  required: ['target', 'hand'],
  textParams: ['intro', 'win', 'tooFast'],
  run(ctx: MinigameCtx) {
    const p = ctx.params;
    const target = str(p.target, '');
    const goal = num(p.goal, 100);
    const handId = str(p.hand, '');
    const f = finisher(ctx.signal);
    const box = stage(ctx);
    box.style.background = 'radial-gradient(ellipse at 50% 45%,#3b2a4a,#120b1c)';
    if (p.intro) ctx.instruct(str(p.intro, ''));

    const u = ctx.u;
    const [w0, h0] = ctx.size(target);
    const th = 300, tw = (th * w0) / (h0 || 1);
    const pic = el('img', 'mg-img') as HTMLImageElement;
    pic.src = ctx.img(target); pic.alt = '';
    Object.assign(pic.style, { left: `${(320 - tw / 2) * u}px`, top: `${40 * u}px`, width: `${tw * u}px`, height: `${th * u}px`, transformOrigin: '50% 50%', transition: 'transform .12s' });
    box.append(pic);

    const gauge = el('div', 'mg-gauge'); const fill = el('div'); gauge.append(fill); box.append(gauge);
    const hand = el('img', 'mg-img') as HTMLImageElement;
    hand.src = ctx.img(handId); hand.alt = '';
    Object.assign(hand.style, { width: `${60 * u}px`, opacity: '0', transition: 'opacity .4s', zIndex: '300', transformOrigin: '50% 50%' });
    box.append(hand);

    let level = 0, last: { x: number; t: number; y: number } | null = null, lastProgress = performance.now(), tooFastShown = 0;
    const pt = (e: PointerEvent) => { const r = box.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 640, y: ((e.clientY - r.top) / r.height) * 400 }; };
    const onMove = (e: PointerEvent) => {
      if (!(e.buttons & 1) && e.pointerType === 'mouse') { last = null; return; }
      const q = pt(e), t = performance.now();
      if (last) {
        const dt = Math.max(0.008, (t - last.t) / 1000);
        const v = Math.hypot(q.x - last.x, q.y - last.y) / dt;
        if (v >= SLOW_MIN && v <= SLOW_MAX) { level = Math.min(goal, level + dt * 22); lastProgress = t; pic.style.transform = 'scale(1.02)'; }
        else if (v > SLOW_MAX) {
          level = Math.max(0, level - dt * 40);
          pic.style.transform = 'scale(.97) rotate(-2deg)';
          if (t - tooFastShown > 2500 && p.tooFast) { tooFastShown = t; toast(box, str(p.tooFast, ''), 1200); }
        }
        fill.style.width = `${(level / goal) * 100}%`;
        if (level >= goal && !f.finished) { if (typeof p.sfx === 'string') ctx.sfx(p.sfx); if (p.win) ctx.instruct(str(p.win, '')); setTimeout(f.finish, 1200); level = goal + 1; }
      }
      last = { ...q, t };
    };
    const onUp = () => { last = null; pic.style.transform = ''; };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerdown', (e) => { last = { ...pt(e), t: performance.now() }; box.setPointerCapture?.(e.pointerId); });
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);

    let raf = 0;
    const loop = (now: number) => {
      if (f.finished) return;
      const show = now - lastProgress > 5000 && level < goal;
      hand.style.opacity = show ? '.75' : '0';
      if (show) {
        const k = (Math.sin(now / 900) + 1) / 2; // slow back-and-forth
        Object.assign(hand.style, { left: `${(230 + k * 180) * u}px`, top: `${140 * u}px` });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    ctx.signal.addEventListener('abort', () => cancelAnimationFrame(raf), { once: true });
    skipButton(ctx, box, f.finish);
    return f.promise.then(() => { cancelAnimationFrame(raf); box.remove(); });
  },
};
