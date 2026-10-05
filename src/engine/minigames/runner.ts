import { MINIGAME_META } from './meta';
import type { Minigame, MinigameCtx } from './types';
import { el, finisher, move, num, put, skipButton, stage, str, toast, keys } from './util';
import { must } from '../core/must';

// Runner: top of the screen = jump (ground obstacles), bottom = duck (hanging obstacles).
// A mistake makes the hero stumble and lets the chaser close in, though it never catches up. Ends after `seconds`.
//
// Params (all images come from the game):
//   hero      { run: Id[], jump, slide, stumble, h?, slideH? }   the front runner
//   buddy?    { run: Id[], jump, slide, stumble, h?, slideH? }   a second runner, behind
//   chaser    { frames: Id[], fps?, x?, speed?, h? }              the chaser (frame-by-frame animation)
//   obstacles { jump: Id, duck: Id }                              to jump over (on the ground), to duck under (hanging)
//   bg        Id                                                  scrolling backdrop (mirrored loop)
//   seconds?, intro?, win?, stumble? (text for a stumble)

/** A runner: running, jump, slide and stumble images, and standing height. */
interface RunnerSprites {
  run: [string, ...string[]];
  jump: string;
  slide: string;
  stumble: string;
  h: number;
  slideH: number;
}
const GROUND = 392,
  CARPET_Y = 330,
  AX = 430,
  PX = 320;

function sprites(v: unknown, h: number, slideH: number): RunnerSprites | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<RunnerSprites>;
  const [first, ...rest] = Array.isArray(o.run) ? o.run.map(String) : [];
  if (first === undefined) return null;
  return {
    run: [first, ...rest],
    jump: str(o.jump, first),
    slide: str(o.slide, first),
    stumble: str(o.stumble, first),
    h: num(o.h, h),
    slideH: num(o.slideH, slideH),
  };
}

export const runner: Minigame = {
  ...MINIGAME_META.runner,
  run(ctx: MinigameCtx) {
    const p = ctx.params;
    const seconds = num(p.seconds, 20);
    const f = finisher(ctx.signal);
    const box = stage(ctx);
    if (p.intro) ctx.instruct(str(p.intro, ''));

    // scrolling backdrop: the image then its mirrored copy, for a seamless loop
    const bgId = str(p.bg, '');
    const strip = el('div');
    Object.assign(strip.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      height: '100%',
      width: '400%',
      display: 'flex',
      willChange: 'transform',
    });
    for (let i = 0; i < 4; i++) {
      const im = el('img') as HTMLImageElement;
      im.src = ctx.img(bgId);
      im.alt = '';
      Object.assign(im.style, {
        height: '100%',
        width: '25%',
        objectFit: 'cover',
        transform: i % 2 ? 'scaleX(-1)' : '',
      });
      strip.append(im);
    }
    box.append(strip);

    const H = sprites(p.hero, 84, 46) ?? { run: [''], jump: '', slide: '', stumble: '', h: 84, slideH: 46 };
    const B = sprites(p.buddy, 110, 60);
    const ob = (p.obstacles && typeof p.obstacles === 'object' ? p.obstacles : {}) as {
      jump?: unknown;
      duck?: unknown;
    };
    const BASKET = str(ob.jump, ''),
      CARPET = str(ob.duck, BASKET);
    // The chaser: a frame-by-frame animation, always behind the heroes.
    const ch = (p.chaser && typeof p.chaser === 'object' ? p.chaser : {}) as {
      frames?: unknown;
      fps?: unknown;
      x?: unknown;
      speed?: unknown;
      h?: unknown;
    };
    const ballFrames = Array.isArray(ch.frames) && ch.frames.length ? ch.frames.map(String) : [''];
    const ballFps = num(ch.fps, 13),
      ballHome = num(ch.x, 95),
      ballBack = num(ch.speed, 12),
      ballH = num(ch.h, 130);
    const ball = put(ctx, box, must(ballFrames[0], 'first ball frame'), ballHome, GROUND + 6, ballH, 50);
    const runner2 = B ? put(ctx, box, B.run[0], PX, GROUND, B.h, 60) : null;
    const lead = put(ctx, box, H.run[0], AX, GROUND, H.h, 61);

    const fs = `${Math.max(9, 12 * ctx.u)}px`;
    const zt = el('div', 'mg-zone', `▲ ${ctx.labels.jump}`);
    Object.assign(zt.style, {
      top: '0',
      alignItems: 'center',
      fontSize: fs,
      background: 'linear-gradient(transparent,rgba(80,160,255,.12))',
    });
    const zb = el('div', 'mg-zone', `▼ ${ctx.labels.duck}`);
    Object.assign(zb.style, {
      top: '50%',
      alignItems: 'flex-end',
      fontSize: fs,
      background: 'linear-gradient(rgba(255,210,80,.12),transparent)',
      borderTop: '2px dashed rgba(255,255,255,.35)',
    });
    box.append(zt, zb);
    const bar = el('div', 'mg-bar');
    const fill = el('div');
    bar.append(fill);
    box.append(bar);

    let act: 'jump' | 'duck' | null = null,
      actT = 0;
    zt.addEventListener('pointerdown', () => {
      if (!act) {
        act = 'jump';
        actT = 0;
      }
    });
    zb.addEventListener('pointerdown', () => {
      if (!act) {
        act = 'duck';
        actT = 0;
      }
    });
    // At the keyboard: ▲ / W jumps, ▼ / S ducks (Space and Enter stay with the focused Skip button).
    const jump = () => {
      if (!act) {
        act = 'jump';
        actT = 0;
      }
    };
    const duck = () => {
      if (!act) {
        act = 'duck';
        actT = 0;
      }
    };
    const offKeys = keys(ctx, { ArrowUp: jump, w: jump, W: jump, ArrowDown: duck, s: duck, S: duck });

    type Obs = { type: 'basket' | 'carpet'; x: number; hit: boolean; spr: ReturnType<typeof put> };
    let obs: Obs[] = [];
    let t0 = performance.now(),
      last = t0,
      frame = 0,
      ballX = ballHome,
      next = 1.2,
      done = false,
      raf = 0,
      count = 0,
      streak = 0,
      stumbleT = 0,
      ballF = 0;
    let scroll = 0;

    const loop = (now: number) => {
      if (f.finished) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      frame += dt * 10;
      fill.style.width = `${Math.min(100, (t / seconds) * 100)}%`;
      if (!done) {
        scroll = (scroll + dt * 6.5) % 50;
        strip.style.transform = `translateX(-${scroll}%)`;
      }
      if (t > seconds && !done) {
        done = true;
        obs.forEach((o) => o.spr.el.remove());
        obs = [];
        if (p.win) ctx.instruct(str(p.win, ''));
        setTimeout(f.finish, 1500);
      }
      if (!done) {
        next -= dt;
        if (next <= 0) {
          next = 1.7 + Math.random() * 0.6;
          const type: Obs['type'] = count++ % 2 === 0 || Math.random() < 0.5 ? 'basket' : 'carpet';
          obs.push({
            type,
            x: 700,
            hit: false,
            spr: put(
              ctx,
              box,
              type === 'basket' ? BASKET : CARPET,
              700,
              type === 'basket' ? GROUND : CARPET_Y,
              type === 'basket' ? 44 : 74,
              70,
            ),
          });
        }
      }
      for (const o of obs) {
        o.x -= 260 * dt;
        move(ctx, o.spr, o.x, o.type === 'basket' ? GROUND : CARPET_Y);
        if (!o.hit && o.x < AX + 10 && o.x > AX - 20) {
          o.hit = true;
          const safe = o.type === 'basket' ? act === 'jump' : act === 'duck';
          if (!safe) {
            // the chaser closes in, but always stops behind the second runner
            ballX = Math.min(PX - 95, ballX + 45);
            streak = 0;
            stumbleT = 0.5;
            if (p.stumble) toast(box, str(p.stumble, ''), 800);
          } else if (++streak >= 2) {
            ballX = Math.max(ballHome, ballX - 25);
            streak = 0;
          }
        }
      }
      obs = obs.filter((o) => {
        if (o.x < -60) {
          o.spr.el.remove();
          return false;
        }
        return true;
      });
      ballX = Math.max(ballHome, ballX - ballBack * dt);
      if (!done) ballF += dt * ballFps;
      move(ctx, ball, ballX, GROUND + 6, ballH, ballFrames[Math.floor(ballF) % ballFrames.length]);
      if (stumbleT > 0) stumbleT -= dt;
      if (act) {
        actT += dt;
        if (actT > 0.75) act = null;
      }
      const arc = (k: number) => GROUND - Math.sin(Math.min(1, Math.max(0, k) / 0.75) * Math.PI) * 70;
      if (!done) {
        const st = stumbleT > 0 && !act;
        move(
          ctx,
          lead,
          AX,
          act === 'jump' ? arc(actT) : GROUND,
          act === 'duck' ? H.slideH : H.h,
          st ? H.stumble : act === 'jump' ? H.jump : act === 'duck' ? H.slide : H.run[Math.floor(frame) % H.run.length],
        );
        if (runner2 && B)
          move(
            ctx,
            runner2,
            PX,
            act === 'jump' ? arc(actT - 0.1) : GROUND,
            act === 'duck' ? B.slideH : B.h,
            st
              ? B.stumble
              : act === 'jump'
                ? B.jump
                : act === 'duck'
                  ? B.slide
                  : B.run[Math.floor(frame) % B.run.length],
          );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    ctx.signal.addEventListener('abort', () => cancelAnimationFrame(raf), { once: true });
    skipButton(ctx, box, () => {
      if (!done) t0 = performance.now() - (seconds + 1) * 1000;
      else f.finish();
    });
    return f.promise.then(() => {
      cancelAnimationFrame(raf);
      offKeys();
      box.remove();
    });
  },
};
