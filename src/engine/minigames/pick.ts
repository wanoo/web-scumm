import { MINIGAME_META } from './meta';
import type { Minigame, MinigameCtx } from './types';
import { arrowFocus, el, finisher, sleep, skipButton, stage, str } from './util';

// Pick the right image (a color, a flag…), round after round.
// Wrong pick: a little shake and try again. Trap image (`decoy`): a funny line (`decoyLine`).
// Params: rounds [{ prompt?, options: Id[], answer }] (required), decoy?, decoyLine?, wrongLine?, background?, win?

interface Round { prompt?: string; options: string[]; answer: number }

export const pick: Minigame = {
  ...MINIGAME_META.pick,
  async run(ctx: MinigameCtx) {
    const p = ctx.params;
    const rounds = Array.isArray(p.rounds) ? (p.rounds as Round[]) : [];
    const decoy = typeof p.decoy === 'string' ? p.decoy : undefined;
    const decoyLine = str(p.decoyLine, '');
    const wrongLine = str(p.wrongLine, '');
    const f = finisher(ctx.signal);
    const box = stage(ctx);
    box.style.background = str(p.background, 'radial-gradient(ellipse at 50% 45%,#2a3a2a,#0c140c)');
    skipButton(ctx, box, f.finish);
    const u = ctx.u;
    const offArrows = arrowFocus(ctx, () => [...grid.children] as HTMLElement[]);

    const grid = el('div');
    Object.assign(grid.style, { position: 'absolute', left: '6%', right: '6%', top: '28%', bottom: '8%', display: 'flex', flexWrap: 'wrap', gap: `${10 * u}px`, justifyContent: 'center', alignContent: 'center' });
    box.append(grid);
    const shown = el('div');
    Object.assign(shown.style, { position: 'absolute', left: '50%', top: '4%', transform: 'translateX(-50%)', height: '20%', display: 'flex', gap: `${4 * u}px` });
    box.append(shown);

    for (const [ri, round] of rounds.entries()) {
      if (f.finished) break;
      if (round.prompt) ctx.instruct(round.prompt);
      const opts = [...round.options.map((id, i) => ({ id, i })), ...(decoy ? [{ id: decoy, i: -1 }] : [])];
      // shuffled order, stable during the round
      opts.sort(() => Math.random() - 0.5);
      grid.innerHTML = '';
      const n = opts.length;
      const size = Math.min(150 * u, (560 * u) / Math.min(n, 4) - 12 * u, 190 * u);
      const answered = new Promise<void>((resolve) => {
        for (const [k, o] of opts.entries()) {
          const b = el('button', 'mg-opt') as HTMLButtonElement;
          b.type = 'button';
          b.setAttribute?.('aria-label', `${k + 1} / ${n}`);
          Object.assign(b.style, { width: `${size}px`, height: `${size}px` });
          const im = el('img') as HTMLImageElement; im.src = ctx.img(o.id); im.alt = '';
          b.append(im);
          b.addEventListener('click', () => {
            if (o.i === round.answer) {
              b.classList.add('mg-pop');
              b.style.borderColor = '#8fe36a';
              const got = el('img') as HTMLImageElement; got.src = ctx.img(o.id); got.alt = '';
              Object.assign(got.style, { height: '100%' });
              shown.append(got);
              resolve();
            } else {
              b.classList.remove('mg-shake'); void b.offsetWidth; b.classList.add('mg-shake');
              if (o.i === -1 && decoyLine) ctx.instruct(decoyLine);
              else if (wrongLine) ctx.instruct(wrongLine);
              else if (round.prompt) ctx.instruct(round.prompt);
            }
          });
          grid.append(b);
        }
        // The keyboard starts on the first option of each round (arrows move, Enter picks).
        queueMicrotask(() => (grid.children[0] as HTMLElement | undefined)?.focus?.({ preventScroll: true }));
      });
      await Promise.race([answered, f.promise]);
      if (!f.finished) await sleep(ri === rounds.length - 1 ? 900 : 500, ctx.signal);
    }
    if (p.win && !ctx.signal.aborted) { ctx.instruct(str(p.win, '')); await sleep(1200, ctx.signal); }
    f.finish();
    offArrows();
    box.remove();
  },
};
