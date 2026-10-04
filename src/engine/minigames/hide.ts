import type { Minigame, MinigameCtx } from './types';
import { el, finisher, num, put, skipButton, sleep, stage, str } from './util';

// Hide-and-seek: touch the right hiding spot in the scenery. Each wrong spot replies (and the hint gets clearer).

interface Spot { img: string; x: number; y: number; h: number; reply?: string; found?: string; flip?: boolean }

export const hide: Minigame = {
  required: ['spots'],
  textParams: ['intro', 'win', 'spots.*.reply'],
  run(ctx: MinigameCtx) {
    const p = ctx.params;
    const spots = (Array.isArray(p.spots) ? p.spots : []) as Spot[];
    const answer = num(p.answer, spots.length - 1);
    const f = finisher(ctx.signal);
    const box = stage(ctx);
    if (typeof p.bg === 'string') {
      const bg = el('img') as HTMLImageElement;
      bg.src = ctx.img(p.bg); bg.alt = '';
      Object.assign(bg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' });
      box.append(bg);
    }
    if (p.intro) ctx.instruct(str(p.intro, ''));
    let busy = false;
    spots.forEach((s, i) => {
      const spr = put(ctx, box, s.img, s.x, s.y, s.h, Math.round(s.y), !!s.flip);
      spr.el.style.pointerEvents = 'auto';
      spr.el.style.cursor = 'pointer';
      spr.el.addEventListener('click', async () => {
        if (busy || f.finished) return;
        if (i === answer) {
          busy = true;
          if (s.found) spr.el.src = ctx.img(s.found);
          spr.el.classList.add('mg-pop');
          if (p.win) ctx.instruct(str(p.win, ''));
          await sleep(1400, ctx.signal);
          f.finish();
        } else {
          spr.el.classList.remove('mg-shake'); void spr.el.offsetWidth; spr.el.classList.add('mg-shake');
          if (s.found) { const prev = spr.el.src; spr.el.src = ctx.img(s.found); setTimeout(() => { spr.el.src = prev; }, 1200); }
          if (s.reply) ctx.instruct(s.reply);
        }
      });
    });
    skipButton(ctx, box, f.finish);
    return f.promise.then(() => box.remove());
  },
};
