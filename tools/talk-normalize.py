"""Makes one row of a talking sheet consistent with the validated sprite:
- same height (scaled to the validated sprite's height);
- same colors (per-channel color transfer, in Lab space, matched to the validated sprite);
- cell 1 (mouth closed) also serves as the "idle" pose: rest and talk come from the same drawing, so there is no jump.

python3 tools/talk-normalize.py <talk_sheet.png> <row 1-4> <validated_sprite.png> <output_folder>
"""
import sys, os, numpy as np, cv2
from PIL import Image
from scipy import ndimage

src, row, base_p, out = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]


def key(a, tol=30):
    """Foreground mask: True where a pixel belongs to a figure, not the flat background
    (background = pixels close to the border color AND connected to the border)."""
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(edge, axis=0)
    close = np.sqrt(((a.astype(int) - bg) ** 2).sum(-1)) <= tol
    lab, _ = ndimage.label(close)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return ~np.isin(lab, list(border))


sheet = np.asarray(Image.open(src).convert('RGB').resize((1536, 1024), Image.LANCZOS))
fg_all = key(sheet)
base = np.asarray(Image.open(base_p).convert('RGBA'))
bm = base[..., 3] > 128
H = int(np.ptp(np.nonzero(bm.any(1))[0])) + 1
# Reference colors from the validated sprite, in Lab.
blab = cv2.cvtColor(base[..., :3], cv2.COLOR_RGB2LAB).astype(np.float32)[bm]
frames = []
for c in range(6):
    y0, x0 = (row - 1) * 256, c * 256
    m = fg_all[y0:y0 + 256, x0:x0 + 256]
    # Keep only the main silhouette and whatever almost touches it (drops stray bits bleeding in from a neighboring cell).
    lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=2))
    if n:
        sz = ndimage.sum(m, lab, range(1, n + 1))
        m = m & (lab == int(np.argmax(sz)) + 1)
    ys, xs = np.nonzero(m)
    frames.append((sheet[y0:y0 + 256, x0:x0 + 256], m, ys.min(), ys.max(), xs.min(), xs.max()))
# One single box and one single scale for the whole row: all 6 images stay overlayable.
top = min(f[2] for f in frames); bot = max(f[3] for f in frames)
left = min(f[4] for f in frames); right = max(f[5] for f in frames)
s = H / (bot - top + 1)
# Color transfer computed once, on cell 1, applied to all.
f0 = frames[0]; l0 = cv2.cvtColor(f0[0].astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)[f0[1]]
mu_s, sd_s = l0.mean(0), l0.std(0) + 1e-3; mu_b, sd_b = blab.mean(0), blab.std(0) + 1e-3
os.makedirs(out, exist_ok=True)
for i, (img, m, *_) in enumerate(frames):
    lab = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    lab = (lab - mu_s) / sd_s * sd_b + mu_b
    rgb = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    crop = np.dstack([rgb, (m * 255).astype(np.uint8)])[top:bot + 1, left:right + 1]
    im = Image.fromarray(crop, 'RGBA')
    im = im.resize((max(1, round(im.width * s)), H), Image.LANCZOS)
    im.save(f'{out}/t{i + 1}.png')
print(f'ok {out}: height {H}px, scale {s:.2f}')
