#!/usr/bin/env python3
"""The printable code wheel as a PDF (4.1.15): draws the layout tools/code-wheel.ts wrote (millimetres on A4) with
Pillow, one page per disc and the booklet, at 300 dpi. Usage: code-wheel-pdf.py <layout.json> <out.pdf>.
Pillow only (npm run doctor checks it); without it, the SVG pages tools/code-wheel.ts wrote are the printable version."""
import base64
import io
import json
import math
import sys

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except ImportError:  # pragma: no cover - said to the caller
    sys.exit("Pillow is not installed (pip install Pillow)")

DPI = 300
MM = DPI / 25.4


def px(v):
    return int(round(v * MM))


def font(size_mm, bold=False):
    names = ["DejaVuSerif-Bold.ttf" if bold else "DejaVuSerif.ttf", "Georgia Bold.ttf" if bold else "Georgia.ttf"]
    for n in names:
        try:
            return ImageFont.truetype(n, px(size_mm))
        except OSError:
            pass
    return ImageFont.load_default()


def draw_text(img, m, fill):
    f = font(m["size"], m.get("bold", False))
    d = ImageDraw.Draw(img)
    w = d.textlength(m["text"], font=f)
    x, y = px(m["x"]), px(m["y"])
    if m.get("anchor") == "middle":
        x -= w / 2
    rot = m.get("rotate") or 0
    if not rot:
        d.text((x, y - px(m["size"])), m["text"], font=f, fill=fill)
        return
    tile = Image.new("RGBA", (int(w) + 4, px(m["size"]) * 2), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text((2, 0), m["text"], font=f, fill=fill)
    tile = tile.rotate(-rot, expand=True, resample=Image.BICUBIC)
    img.paste(tile, (int(px(m["x"]) - tile.width / 2), int(px(m["y"]) - tile.height / 2)), tile)


def page(p, economy):
    img = Image.new("RGB", (px(210), px(297)), "white")
    d = ImageDraw.Draw(img)
    for m in p["marks"]:
        k = m["kind"]
        if k == "circle":
            r = px(m["r"])
            box = [px(m["cx"]) - r, px(m["cy"]) - r, px(m["cx"]) + r, px(m["cy"]) + r]
            d.ellipse(box, fill=None if economy or not m.get("fill") else m["fill"], outline="black", width=3 if m.get("cut") else 2)
        elif k == "line":
            d.line([px(m["x1"]), px(m["y1"]), px(m["x2"]), px(m["y2"])], fill="#999999" if economy or m.get("dashed") else "black", width=2)
        elif k == "window":
            w, h, a = px(m["w"]) / 2, px(m["h"]) / 2, math.radians(m["rotate"])
            pts = [(-w, -h), (w, -h), (w, h), (-w, h)]
            pts = [(px(m["cx"]) + x * math.cos(a) - y * math.sin(a), px(m["cy"]) + x * math.sin(a) + y * math.cos(a)) for x, y in pts]
            d.polygon(pts, fill="white", outline="black", width=3)
        elif k == "image":
            data = m["src"].split(",", 1)[1]
            im = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGBA")
            im.thumbnail((px(m["w"]), px(m["h"])))
            if economy:
                im = ImageOps.grayscale(im.convert("RGB")).convert("RGBA")
            img.paste(im, (px(m["x"]), px(m["y"])), im)
        elif k == "text":
            fill = "black" if economy or "small" not in p["name"] else "white"
            draw_text(img, m, fill)
    return img


def main():
    layout = json.load(open(sys.argv[1]))
    pages = [page(p, layout["economy"]) for p in layout["pages"]]
    pages[0].save(sys.argv[2], "PDF", resolution=DPI, save_all=True, append_images=pages[1:])


if __name__ == "__main__":
    main()
