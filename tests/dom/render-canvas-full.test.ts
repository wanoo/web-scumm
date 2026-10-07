// @vitest-environment happy-dom
// The Canvas painter's full set (4.1.11, programme §7.4), beside what tests/dom/render-canvas.test.ts already holds
// (layers, parallax, occluders, lights, sprites by depth) and tests/dom/camera-walker.test.ts (vertical camera, zoom):
// particles seeded by their emitter (two painters draw the same) and none with reduced motion; a lost context paints
// nothing and a restored one rebuilds its caches; a room's transition (fade, wipe, cut, none with reduced motion).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRenderer } from '@engine/dom/render-canvas';
import type { SceneRenderer, SpriteSpec, StageSpec } from '@engine/dom/renderer';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { RoomView } from '@engine/dom/room';
import type { AssetBank } from '@engine/dom/assets';
import { game, layouts } from '../fixture';

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
function loaded() {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(100);
}
const stage = (extra: Partial<StageSpec> = {}): StageSpec => ({
  backdrop: { url: 'img/bg', x: 0, y: 0, w: 640, h: 400 },
  layers: [],
  occluders: [],
  lights: [],
  emitters: [{ id: 'snowfall', kind: 'snow', color: '#fff', rate: 20, area: [0, 0, 640, 400], visible: true }],
  reduceMotion: false,
  ...extra,
});
const name = (x: unknown) => (x instanceof HTMLCanvasElement ? 'blit' : (x as HTMLImageElement).src.split('/').pop());

afterEach(() => {
  vi.restoreAllMocks();
});

describe('particles', () => {
  /** Half a second of snow: the flakes born, where they are drawn. */
  function snow(reduceMotion: boolean) {
    const { calls, ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    loaded();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const r = new CanvasRenderer();
    r.reset('img/bg', 640);
    r.resize(1);
    r.stage(stage({ reduceMotion }));
    // A paint advances them by at most a tenth of a second: six paints, 100 ms apart.
    for (let i = 0; i < 6; i++) {
      r.paint();
      now += 100;
    }
    r.dispose();
    return calls.filter((c) => c[0] === 'arc').map((c) => c.slice(1, 4));
  }

  it('are seeded by their emitter: two painters draw the same flakes at the same places', () => {
    const a = snow(false);
    expect(a.length).toBeGreaterThan(5);
    expect(snow(false)).toEqual(a);
  });

  it('are not drawn with reduced motion', () => {
    expect(snow(true)).toEqual([]);
  });
});

describe('a lost context', () => {
  it('paints nothing while lost; restored, it rebuilds its caches and paints again', () => {
    const { calls, ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    loaded();
    const r = new CanvasRenderer();
    r.reset('img/bg', 640);
    r.resize(1);
    r.stage(stage({ emitters: [] }));
    r.paint();
    const draws = () => calls.filter((c) => c[0] === 'drawImage').map((c) => name(c[1]));
    expect(draws()).toEqual(['bg', 'blit']);
    r.paint();
    expect(draws()).toEqual(['bg', 'blit', 'blit']); // the background is cached
    r.canvas.dispatchEvent(new Event('contextlost'));
    const before = r.paints;
    r.paint();
    expect(r.paints).toBe(before);
    expect(r.lost).toBe(true);
    calls.length = 0;
    r.canvas.dispatchEvent(new Event('contextrestored'));
    expect(r.lost).toBe(false);
    r.paint();
    expect(draws()).toEqual(['bg', 'blit']); // the cache was rebuilt from the images
    expect(r.paints).toBe(before + 1);
    r.dispose();
  });

  it('stops listening once disposed', () => {
    const { ctx } = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const r = new CanvasRenderer();
    r.dispose();
    r.canvas.dispatchEvent(new Event('contextlost'));
    expect(r.lost).toBe(false);
  });
});

describe("a room's transition", () => {
  class Painter implements SceneRenderer {
    el = document.createElement('div');
    reset() {}
    sprite(_s: SpriteSpec) {}
    camera() {}
    resize() {}
    stage() {}
    dispose() {}
  }
  const bank = {
    img: (id: string) => `img/${id}`,
    size: () => [100, 200],
    widthFor: (_: string, h: number) => h / 2,
    preload: async () => {},
  } as unknown as AssetBank;

  async function enter(transition: 'fade' | 'wipe' | 'cut', reduce = false) {
    const g = structuredClone(game);
    const e = new Engine(g, layouts, new FakePresenter(), new MemoryStore());
    await e.checkpoint('free');
    (e.room() as { stage?: object }).stage = { transition };
    const p = new Painter();
    const animate = vi.fn();
    (p.el as unknown as { animate: unknown }).animate = animate;
    const v = new RoomView(e, bank, p);
    v.reduceMotion = reduce;
    await v.build(e.room());
    v.destroy();
    return animate.mock.calls.map((c) => Object.keys((c[0] as object[])[0]!)[0]);
  }

  it('a fade animates the opacity of the surface, a wipe its clip; a cut and reduced motion none', async () => {
    expect(await enter('fade')).toEqual(['opacity']);
    expect(await enter('wipe')).toEqual(['clipPath']);
    expect(await enter('cut')).toEqual([]);
    expect(await enter('fade', true)).toEqual([]);
  });
});
