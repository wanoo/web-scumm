#!/usr/bin/env python3
"""The interface font as a Latin subset (src/engine/dom/fonts/DotGothic16-latin.ttf, from public/fonts/DotGothic16.ttf).

DotGothic16 holds 9 362 glyphs, mostly Japanese: 2 MB that every first visit downloaded, twice (the page, then the
service worker's precache). The subset keeps Latin, Latin-1 and Latin Extended-A, the punctuation, the euro sign and the
arrows, boxes and symbols a game's text and interface use: the full font stays in public/fonts as a fallback face
(unicode-range) that loads only for a character outside the subset (style.css). OFL 1.1, no Reserved Font Name.
Run: python3 tools/subset-font.py (needs fonttools: pip install fonttools).
"""
from fontTools import subset

RANGES = [(0x20, 0x7E), (0xA0, 0x17F), (0x2010, 0x2027), (0x2030, 0x203A), (0x20AC, 0x20AC), (0x2122, 0x2122),
          (0x2190, 0x21FF), (0x2500, 0x25FF), (0x2600, 0x26FF), (0x2700, 0x27BF)]
UNICODES = [c for a, b in RANGES for c in range(a, b + 1)]

if __name__ == '__main__':
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    font = subset.load_font('public/fonts/DotGothic16.ttf', opts)
    s = subset.Subsetter(opts)
    s.populate(unicodes=UNICODES)
    s.subset(font)
    subset.save_font(font, 'src/engine/dom/fonts/DotGothic16-latin.ttf', opts)
    print('unicode-range:', ', '.join(f'U+{a:04X}-{b:04X}' if a != b else f'U+{a:04X}' for a, b in RANGES))
