"""Prepares the "talking kits" to send to an image generator.
For each character and pose: the VALIDATED sprite's head, enlarged and copied 6 times into a 3 x 2 grid
(1536 x 1024, background #2B2E45). The generator should only change the mouth (and the eyes, for a blink) in cells 2 to 6.
A .json file keeps the head's exact position, to paste the mouth back later, pixel for pixel.

python3 tools/talk-kit.py            -> games/<id>/private/talk_kits/<char>_<pose>.png + .json
"""
import os, sys, json, numpy as np
from PIL import Image
BG = (43, 46, 69)
# Characters and poses to prepare: read from games/<id>/talk-kits.json, e.g. { "grandpa": { "profil": "grandpa/r3c3", "face": "grandpa/r3c1" } }
GAME = os.environ.get('GAME') or json.load(open('package.json')).get('config', {}).get('game', 'demo')
POSES = json.load(open(f'games/{GAME}/talk-kits.json'))
X, OUT = f'games/{GAME}/art', f'games/{GAME}/private/talk_kits'
# Only some characters: python3 tools/talk-kit.py grandpa seller
ONLY = set(sys.argv[1:])
CELL, HEAD = 512, 440          # grid cell size, max size of the enlarged head
os.makedirs(OUT, exist_ok=True)
for char, poses in POSES.items():
    if ONLY and char not in ONLY: continue
    for pose, sp in poses.items():
        im = Image.open(f'{X}/{sp}.png').convert('RGBA'); a = np.asarray(im)
        m = a[..., 3] > 128; ys, xs = np.nonzero(m)
        top, bot = ys.min(), ys.max()
        hb = top + int((bot - top) * (0.55 if pose == 'assis' else 0.42))       # the head: the top of the silhouette
        hx = np.nonzero(m[top:hb].any(0))[0]
        box = [int(max(0, hx.min() - 4)), int(top), int(min(a.shape[1], hx.max() + 5)), int(hb)]
        head = im.crop(box)
        s = HEAD / max(head.size)
        big = head.resize((round(head.width * s), round(head.height * s)), Image.LANCZOS)
        sheet = Image.new('RGB', (3 * CELL, 2 * CELL), BG)
        ox, oy = (CELL - big.width) // 2, (CELL - big.height) // 2
        for k in range(6):
            sheet.paste(big, ((k % 3) * CELL + ox, (k // 3) * CELL + oy), big)
        name = f'{char}_{pose}'
        sheet.save(f'{OUT}/{name}.png')
        json.dump({'sprite': sp, 'box': box, 'scale': s, 'offset': [ox, oy], 'cell': CELL, 'size': list(big.size)},
                  open(f'{OUT}/{name}.json', 'w'))
        print(name)
