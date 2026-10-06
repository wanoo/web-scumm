// @vitest-environment happy-dom
// The Canvas painter (dom/render-canvas.ts, D10) draws what the DOM painter would: by depth then arrival, a shadow
// under its character, an upright sprite snapped to device pixels, a mirrored one flipped in place, hidden ones not at
// all. The context is recorded (happy-dom has no canvas).
import { describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '@engine/dom/render-canvas';
import type { SpriteSpec } from '@engine/dom/renderer';

function recorder() {
  const calls: unknown[][] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) =>
      k in t
        ? t[k]
        : (...a: unknown[]) => {
            calls.push([k, ...a]);
          },
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
  return { calls, ctx };
}
const spec = (id: string, extra: Partial<SpriteSpec> = {}): SpriteSpec => ({
  id,
  url: `img/${id}`,
  fx: 100,
  fy: 300,
  w: 40,
  h: 80,
  bob: 0,
  z: 300,
  flip: false,
  flipV: false,
  rot: 0,
  visible: true,
  opacity: 1,
  ...extra,
});

describe('the canvas painter', () => {
  it('paints the backdrop, then shadows and sprites by depth, skipping hidden ones', () => {
    const { calls, ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const loaded = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const w = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100);
    const h = vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(100);
    const r = new CanvasRenderer();
    r.reset('img/bg', 640);
    r.resize(1);
    r.sprite(spec('front', { z: 350 }));
    r.sprite(spec('back', { z: 200, shadow: { x: 90, y: 196, w: 20, h: 8, z: 199, visible: true } }));
    r.sprite(spec('ghost', { visible: false }));
    r.sprite(spec('mirror', { z: 250, flip: true, fx: 100.3 }));
    r.paint();
    const name = (x: unknown) =>
      x instanceof HTMLCanvasElement ? 'blit' : (x as HTMLImageElement).src.split('/').pop();
    const draws = calls.filter((c) => c[0] === 'drawImage').map((c) => name(c[1]));
    // The backdrop is drawn once into the room's background cache, then copied onto the viewport.
    expect(draws).toEqual(['bg', 'blit', 'back', 'mirror', 'front']);
    expect(calls.findIndex((c) => c[0] === 'ellipse')).toBeLessThan(
      calls.findIndex((c) => c[0] === 'drawImage' && (c[1] as HTMLImageElement).src?.endsWith('/back')),
    );
    // Upright: snapped to device pixels; mirrored: flipped about its own box.
    const front = calls.find((c) => c[0] === 'drawImage' && (c[1] as HTMLImageElement).src?.endsWith('/front'))!;
    expect(front.slice(2)).toEqual([80, 220, 40, 80]);
    expect(calls.some((c) => c[0] === 'scale' && c[1] === -1)).toBe(true);
    expect(r.paints).toBe(1);
    loaded.mockRestore();
    w.mockRestore();
    h.mockRestore();
  });
});

describe('the canvas painter draws the stage', () => {
  it('backdrop layers first, scenery among sprites by depth, occluders at theirs, the foreground, then lights (they fall on it too), then effects', () => {
    const { calls, ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const loaded = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const w = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100);
    const h = vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(100);
    const r = new CanvasRenderer();
    r.reset('img/bg', 640);
    r.resize(1);
    const layer = (id: string, role: 'backdrop' | 'scenery' | 'foreground' | 'effect', z: number) => ({
      id,
      url: `img/${id}`,
      role,
      x: 0,
      y: 0,
      w: 640,
      h: 400,
      z,
      parallax: [1, 1] as [number, number],
      blend: 'normal' as const,
      opacity: 1,
      visible: true,
    });
    r.stage({
      backdrop: { url: 'img/bg', x: 0, y: 0, w: 640, h: 400 },
      layers: [
        layer('sky', 'backdrop', -1000),
        layer('counter', 'scenery', 320),
        layer('plant', 'foreground', 10000),
        layer('fog', 'effect', 20000),
        { ...layer('hidden', 'scenery', 1), visible: false },
      ],
      occluders: [{ id: 'pillar', z: 330, layer: 'counter', feather: 0, invert: false }],
      lights: [{ id: 'sun', kind: 'ambient', color: '#fff', intensity: 0.5, blend: 'multiply', visible: true }],
      emitters: [],
      reduceMotion: false,
    });
    r.sprite(spec('ann', { z: 310 }));
    r.sprite(spec('bob', { z: 340 }));
    r.paint();
    const seq = calls
      .filter((c) => c[0] === 'drawImage' || c[0] === 'fillRect')
      .map((c) =>
        c[0] === 'fillRect'
          ? 'light'
          : c[1] instanceof HTMLCanvasElement
            ? 'blit'
            : (c[1] as HTMLImageElement).src.split('/').pop(),
      );
    // The backdrop and the still backdrop layer go into the background cache, copied once.
    expect(seq).toEqual(['bg', 'sky', 'blit', 'ann', 'counter', 'counter', 'bob', 'plant', 'light', 'fog']);
    loaded.mockRestore();
    w.mockRestore();
    h.mockRestore();
  });
});
