"""Cut an AI-generated sprite sheet (figures on a flat background) into keyed PNG cells.

Default mode (grid): detects one figure per cell of an invisible grid, like the sheets produced by the prompts in
docs/en/PROMPTS.md. Detection is per figure, not per fixed box, so a figure that overflows its cell a little is
still captured whole; a cell where detection finds nothing falls back to its fixed rectangle, keyed the same way,
so every requested cell is always written.

    python3 tools/cut-sheet.py games/demo/private/asset/hero_sheet.png hero
    python3 tools/cut-sheet.py sheet.png hero --grid 6x4 --out games/demo/art
    python3 tools/cut-sheet.py sheet.png hero --cells r1c2,r3c1      # only (re)cut these cells

    -> <out>/<sheet-id>/r<row>c<col>.png (row 1..R, col 1..C, top to bottom, left to right)

Auto mode (--auto): no grid assumption, detects each sprite wherever it falls on the sheet and writes an index.
Useful for a sheet whose figures are not laid out on a regular grid.

    python3 tools/cut-sheet.py sheet.png minigame_pieces --auto [--tol 40] [--min 2500]

    -> <out>/<sheet-id>/sprite_<row>_<col>.png + index.json (boxes, 0-indexed row/col by visual row)

The game: env GAME, else package.json -> config.game, else 'demo' (same rule as tools/game.ts).
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

CELL = 256


def game_id():
    g = os.environ.get('GAME', '').strip()
    if g:
        return g
    try:
        g = json.load(open('package.json')).get('config', {}).get('game')
        if g:
            return g
    except Exception:
        pass
    return 'demo'


def bg_mask(a, tol=30):
    """Background pixels: close to the sheet's border color (median of the 4 edges)."""
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(edge, axis=0)
    return np.sqrt(((a - bg) ** 2).sum(-1)) <= tol


def flood_from_border(close):
    """Of the pixels close to the background color, only those connected to the border count as
    background: a dark area fully enclosed by a figure's outline stays part of the figure."""
    lab, _ = ndimage.label(close)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(border))


# ------------------------------------------------------------------ grid mode

def cut_grid(src, out_dir, cols, rows, only=None):
    """Detect one figure per cell of a cols x rows grid of CELL x CELL px cells."""
    im = Image.open(src).convert('RGB').resize((cols * CELL, rows * CELL), Image.LANCZOS)
    a = np.asarray(im).astype(int)
    close = bg_mask(a)
    fg_all = ndimage.binary_opening(~flood_from_border(close), iterations=1)
    comp, _n = ndimage.label(ndimage.binary_dilation(fg_all, iterations=4))

    # Every piece goes to the cell holding its centre: a sprite made of several separate
    # parts (sparkles, sound waves, flying objects) keeps all of them together.
    cells = {}
    for k, sl in enumerate(ndimage.find_objects(comp), start=1):
        area = int((fg_all & (comp == k))[sl].sum())
        if area < 40:
            continue
        cy = (sl[0].start + sl[0].stop) / 2
        cx = (sl[1].start + sl[1].stop) / 2
        cell = (min(rows - 1, int(cy // CELL)), min(cols - 1, int(cx // CELL)))
        cells.setdefault(cell, []).append((area, k))
    detected = {}
    for cell, parts in cells.items():
        if max(ar for ar, _ in parts) < 1500:  # only specks: not a sprite
            continue
        detected[cell] = parts

    os.makedirs(out_dir, exist_ok=True)
    written, fallback = [], []
    for r in range(rows):
        for c in range(cols):
            name = f'r{r + 1}c{c + 1}'
            if only and name not in only:
                continue
            y0, x0 = r * CELL, c * CELL
            if (r, c) in detected:
                m = np.zeros(fg_all.shape, bool)
                for _, k in detected[(r, c)]:
                    m |= fg_all & (comp == k)
                ys, xs = np.nonzero(m)
                sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
                rgba = np.dstack([a[sl].astype(np.uint8), (m[sl] * 255).astype(np.uint8)])
            else:
                # Fixed-grid fallback: no figure detected in this cell, key its own rectangle
                # instead of skipping it, so every requested cell is always produced.
                crop = a[y0:y0 + CELL, x0:x0 + CELL]
                alpha = (~close[y0:y0 + CELL, x0:x0 + CELL]) * 255
                rgba = np.dstack([crop.astype(np.uint8), alpha.astype(np.uint8)])
                fallback.append(name)
            Image.fromarray(rgba, 'RGBA').save(f'{out_dir}/{name}.png')
            written.append(name)
    return written, fallback


# ------------------------------------------------------------------ auto mode (free layout)

def cut_auto(src, out_dir, tol=40, minarea=2500):
    """Detect sprites anywhere on the sheet (no grid assumption), group them into visual rows,
    and write an index.json with each box. Ported from the former scripts/extract-sheet.py."""
    raw = Image.open(src)
    alpha = np.asarray(raw.convert('RGBA'))[..., 3] if raw.mode == 'RGBA' else None
    im = raw.convert('RGB')
    a = np.asarray(im).astype(int)
    close = bg_mask(a, tol)
    fg = ~flood_from_border(close)
    if alpha is not None and (alpha < 250).mean() > 0.2:
        # The sheet is already keyed (transparent background, or a semi-transparent haze):
        # keep the opaque pixels instead of relying on a flat background color.
        fg = alpha > 215
        fg = ndimage.binary_fill_holes(ndimage.binary_closing(fg, iterations=2))
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, _n = ndimage.label(ndimage.binary_dilation(fg, iterations=3))
    boxes = []
    for sl in ndimage.find_objects(lab):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if (y1 - y0) * (x1 - x0) < minarea:
            continue
        boxes.append([x0, y0, x1, y1])
    # Sort into rows by vertical center.
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows = []
    for b in boxes:
        cy = (b[1] + b[3]) / 2
        if rows and abs(cy - rows[-1][0]) < (b[3] - b[1]) * 0.45:
            rows[-1][1].append(b)
        else:
            rows.append([cy, [b]])

    os.makedirs(out_dir, exist_ok=True)
    rgba = np.dstack([np.asarray(im), (fg * 255).astype(np.uint8)])
    index = []
    for r, (_, bs) in enumerate(rows):
        for c, (x0, y0, x1, y1) in enumerate(sorted(bs, key=lambda b: b[0])):
            crop = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA')
            name = f'sprite_{r}_{c}.png'
            crop.save(os.path.join(out_dir, name))
            index.append({'file': name, 'row': r, 'col': c, 'box': [x0, y0, x1, y1]})
    json.dump(index, open(os.path.join(out_dir, 'index.json'), 'w'), indent=1)
    return index, rows


def main():
    p = argparse.ArgumentParser(description='Cut a sprite sheet on a flat background into keyed PNG cells.')
    p.add_argument('sheet', help='source sheet image (.png)')
    p.add_argument('sheet_id', help='sheet id: output subfolder, and how images are referenced (<sheet-id>/r<row>c<col>)')
    p.add_argument('--grid', default='6x4', help='grid mode: COLSxROWS, e.g. 6x4 (default) or 3x3')
    p.add_argument('--out', default=None, help='output root (default: games/<GAME>/art)')
    p.add_argument('--cells', default=None, help='grid mode: only (re)cut these cells, e.g. r1c2,r3c1')
    p.add_argument('--auto', action='store_true', help='auto mode: free layout detection + index.json, instead of a fixed grid')
    p.add_argument('--tol', type=float, default=40, help='auto mode: background color tolerance (default 40)')
    p.add_argument('--min', dest='minarea', type=int, default=2500, help='auto mode: minimum sprite area in px (default 2500)')
    args = p.parse_args()

    out_root = args.out or f'games/{game_id()}/art'
    out_dir = os.path.join(out_root, args.sheet_id)

    if args.auto:
        index, rows = cut_auto(args.sheet, out_dir, tol=args.tol, minarea=args.minarea)
        print(f'ok: {len(index)} sprites, {len(rows)} row(s) in {out_dir}: {[len(b) for _, b in rows]}')
        return

    cols, rows = (int(x) for x in args.grid.lower().split('x'))
    only = set(args.cells.split(',')) if args.cells else None
    written, fallback = cut_grid(args.sheet, out_dir, cols, rows, only=only)
    msg = f'ok: {len(written)} cell(s) in {out_dir}'
    if fallback:
        msg += f' (fixed-grid fallback, no figure detected: {fallback})'
    print(msg)


if __name__ == '__main__':
    main()
