// Palette swap: recolours a sprite by replacing source colours with target colours (CharacterDef.palette).
// The pixel work (`swapPalette`) is pure and runs on a Uint8ClampedArray (RGBA, as in ImageData), so it is testable
// without a DOM; `PaletteCache` wraps it for the browser (offscreen canvas, one blob URL per image and palette).

/** Source `#rrggbb` → target `#rrggbb`. */
export type Palette = Record<string, string>;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb` → [r, g, b], or null when the string is not a 6-digit hex colour. */
export function parseHex(s: string): [number, number, number] | null {
  if (typeof s !== 'string' || !HEX.test(s)) return null;
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The usable pairs of a palette (invalid entries are skipped; `npm run validate` warns about them). */
export function palettePairs(p: Palette): { from: [number, number, number]; to: [number, number, number] }[] {
  const out: { from: [number, number, number]; to: [number, number, number] }[] = [];
  for (const [k, v] of Object.entries(p)) {
    const from = parseHex(k),
      to = parseHex(v);
    if (from && to) out.push({ from, to });
  }
  return out;
}

/**
 * Replaces colours in place in RGBA pixel data. Alpha is kept; fully transparent pixels are left alone.
 * `tolerance` 0 (default): exact RGB matches only, replaced by the target colour.
 * `tolerance` > 0: a pixel within that RGB distance of a source colour (the nearest one wins) gets the target colour
 * plus its own offset from the source, so the small variations of painted or lossy-compressed art survive.
 * Returns the number of pixels changed.
 */
export function swapPalette(data: Uint8ClampedArray, palette: Palette, tolerance = 0): number {
  const pairs = palettePairs(palette);
  if (!pairs.length) return 0;
  const exact = new Map<number, [number, number, number]>();
  for (const p of pairs) exact.set((p.from[0] << 16) | (p.from[1] << 8) | p.from[2], p.to);
  const tol2 = tolerance * tolerance;
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (tolerance <= 0) {
      const to = exact.get((r << 16) | (g << 8) | b);
      if (!to) continue;
      data[i] = to[0];
      data[i + 1] = to[1];
      data[i + 2] = to[2];
      changed++;
      continue;
    }
    let best = -1,
      bestD = Infinity;
    for (let k = 0; k < pairs.length; k++) {
      const f = pairs[k].from;
      const d = (r - f[0]) ** 2 + (g - f[1]) ** 2 + (b - f[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0 || bestD > tol2) continue;
    const { from, to } = pairs[best];
    // Uint8ClampedArray clamps to 0..255 on assignment.
    data[i] = to[0] + r - from[0];
    data[i + 1] = to[1] + g - from[1];
    data[i + 2] = to[2] + b - from[2];
    changed++;
  }
  return changed;
}

/** Cache key of a palette (order-independent). */
export function paletteKey(p: Palette, tolerance = 0): string {
  return (
    Object.keys(p)
      .sort()
      .map((k) => `${k.toLowerCase()}>${String(p[k]).toLowerCase()}`)
      .join(',') + (tolerance ? `~${tolerance}` : '')
  );
}

/**
 * Browser side: recoloured copies of images, made once per (image URL, palette) and kept as blob URLs.
 * `get` is synchronous (undefined until `load` has finished), so drawing never waits; `load` never fails
 * (on any error the original URL is used).
 */
export class PaletteCache {
  private done = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();

  private key(url: string, p: Palette, tolerance: number) {
    return `${url}|${paletteKey(p, tolerance)}`;
  }

  get(url: string, p: Palette, tolerance = 0): string | undefined {
    return this.done.get(this.key(url, p, tolerance));
  }

  load(url: string, p: Palette, tolerance = 0): Promise<string> {
    const k = this.key(url, p, tolerance);
    const ready = this.done.get(k);
    if (ready) return Promise.resolve(ready);
    let job = this.pending.get(k);
    if (!job) {
      job = recolour(url, p, tolerance).then((out) => {
        this.done.set(k, out);
        this.pending.delete(k);
        return out;
      });
      this.pending.set(k, job);
    }
    return job;
  }
}

async function recolour(url: string, p: Palette, tolerance: number): Promise<string> {
  try {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.src = url;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx || !c.width || !c.height) return url;
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    if (!swapPalette(d.data, p, tolerance)) return url;
    ctx.putImageData(d, 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    return blob ? URL.createObjectURL(blob) : url;
  } catch {
    return url;
  }
}
