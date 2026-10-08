// The code wheel (4.1.15, §11.13): "The Extremely Legitimate Pirate Check", a playful reconstruction of the paper
// code wheels of 1990s adventure games, drawn with the game's own characters and symbols, its own layout and type (no
// face, logo, text or symbol of any publisher). Not DRM: the answer is in the page, and the wheel says so with a wink.
// The wheel itself is core/remix/code-wheel.ts (the same wheel for a seed on every runtime); this is its view.
// Accessible: turn with the two buttons, the arrow keys or a gamepad's d-pad; every turn is announced; the whole wheel
// is also a plain table (the "wheel as a list"); high contrast; no animated turn under prefers-reduced-motion.
// 4.1.16: the whole wheel by keyboard (Tab, Enter, Escape to skip) and by gamepad (left/right turn, up/down choose an
// answer, A confirms, B skips); its record (`mg-record`) is the result the engine keeps in the session; a `story` wheel
// lost after its tries ends `failed`.
// Params: actors [{ id, label, img? }], symbols [{ id, label, img? }], answers [string] (as many of each), mode?
// (parody | story | strict | cosmetic | disabled | daily), tries?, seed? (the world's, filled by applyVariant), and the
// texts question?, wrong? [string], pass?, win?, fail? (4.1.16), list?, turnLeft?, turnRight?.
import {
  type CodeWheelMode,
  type CodeWheelParams,
  generateWheel,
  judge,
  type WheelRecord,
  wheelTable,
  windowAt,
} from '../core/remix/code-wheel';
import { MINIGAME_META } from './meta';
import type { Minigame, MinigameCtx } from './types';
import { el, finisher, keys, skipButton, sleep, str } from './util';

const NS = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

/** Whether turns are drawn instantly (the system asks for less motion, or the game's settings do). */
function reducedMotion(): boolean {
  return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export const codeWheel: Minigame = {
  ...MINIGAME_META['code-wheel'],
  async run(ctx: MinigameCtx) {
    const p = ctx.params as unknown as CodeWheelParams & Record<string, unknown>;
    const mode: CodeWheelMode = (p.mode as CodeWheelMode | undefined) ?? 'parody';
    const seed = str(p.seed, 'story');
    const record = (r: Omit<WheelRecord, 'seed' | 'version' | 'mode'>) => {
      const E = (globalThis as { CustomEvent?: typeof CustomEvent }).CustomEvent;
      const detail: WheelRecord = { seed, version: r.wheel.version, mode, ...r };
      ctx.root.dispatchEvent?.(
        E
          ? new E('mg-record', { bubbles: true, detail })
          : Object.assign(new Event('mg-record', { bubbles: true }), { detail }),
      );
      return detail;
    };
    const w = generateWheel(p, seed);
    if (mode === 'disabled') {
      record({ wheel: w, rotations: [], answers: [], tries: 0, result: 'disabled' });
      return;
    }
    const label = (list: { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;
    const actor = (id: string) => label(p.actors, id);
    const symbol = (id: string) => label(p.symbols, id);
    const f = finisher(ctx.signal);
    const box = el('div', 'mg mg-wheel');
    ctx.root.append(box);
    ctx.signal.addEventListener('abort', () => box.remove(), { once: true });
    Object.assign(box.style, {
      background: '#10131c',
      color: '#fff',
      display: 'flex',
      gap: `${8 * ctx.u}px`,
      padding: `${8 * ctx.u}px`,
    });
    const skip =
      mode !== 'strict'
        ? () => {
            if (f.finished) return;
            record({ wheel: w, rotations, answers, tries: answers.length, result: 'skipped' });
            f.finish();
          }
        : undefined;
    const skipBtn = skip ? skipButton(ctx, box, skip) : undefined;

    const question = fill(
      str(
        p.question,
        'The Extremely Legitimate Pirate Check! Turn the small disc until {symbol} sits under {actor}. What does the window of {symbol} show?',
      ),
      { actor: actor(w.challenge.actor), symbol: symbol(w.challenge.symbol) },
    );
    ctx.instruct(question);

    // The wheel: the large disc (actors on the rim, the answers' track inside), the small disc turning over it.
    const size = 360;
    const c = size / 2;
    const pic = svg('svg', { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'code wheel' });
    Object.assign(pic.style, { width: `${300 * ctx.u}px`, height: `${300 * ctx.u}px`, flex: 'none' });
    pic.append(svg('circle', { cx: c, cy: c, r: c - 2, fill: '#f4e9c8', stroke: '#000', 'stroke-width': 3 }));
    const step = 360 / w.n;
    const at = (deg: number, r: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
    };
    w.outer.forEach((id, i) => {
      const [x, y] = at(i * step, c - 28);
      const item = p.actors.find((a) => a.id === id);
      if (item?.img) pic.append(svg('image', { href: ctx.img(item.img), x: x - 20, y: y - 20, width: 40, height: 40 }));
      else
        pic.append(
          Object.assign(svg('text', { x, y, 'text-anchor': 'middle', 'font-size': 12, fill: '#000' }), {
            textContent: actor(id),
          }),
        );
      const [tx, ty] = at(i * step, c - 62);
      pic.append(
        Object.assign(
          svg('text', { x: tx, y: ty + 4, 'text-anchor': 'middle', 'font-size': 13, fill: '#222', 'font-weight': 700 }),
          { textContent: w.track[i]! },
        ),
      );
    });
    const disc = svg('g');
    disc.append(svg('circle', { cx: c, cy: c, r: c - 48, fill: '#2a4d8f', stroke: '#fff', 'stroke-width': 2 }));
    w.inner.forEach((id, j) => {
      const [x, y] = at(j * step, c - 100);
      const item = p.symbols.find((s) => s.id === id);
      if (item?.img)
        disc.append(svg('image', { href: ctx.img(item.img), x: x - 16, y: y - 16, width: 32, height: 32 }));
      else
        disc.append(
          Object.assign(svg('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 12, fill: '#fff' }), {
            textContent: symbol(id),
          }),
        );
      // The window: a hole at this symbol's own offset, over the answers' track.
      const [wx, wy] = at((j + w.windows[j]!) * step, c - 62);
      disc.append(
        svg('rect', {
          x: wx - 18,
          y: wy - 9,
          width: 36,
          height: 18,
          rx: 4,
          fill: 'none',
          stroke: '#ffd640',
          'stroke-width': 3,
        }),
      );
    });
    pic.append(disc, svg('circle', { cx: c, cy: c, r: 6, fill: '#000' }));
    box.append(pic);

    const side = el('div');
    Object.assign(side.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: `${6 * ctx.u}px`,
      fontSize: `${Math.max(13, 14 * ctx.u)}px`,
      overflow: 'auto',
    });
    box.append(side);
    side.append(el('p', 'mg-q', ''));
    (side.firstChild as HTMLElement).textContent = question;
    const live = el('p');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    side.append(live);

    let rotation = 0;
    const rotations: number[] = [];
    const answers: string[] = [];
    const announce = () => {
      // The symbol now under each actor's place 0: the one the player is aligning (the challenge's symbol).
      const j = w.inner.indexOf(w.challenge.symbol);
      const under = w.outer[(((j + rotation) % w.n) + w.n) % w.n]!;
      live.textContent = `${symbol(w.challenge.symbol)} is under ${actor(under)}; its window shows ${windowAt(w, j, rotation)}.`;
    };
    const turn = (d: number) => {
      rotation = (((rotation + d) % w.n) + w.n) % w.n;
      rotations.push(rotation);
      disc.style.transition = reducedMotion() ? 'none' : 'transform .25s ease';
      disc.setAttribute('transform', `rotate(${rotation * step} ${c} ${c})`);
      announce();
    };
    const row = el('div');
    Object.assign(row.style, { display: 'flex', gap: '8px' });
    for (const [d, t] of [
      [-1, str(p.turnLeft, '◀ Turn left')],
      [1, str(p.turnRight, 'Turn right ▶')],
    ] as const) {
      const b = el('button', 'mg-turn', '') as HTMLButtonElement;
      b.type = 'button';
      b.textContent = t;
      b.style.cssText = 'background:#fff;color:#000;border:3px solid #ffd640;padding:6px 10px;font-weight:700';
      b.addEventListener('click', () => turn(d));
      row.append(b);
    }
    side.append(row);
    announce();
    const offKeys = keys(ctx, {
      ArrowLeft: () => turn(-1),
      ArrowRight: () => turn(1),
      ...(skip ? { Escape: () => (skipBtn?.click ? skipBtn.click() : skip()) } : {}),
    });
    // A strict wheel has no Skip to take the focus: it starts on the first turn button.
    if (!skip) queueMicrotask(() => (row.firstChild as HTMLButtonElement | null)?.focus?.({ preventScroll: true }));

    // A gamepad (4.1.16, the whole wheel): left/right (d-pad or stick) turn, up/down choose an answer, A confirms it,
    // B skips; each once per press.
    const answerButtons: HTMLButtonElement[] = [];
    let chosen = -1;
    const choose = (d: number) => {
      if (!answerButtons.length) return;
      chosen =
        ((((chosen < 0 ? (d > 0 ? -1 : 0) : chosen) + d) % answerButtons.length) + answerButtons.length) %
        answerButtons.length;
      answerButtons.forEach((b, i) => {
        b.style.outline = i === chosen ? '4px solid #fff' : '';
        b.setAttribute('aria-current', String(i === chosen));
      });
      answerButtons[chosen]!.focus?.({ preventScroll: true });
    };
    const held = new Set<string>();
    const press = (k: string, on: boolean, f: () => void) => {
      if (on && !held.has(k)) f();
      if (on) held.add(k);
      else held.delete(k);
    };
    let raf = 0;
    const poll = () => {
      const pad = globalThis.navigator?.getGamepads?.().find((g) => g);
      const b = (i: number) => !!pad?.buttons[i]?.pressed;
      const ax = (i: number) => pad?.axes[i] ?? 0;
      press('left', b(14) || ax(0) < -0.6, () => turn(-1));
      press('right', b(15) || ax(0) > 0.6, () => turn(1));
      press('up', b(12) || ax(1) < -0.6, () => choose(-1));
      press('down', b(13) || ax(1) > 0.6, () => choose(1));
      press('a', b(0), () => (chosen >= 0 ? answerButtons[chosen]?.click() : choose(1)));
      press('b', b(1), () => skip?.());
      if (!f.finished) raf = globalThis.requestAnimationFrame?.(poll) ?? 0;
    };
    raf = globalThis.requestAnimationFrame?.(poll) ?? 0;

    // The answers, as buttons (sorted: their order on the wheel would give the track away).
    const grid = el('div');
    Object.assign(grid.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' });
    const wrong =
      Array.isArray(p.wrong) && p.wrong.length
        ? (p.wrong as string[])
        : ['Arr. That is not what the wheel says.', 'Nope. Did you turn the small disc?', 'A pirate would never.'];
    for (const a of [...p.answers].sort()) {
      const b = el('button', 'mg-answer', '') as HTMLButtonElement;
      b.type = 'button';
      b.textContent = a;
      b.style.cssText =
        'background:#ffd640;color:#000;border:2px solid #fff;padding:6px 10px;font-weight:700;min-width:44px;min-height:44px';
      answerButtons.push(b);
      b.addEventListener('click', async () => {
        if (f.finished) return;
        const verdict = judge(w, mode, a, answers.length, typeof p.tries === 'number' ? p.tries : 3);
        answers.push(a);
        if (verdict === 'wrong') {
          live.textContent = wrong[(answers.length - 1) % wrong.length]!;
          return;
        }
        live.textContent =
          verdict === 'won'
            ? str(p.win, 'Legitimate! Welcome aboard.')
            : verdict === 'failed'
              ? str(p.fail, 'The wheel stays silent. The story will remember that.')
              : str(p.pass, 'Fine. You look legitimate enough. Go on.');
        record({ wheel: w, rotations, answers, tries: answers.length, result: verdict });
        await sleep(900, ctx.signal);
        f.finish();
      });
      grid.append(b);
    }
    side.append(grid);

    // The wheel as a list: every actor and symbol with what the window shows (the printed wheel, as text).
    const list = el('details');
    list.append(Object.assign(el('summary'), { textContent: str(p.list, 'The wheel as a list') }));
    const table = el('table');
    table.style.borderCollapse = 'collapse';
    for (const r of wheelTable(w)) {
      const tr = el('tr');
      for (const t of [actor(r.actor), symbol(r.symbol), r.answer])
        tr.append(Object.assign(el('td'), { textContent: t }));
      table.append(tr);
    }
    list.append(table);
    side.append(list);

    await f.promise;
    offKeys();
    globalThis.cancelAnimationFrame?.(raf);
    box.remove();
  },
};
