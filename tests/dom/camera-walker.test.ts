// The room view's owners (4.1.5): the camera and the walker answer for themselves, without a painter or a document.
import { describe, expect, it } from 'vitest';
import { Camera } from '@engine/dom/camera';
import { Walker } from '@engine/dom/walker';
import type { Ent } from '@engine/dom/scene-entity';
import type { Point } from '@engine/core/types';

const camera = (hero: Point | undefined, zoom = 1, reduced = false) => {
  const painted: number[][] = [];
  const cam = new Camera({
    hero: () => hero,
    zoomAt: () => zoom,
    reduced: () => reduced,
    paint: (...a) => painted.push(a),
  });
  return { cam, painted };
};

describe('the camera', () => {
  it('maps a logical point to the screen and back, with its edges, zoom and scale', () => {
    const { cam } = camera([320, 360]);
    cam.width = 1280;
    cam.u = 2;
    cam.enter(1280, { x: 100, follow: false });
    expect(cam.cam).toBe(100);
    expect(cam.toScreen([420, 50])).toEqual([640, 100]);
    const [fx, fy] = [0.25, 0.5];
    const p = cam.toLogical(fx, fy);
    expect(p).toEqual([100 + 160, 200]);
    expect(cam.toScreen(p)).toEqual([fx * 640 * 2, fy * 400 * 2]);
  });

  it('enters a wide room centred on the hero when nothing is saved, clamped to the room', () => {
    const { cam, painted } = camera([1200, 360]);
    cam.enter(1280, undefined);
    expect(cam.follow).toBe(true);
    expect(cam.cam).toBe(640); // 1200 - 320 = 880, clamped to 1280 - 640
    expect(painted.at(-1)).toEqual([640, 1280, 0, 1]);
    cam.enter(640, undefined);
    expect(cam.cam).toBe(0); // a one-screen room never scrolls
  });

  it('pans to a left edge over time, then rests; reduced motion or a zero duration moves at once', async () => {
    const { cam } = camera([320, 360]);
    cam.enter(1280, undefined);
    const done = cam.setCamera(400, 100);
    expect(cam.follow).toBe(false);
    const t0 = performance.now();
    for (let t = t0; t < t0 + 200; t += 20) cam.tick(t, 0.02);
    await done;
    expect(cam.cam).toBe(400);
    await cam.setCamera(10_000, 0);
    expect(cam.cam).toBe(640); // clamped
    cam.followHero();
    cam.rest();
    expect(cam.cam).toBe(0); // the hero at 320: left edge 0
    const r = camera([320, 360], 1, true);
    r.cam.enter(1280, undefined);
    await r.cam.setCamera(300, 500); // resolved at once under reduced motion
    expect(r.cam.cam).toBe(300);
  });

  it('zooms toward what the hero zone asks, bounded 1–2, and keeps the hero in the lower part of the view', () => {
    const { cam } = camera([320, 360], 3);
    cam.enter(640, undefined);
    expect(cam.zoom).toBe(2);
    expect(cam.camY).toBe(200); // 360 - 200 * 0.8 = 200, within 400 - 200
    const t0 = performance.now();
    for (let t = t0; t < t0 + 2000; t += 16) cam.tick(t, 0.016);
    expect(cam.zoom).toBe(2);
  });
});

describe('the walker', () => {
  const ent = (id: string, x: number, y: number): Ent => ({
    id,
    kind: 'hero',
    drawn: false,
    opacity: 1,
    x,
    y,
    h: 84,
    flip: false,
    mouthAt: 0,
    blinkAt: 0,
    bob: 0,
    pose: 'idle',
    frame: 0,
    visible: true,
    hasShadow: true,
    scaleWithDepth: true,
  });

  it('a fast walk puts the entity at the end of the route and redraws it; a skipped motion lands at once', async () => {
    const hero = ent('hero', 100, 360);
    const drawn: string[] = [];
    const w = new Walker({
      ent: (id) => (id === 'hero' ? hero : undefined),
      draw: (e) => drawn.push(e.id),
      sprites: () => ({ idle: ['a'], walk: ['b'] }),
      reduced: () => false,
      passable: () => true,
      blocked: () => {},
    });
    w.enter({ entries: { default: [320, 360] } }, { id: 'r', name: 'R', decor: 'd' });
    expect(await w.walkTo('ghost', [1, 1], true)).toEqual([1, 1]); // nobody: the target, nothing drawn
    const end = await w.walkTo('hero', [500, 360], true);
    expect(end).toEqual([500, 360]);
    expect([hero.x, hero.y]).toEqual([500, 360]);
    expect(drawn).toEqual(['hero']);
    await w.motion('hero', { kind: 'spring', ms: 300, dx: 40, dy: 0 } as never, true);
    expect(hero.x).toBeGreaterThanOrEqual(500);
  });
});
