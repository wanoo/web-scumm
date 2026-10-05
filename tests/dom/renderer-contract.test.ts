// @vitest-environment happy-dom
// The scene model and its painter (dom/renderer.ts, D10): RoomView decides where everything is, the painter only
// draws what it is given. A recording painter stands in for the DOM one: every entity reaches it as a finished sprite,
// the hit test answers from the model alone, and the DOM painter turns a sprite into the same styles the room had.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { RoomView } from '@engine/dom/room';
import { DomRenderer } from '@engine/dom/render-dom';
import type { SceneRenderer, SpriteSpec } from '@engine/dom/renderer';
import type { AssetBank } from '@engine/dom/assets';
import { game, layouts } from '../fixture';

class Recorder implements SceneRenderer {
  el = document.createElement('div');
  backdrop = ''; width = 0; cam = 0; u = 1;
  sprites = new Map<string, SpriteSpec>();
  reset(b: string, w: number) { this.backdrop = b; this.width = w; this.sprites.clear(); }
  sprite(s: SpriteSpec) { this.sprites.set(s.id, s); }
  camera(x: number) { this.cam = x; }
  resize(u: number) { this.u = u; }
  dispose() {}
}
const bank = { img: (id: string) => `img/${id}`, size: () => [100, 200], widthFor: (_: string, h: number) => h / 2, preload: async () => {} } as unknown as AssetBank;

async function scene(renderer: SceneRenderer) {
  const e = new Engine(structuredClone(game), layouts, new FakePresenter(), new MemoryStore());
  await e.checkpoint('free');
  const v = new RoomView(e, bank, renderer);
  await v.build(e.room());
  v.still();
  return { e, v };
}

describe('the renderer contract', () => {
  it('every entity of the room reaches the painter as a finished sprite, with its backdrop and width', async () => {
    const r = new Recorder();
    const { e, v } = await scene(r);
    expect(r.backdrop).toBe(`img/${e.room().decor}`);
    expect(r.width).toBe(v.width);
    const ids = [...Object.keys(e.room().props ?? {}).filter((id) => layouts[e.room().id]?.props?.[id]), ...Object.keys(e.room().actors ?? {}), e.heroId()];
    for (const id of ids) expect(r.sprites.has(id), id).toBe(true);
    for (const s of r.sprites.values()) if (s.url) { expect(s.w).toBeGreaterThan(0); expect(s.h).toBeGreaterThan(0); expect(Number.isFinite(s.z)).toBe(true); }
  });

  it("the hit test is the model's: a tap at the centre of a drawn target finds it, whatever painter is attached", async () => {
    const a = await scene(new Recorder());
    const b = await scene(new DomRenderer());
    for (const id of a.e.targets(a.e.room())) {
      const box = a.v.box(id);
      if (!box) continue;
      const p: [number, number] = [box[0] + box[2] / 2, box[1] + box[3] / 2];
      expect(b.v.hit(p), id).toBe(a.v.hit(p));
    }
  });

  it('the DOM painter: position, size, depth and mirror from the sprite, a shadow under characters', () => {
    const d = new DomRenderer();
    d.reset('img/bg', 640);
    d.resize(2);
    d.sprite({ id: 'ann', url: 'img/ann', fx: 100, fy: 300, w: 40, h: 80, bob: 0, z: 300, flip: true, flipV: false, rot: 0, visible: true, opacity: 1, shadow: { x: 86, y: 296, w: 28, h: 8, z: 299, visible: true } });
    const img = d.el.querySelector('img.spr') as HTMLImageElement;
    expect([img.style.left, img.style.top, img.style.width, img.style.height, img.style.zIndex]).toEqual(['160px', '440px', '80px', '160px', '300']);
    expect(img.classList.contains('flip')).toBe(true);
    expect((d.el.querySelector('.shadow') as HTMLElement).style.width).toBe('56px');
    d.camera(100, 1280);
    expect(d.el.style.transform).toBe('translateX(-200px)');
  });
});
