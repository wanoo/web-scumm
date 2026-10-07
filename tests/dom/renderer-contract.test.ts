// @vitest-environment happy-dom
// The scene model and its painter (dom/renderer.ts, D10): RoomView decides where everything is, the painter only
// draws what it is given. A recording painter stands in for the DOM one: every entity reaches it as a finished sprite,
// the hit test answers from the model alone, and the DOM painter turns a sprite into the same styles the room had.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { RoomView } from '@engine/dom/room';
import { DomRenderer } from '@engine/dom/render-dom';
import type { SceneRenderer, SpriteSpec, StageSpec } from '@engine/dom/renderer';
import type { AssetBank } from '@engine/dom/assets';
import { game, layouts } from '../fixture';

class Recorder implements SceneRenderer {
  el = document.createElement('div');
  backdrop = '';
  width = 0;
  cam = 0;
  u = 1;
  sprites = new Map<string, SpriteSpec>();
  reset(b: string, w: number) {
    this.backdrop = b;
    this.width = w;
    this.sprites.clear();
  }
  sprite(s: SpriteSpec) {
    this.sprites.set(s.id, s);
  }
  camera(x: number) {
    this.cam = x;
  }
  resize(u: number) {
    this.u = u;
  }
  st: StageSpec | null = null;
  stage(s: StageSpec) {
    this.st = s;
  }
  dispose() {}
}
const bank = {
  img: (id: string) => `img/${id}`,
  size: () => [100, 200],
  widthFor: (_: string, h: number) => h / 2,
  preload: async () => {},
} as unknown as AssetBank;

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
    expect(r.width).toBe(v.camera.width);
    const ids = [
      ...Object.keys(e.room().props ?? {}).filter((id) => layouts[e.room().id]?.props?.[id]),
      ...Object.keys(e.room().actors ?? {}),
      e.heroId(),
    ];
    for (const id of ids) expect(r.sprites.has(id), id).toBe(true);
    for (const s of r.sprites.values())
      if (s.url) {
        expect(s.w).toBeGreaterThan(0);
        expect(s.h).toBeGreaterThan(0);
        expect(Number.isFinite(s.z)).toBe(true);
      }
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

  it('the frame is memoised: two taps without a change build one frame, a change builds the next', async () => {
    const { e, v } = await scene(new Recorder());
    const n = v.framesBuilt;
    const id = e.targets(e.room())[0]!;
    const box = v.box(id)!;
    const p: [number, number] = [box[0] + box[2] / 2, box[1] + box[3] / 2];
    expect(v.hit(p)).toBe(v.hit(p));
    expect(v.framesBuilt).toBe(n + 1);
    expect(v.frame()).toBe(v.frame());
    expect(v.framesBuilt).toBe(n + 1);
    v.place(e.heroId(), [100, 350]);
    v.hit(p);
    expect(v.framesBuilt).toBe(n + 2);
    v.invalidate(); // the App's onChange: the state may have changed
    v.hit(p);
    expect(v.framesBuilt).toBe(n + 3);
  });

  it('the DOM painter: position, size, depth and mirror from the sprite, a shadow under characters', () => {
    const d = new DomRenderer();
    d.reset('img/bg', 640);
    d.resize(2);
    d.sprite({
      id: 'ann',
      url: 'img/ann',
      fx: 100,
      fy: 300,
      w: 40,
      h: 80,
      bob: 0,
      z: 300,
      flip: true,
      flipV: false,
      rot: 0,
      visible: true,
      opacity: 1,
      shadow: { x: 86, y: 296, w: 28, h: 8, z: 299, visible: true },
    });
    const img = d.el.querySelector('img.spr') as HTMLImageElement;
    expect([img.style.left, img.style.top, img.style.width, img.style.height, img.style.zIndex]).toEqual([
      '160px',
      '440px',
      '80px',
      '160px',
      '300',
    ]);
    expect(img.classList.contains('flip')).toBe(true);
    expect((d.el.querySelector('.shadow') as HTMLElement).style.width).toBe('56px');
    d.camera(100, 1280);
    expect(d.el.style.transform).toBe('translateX(-200px)');
  });
});

describe('the stage through the contract', () => {
  it('the model places layers on the backdrop box, evaluates their conditions, and gives the stage again when one changes', async () => {
    const r = new Recorder();
    const { e, v } = await scene(r);
    const room = e.room();
    room.stage = {
      layers: [{ id: 'lamp', image: 'l/lamp', role: 'foreground', visible: 'lamp_on' }],
      lights: [{ id: 'glow', kind: 'ambient', color: '#fc6', visible: 'lamp_on' }],
    };
    await v.build(room);
    expect(r.st!.backdrop).toMatchObject({ url: `img/${room.decor}` });
    expect(r.st!.layers).toEqual([expect.objectContaining({ id: 'lamp', url: 'img/l/lamp', visible: false })]);
    e.state.flags.lamp_on = true;
    v.refreshVisibility();
    expect(r.st!.layers[0].visible).toBe(true);
    expect(r.st!.lights[0]).toMatchObject({ visible: true, blend: 'multiply', intensity: 0.6 });
  });

  it('the DOM painter: a layer at its depth with its parallax, a polygon occluder as the backdrop clipped at its depth', () => {
    const d = new DomRenderer();
    d.reset('img/bg', 1280);
    d.resize(1);
    d.stage({
      backdrop: { url: 'img/bg', x: 0, y: 0, w: 1280, h: 400 },
      reduceMotion: false,
      lights: [],
      emitters: [],
      layers: [
        {
          id: 'plant',
          url: 'img/plant',
          role: 'foreground',
          x: 100,
          y: 200,
          w: 80,
          h: 200,
          z: 10000,
          parallax: [1.5, 1],
          blend: 'normal',
          opacity: 1,
          visible: true,
        },
      ],
      occluders: [
        {
          id: 'pillar',
          z: 330,
          polygon: [
            [10, 10],
            [50, 10],
            [50, 300],
          ],
          feather: 0,
          invert: false,
        },
      ],
    });
    d.camera(200, 1280);
    const plant = d.el.querySelector('img.layer') as HTMLImageElement;
    expect([plant.style.left, plant.style.zIndex]).toEqual(['0px', '10000']); // 100 + 200 × (1 − 1.5)
    const pillar = d.el.querySelector('.occluder') as HTMLElement;
    expect(pillar.style.zIndex).toBe('330');
    expect(pillar.style.clipPath).toContain('polygon(');
  });
});
