import type { Minigame, MinigameCtx } from './types';
import { el, finisher, num, skipButton, stage, str } from './util';

// Pipes: touching a tile rotates it a quarter turn. Water starts from the source (left of the middle row)
// and must reach the sprinkler (right of the same row). Help: after `helpAfter` taps, the next wrong tile blinks.
//
// Params (all images come from the game):
//   tiles      { ground: Id, straight: [dry, wet], elbow: [dry, wet], tee: [dry, wet] }
//              base images: straight L-R, elbow L-D, tee L-R-D (rotated by the engine)
//   source     Id            water inlet, left of the grid
//   nozzle     [Id, Id]      outlet on the right: dry, then spraying
//   tank       Id            tank drawn on the left (mirrored)
//   mushrooms? [Id, Id]      what's being watered, on the right: thirsty, then happy
//   cols?, rows?, helpAfter?, background?, intro?, win?

type Dir = 'L' | 'R' | 'U' | 'D';
type Kind = 'straight' | 'elbow' | 'tee';
const BASE: Record<Kind, Dir[]> = { straight: ['L', 'R'], elbow: ['L', 'D'], tee: ['L', 'R', 'D'] };
const ROT: Record<Dir, Dir> = { L: 'U', U: 'R', R: 'D', D: 'L' };
const pair = (v: unknown): [string, string] => (Array.isArray(v) ? [str(v[0], ''), str(v[1] ?? v[0], '')] : [str(v, ''), str(v, '')]);

export function opens(kind: Kind, rot: number): Dir[] {
  let s = BASE[kind];
  for (let i = 0; i < rot % 4; i++) s = s.map((d) => ROT[d]);
  return s;
}

interface Cell { kind: Kind; rot: number; need: Dir[] | null }

/** Random path from left to right: in each column, go down or up to a chosen row, then exit to the right. */
export function makeGrid(cols: number, rows: number, rnd: () => number = Math.random): Cell[][] {
  const mid = Math.floor(rows / 2);
  const grid: Cell[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ kind: 'straight' as Kind, rot: 0, need: null })));
  const target: number[] = [];
  for (let c = 0; c < cols; c++) target.push(c === cols - 1 ? mid : Math.floor(rnd() * rows));
  let row = mid;
  for (let c = 0; c < cols; c++) {
    const b = target[c];
    const step = b > row ? 1 : -1;
    for (let r = row; ; r += step) {
      const need: Dir[] = [];
      need.push(r === row ? 'L' : step > 0 ? 'U' : 'D');
      need.push(r === b ? 'R' : step > 0 ? 'D' : 'U');
      grid[r][c].need = need;
      if (r === b) break;
    }
    row = b;
  }
  const kinds: Kind[] = ['straight', 'elbow', 'tee'];
  for (const line of grid) for (const cell of line) {
    if (cell.need) {
      const [a, b] = cell.need;
      cell.kind = (a === 'L' && b === 'R') || (a === 'U' && b === 'D') || (a === 'D' && b === 'U') ? 'straight' : 'elbow';
      // shuffle: never correctly oriented at the start
      cell.rot = Math.floor(rnd() * 4);
      let guard = 0;
      while (fits(cell) && guard++ < 4) cell.rot = (cell.rot + 1) % 4;
    } else {
      cell.kind = kinds[Math.floor(rnd() * kinds.length)];
      cell.rot = Math.floor(rnd() * 4);
    }
  }
  return grid;
}

export function fits(c: Cell): boolean {
  if (!c.need) return true;
  const o = opens(c.kind, c.rot);
  return c.need.every((d) => o.includes(d));
}

export const pipes: Minigame = {
  required: ['tiles', 'source', 'nozzle', 'tank'],
  run(ctx: MinigameCtx) {
    const p = ctx.params;
    const t = (p.tiles && typeof p.tiles === 'object' ? p.tiles : {}) as Record<string, unknown>;
    const IMG: Record<Kind, [string, string]> = { straight: pair(t.straight), elbow: pair(t.elbow), tee: pair(t.tee) };
    const DIRT = str(t.ground, ''), SOURCE = str(p.source, ''), TANK = str(p.tank, '');
    const [NOZZLE, NOZZLE_W] = pair(p.nozzle);
    const mush0 = p.mushrooms ? pair(p.mushrooms) : null;
    const cols = Math.max(2, Math.round(num(p.cols, 4))), rows = Math.max(1, Math.round(num(p.rows, 3)));
    const helpAfter = num(p.helpAfter, 15);
    const f = finisher(ctx.signal);
    const box = stage(ctx);
    box.style.background = str(p.background, 'radial-gradient(ellipse at 50% 40%,#3a2a1a,#140d08)');
    if (p.intro) ctx.instruct(str(p.intro, ''));

    const grid = makeGrid(cols, rows);
    const mid = Math.floor(rows / 2);
    const sw = 640 * ctx.u, sh = 400 * ctx.u;
    const gap = 2;
    const cell = Math.floor(Math.min((sh * 0.52) / rows, (sw * 0.5) / cols));
    const bw = cols * cell + (cols - 1) * gap, bh = rows * cell + (rows - 1) * gap;
    const bx = (sw - bw) / 2, by = sh * 0.62 - bh / 2;

    const board = el('div');
    Object.assign(board.style, { position: 'absolute', left: `${bx}px`, top: `${by}px`, display: 'grid', gridTemplateColumns: `repeat(${cols},${cell}px)`, gap: `${gap}px` });
    box.append(board);

    const abs = (id: string, left: number, top: number, h: number, mirror = false) => {
      const im = el('img', 'mg-img') as HTMLImageElement;
      im.src = ctx.img(id); im.alt = '';
      const [w0, h0] = ctx.size(id);
      Object.assign(im.style, { left: `${left}px`, top: `${top}px`, height: `${h}px`, width: `${(h * w0) / (h0 || 1)}px`, transform: mirror ? 'scaleX(-1)' : '' });
      box.append(im);
      return im;
    };
    const rowTop = by + mid * (cell + gap);
    abs(SOURCE, bx - cell - gap, rowTop, cell);
    const nozzle = abs(NOZZLE, bx + bw + gap, rowTop, cell);
    // the tank pours toward the source: mirror it
    abs(TANK, bx - cell * 2.3, rowTop - cell * 0.35, cell * 1.3, true);
    const mush = mush0 ? abs(mush0[0], bx + bw + cell * 1.05, rowTop - cell * 0.3, cell * 1.2) : null;

    let taps = 0;
    let won = false;
    const tiles: { b: HTMLButtonElement; im: HTMLImageElement; r: number; c: number }[] = [];
    const paint = () => {
      const firstWrong = taps >= helpAfter && !won ? tiles.find(({ r, c }) => !fits(grid[r][c])) : undefined;
      for (const tile of tiles) {
        const g = grid[tile.r][tile.c];
        const wet = won && !!g.need;
        const src = ctx.img(IMG[g.kind][wet ? 1 : 0]);
        if (tile.im.src !== src) tile.im.src = src;
        tile.im.style.transform = `rotate(${g.rot * 90}deg)`;
        tile.b.classList.toggle('mg-hl', tile === firstWrong);
      }
    };
    const win = () => {
      won = true;
      nozzle.src = ctx.img(NOZZLE_W);
      if (mush && mush0) { mush.src = ctx.img(mush0[1]); mush.classList.add('mg-pop'); }
      paint();
      if (p.win) ctx.instruct(str(p.win, ''));
      setTimeout(f.finish, 1600);
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const b = el('button', 'mg-tile') as HTMLButtonElement;
      b.type = 'button';
      b.style.width = b.style.height = `${cell}px`;
      b.style.backgroundImage = `url("${ctx.img(DIRT)}")`;
      const im = el('img') as HTMLImageElement; im.alt = '';
      b.append(im);
      b.addEventListener('click', () => {
        if (won) return;
        grid[r][c].rot = (grid[r][c].rot + 1) % 4;
        taps++;
        if (grid.every((line) => line.every(fits))) win(); else paint();
      });
      board.append(b);
      tiles.push({ b, im, r, c });
    }
    paint();
    skipButton(ctx, box, () => {
      if (won) return f.finish();
      for (const line of grid) for (const g of line) { let k = 0; while (!fits(g) && k++ < 4) g.rot = (g.rot + 1) % 4; }
      win();
    });
    return f.promise.then(() => box.remove());
  },
};
