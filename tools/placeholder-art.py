"""Placeholder art for a new game (3.9): drawn here, from shapes, so a game made from the template owes nothing to the
sample game. A backdrop (decor/backyard), a cat-shaped hero sheet (hero/r1c1…r4c6, the `cat()` layout of cast.ts),
interface icons (ui/*), two items (items/note, items/bucket). Every file is a placeholder: provenance says so, and a
release refuses it until it is replaced. Usage: python3 tools/placeholder-art.py <game>/art
"""
import math, os, sys
from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else 'games/_template/art'

def save(img, rel):
    p = os.path.join(out, rel + '.png'); os.makedirs(os.path.dirname(p), exist_ok=True); img.save(p, optimize=True)

# Backdrop, 1280 x 800 (the 640 x 400 scene at 2x): sky, wall, tree and bench on the left, gate on the right, a path.
W, H = 1280, 800
bg = Image.new('RGB', (W, H)); d = ImageDraw.Draw(bg)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(150 + 60 * t), int(190 + 30 * t), int(230 - 20 * t)) if y < 440 else (int(110 - 20 * t), int(160 - 30 * t), int(80 - 10 * t)))
d.rectangle([0, 380, W, 470], fill=(176, 120, 92)); [d.line([(x, 380), (x, 470)], fill=(150, 100, 78), width=3) for x in range(0, W, 64)]
d.polygon([(560, 800), (720, 800), (680, 470), (600, 470)], fill=(222, 196, 150))
d.rectangle([250, 180, 290, 520], fill=(110, 80, 56)); d.ellipse([140, 40, 400, 300], fill=(70, 130, 70)); d.ellipse([200, 10, 380, 200], fill=(84, 148, 80))
d.rectangle([260, 440, 520, 470], fill=(140, 96, 60)); d.rectangle([270, 470, 285, 540], fill=(110, 76, 48)); d.rectangle([495, 470, 510, 540], fill=(110, 76, 48)); d.rectangle([260, 400, 520, 418], fill=(150, 104, 66))
d.rectangle([960, 320, 1100, 560], fill=(90, 90, 100)); [d.line([(x, 330), (x, 550)], fill=(60, 60, 70), width=6) for x in range(975, 1100, 25)]
save(bg, 'decor/backyard')

# Hero: a cat-shaped silhouette, 6 x 4 frames of 234 x 202 on transparency, the `cat()` layout (walk row 2, poses row 3).
FW, FH = 234, 202
FUR, DARK, EYE = (236, 222, 196, 255), (120, 84, 60, 255), (60, 120, 200, 255)
def cat_frame(step=0, facing=1, pose='side'):
    im = Image.new('RGBA', (FW, FH), (0, 0, 0, 0)); g = ImageDraw.Draw(im)
    cx, base = FW // 2, FH - 12
    if pose == 'sleep':
        g.ellipse([cx - 70, base - 60, cx + 70, base], fill=FUR); g.ellipse([cx + 20 * facing - 35, base - 75, cx + 20 * facing + 35, base - 15], fill=FUR)
        return im
    body = [cx - 60, base - 95, cx + 50, base - 35]
    g.ellipse(body, fill=FUR)
    for i, lx in enumerate((-45, -20, 15, 40)):
        dx = int(10 * math.sin(step * math.pi / 3 + i * math.pi / 2)) if pose == 'side' else 0
        g.rectangle([cx + lx + dx, base - 45, cx + lx + dx + 12, base], fill=FUR)
    hx = cx + 55 * facing if pose == 'side' else cx
    g.ellipse([hx - 38, base - 150, hx + 38, base - 76], fill=FUR)
    g.polygon([(hx - 34, base - 130), (hx - 24, base - 170), (hx - 8, base - 140)], fill=DARK); g.polygon([(hx + 34, base - 130), (hx + 24, base - 170), (hx + 8, base - 140)], fill=DARK)
    if pose != 'back':
        g.ellipse([hx - 20, base - 125, hx - 8, base - 111], fill=EYE); g.ellipse([hx + 8, base - 125, hx + 20, base - 111], fill=EYE)
    tx = cx - 60 * facing if pose == 'side' else cx + 40
    g.line([(tx, base - 80), (tx - 30 * facing, base - 130)], fill=DARK, width=12)
    return im
frames = {1: [cat_frame(0, 1, p) for p in ('side', 'side', 'front', 'side', 'side', 'side')],
          2: [cat_frame(s, 1) for s in range(6)],
          3: [cat_frame(0, 1, 'front'), cat_frame(0, 1, 'back'), cat_frame(0, 1), cat_frame(0, 1, 'sleep'), cat_frame(1, 1), cat_frame(2, 1)],
          4: [cat_frame(0, 1, 'sleep')] * 3 + [cat_frame(s, 1) for s in range(3)]}
for r, row in frames.items():
    for c, im in enumerate(row, 1): save(im, f'hero/r{r}c{c}')

# Interface icons and items: a rounded tile with a simple glyph.
def tile(color, glyph):
    im = Image.new('RGBA', (160, 160), (0, 0, 0, 0)); g = ImageDraw.Draw(im)
    g.rounded_rectangle([8, 8, 152, 152], radius=28, fill=color)
    glyph(g); return im
W_ = (255, 255, 255, 255)
icons = {
    'ui/map': ((70, 110, 170, 255), lambda g: g.polygon([(40, 50), (70, 40), (90, 50), (120, 40), (120, 110), (90, 120), (70, 110), (40, 120)], outline=W_, width=6)),
    'ui/pause': ((60, 60, 80, 255), lambda g: (g.rectangle([55, 45, 72, 115], fill=W_), g.rectangle([88, 45, 105, 115], fill=W_))),
    'ui/music': ((140, 80, 160, 255), lambda g: (g.ellipse([45, 95, 75, 120], fill=W_), g.rectangle([68, 40, 76, 108], fill=W_), g.rectangle([68, 40, 115, 50], fill=W_))),
    'ui/spark': ((220, 170, 40, 255), lambda g: g.polygon([(80, 30), (92, 68), (130, 80), (92, 92), (80, 130), (68, 92), (30, 80), (68, 68)], fill=W_)),
    'ui/pin': ((200, 60, 60, 255), lambda g: (g.ellipse([55, 35, 105, 85], fill=W_), g.polygon([(60, 75), (100, 75), (80, 125)], fill=W_))),
    'ui/news': ((90, 90, 90, 255), lambda g: [g.rectangle([45, y, 115, y + 8], fill=W_) for y in (45, 65, 85, 105)]),
    'ui/plane': ((60, 140, 200, 255), lambda g: g.polygon([(30, 80), (130, 50), (100, 80), (130, 110)], fill=W_)),
    'ui/car': ((200, 90, 50, 255), lambda g: (g.rectangle([35, 70, 125, 105], fill=W_), g.ellipse([45, 95, 70, 120], fill=(40, 40, 40, 255)), g.ellipse([90, 95, 115, 120], fill=(40, 40, 40, 255)))),
    'ui/confetti1': ((230, 90, 140, 255), lambda g: [g.rectangle([x, y, x + 10, y + 10], fill=W_) for x, y in ((40, 40), (90, 55), (60, 90), (110, 100))]),
    'ui/confetti2': ((90, 190, 140, 255), lambda g: [g.ellipse([x, y, x + 12, y + 12], fill=W_) for x, y in ((50, 50), (100, 40), (70, 100), (115, 90))]),
    'items/note': ((245, 236, 200, 255), lambda g: [g.line([(40, y), (120, y)], fill=(90, 90, 120, 255), width=5) for y in (50, 75, 100)]),
    'items/bucket': ((0, 0, 0, 0), lambda g: (g.polygon([(40, 50), (120, 50), (108, 135), (52, 135)], fill=(210, 50, 50, 255)), g.arc([45, 20, 115, 80], 180, 360, fill=(90, 90, 90, 255), width=6))),
}
for rel, (color, glyph) in icons.items(): save(tile(color, glyph), rel)
print(f'placeholder art written to {out}')
