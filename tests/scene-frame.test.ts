// The scene frame as a pure function (4.1.11, scene/frame.ts): the same inputs give the same frame and hash, a moved
// sprite another hash; the hit polygons are precomputed (a layout polygon decides inside its shape, a box edges
// included, the smallest target wins); the stage and the sprites come back out in the order a painter adds them.
import { describe, expect, it } from 'vitest';
import type { GameState, Layout } from '@engine/core/types';
import type { SpriteSpec, StageSpec } from '@engine/dom/renderer';
import {
  type FrameEntity,
  type FrameInput,
  hitTest,
  sceneFrame,
  spritesOfFrame,
  stageOfFrame,
} from '@engine/scene/frame';

const sprite = (id: string, fx: number, extra: Partial<SpriteSpec> = {}): SpriteSpec => ({
  id,
  url: `img/${id}`,
  fx,
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
const stage: StageSpec = {
  backdrop: { url: 'img/bg', x: 0, y: 0, w: 640, h: 400 },
  layers: [
    {
      id: 'fg',
      url: 'img/fg',
      role: 'foreground',
      x: 0,
      y: 0,
      w: 640,
      h: 400,
      z: 10000,
      parallax: [1.2, 1],
      blend: 'normal',
      opacity: 1,
      visible: true,
    },
  ],
  occluders: [
    {
      id: 'pillar',
      z: 250,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      feather: 0,
      invert: false,
    },
  ],
  lights: [{ id: 'lamp', kind: 'ambient', color: '#fff', intensity: 0.4, blend: 'multiply', visible: true }],
  emitters: [],
  reduceMotion: false,
};
const state = { room: 'hall' } as GameState;
const layouts: Record<string, Layout> = {
  hall: {
    hotspots: {
      door: { rect: [500, 100, 100, 200] },
      rug: {
        poly: [
          [100, 350],
          [300, 350],
          [200, 390],
        ],
      },
    },
  },
};
const ents = (heroX = 320): FrameEntity[] => [
  { id: 'vase', kind: 'prop', sprite: sprite('vase', 120, { z: 200 }), bbox: [100, 220, 40, 80], moving: false },
  {
    id: 'ann',
    kind: 'hero',
    cell: 'ann',
    sprite: sprite('ann', heroX, { flip: true }),
    bbox: [heroX - 20, 220, 40, 80],
    moving: true,
  },
];
const input = (heroX?: number): FrameInput => ({
  stage,
  camera: { x: 0, y: 0, zoom: 1, width: 640 },
  entities: ents(heroX),
  targets: [
    { id: 'door', label: 'Door', verb: 'open' },
    { id: 'rug', label: 'Rug' },
    { id: 'vase', label: 'Vase' },
    { id: 'ghost', label: 'Nothing to tap' },
  ],
  talking: 'ann',
  transition: { kind: 'fade', ms: 400 },
});

describe('sceneFrame', () => {
  it('is pure: the same inputs give an equal frame and hash, a moved sprite another hash', () => {
    const a = sceneFrame(state, layouts, input());
    const b = sceneFrame(structuredClone(state), structuredClone(layouts), input());
    expect(b).toEqual(a);
    expect(sceneFrame(state, layouts, input(330)).hash).not.toBe(a.hash);
  });

  it('layers: the backdrop, the stage layers and occluders, the props; characters apart, with what they do', () => {
    const f = sceneFrame(state, layouts, input());
    expect(f.layers.map((l) => `${l.kind}:${l.id}`)).toEqual([
      'backdrop:backdrop',
      'layer:fg',
      'occluder:pillar',
      'prop:vase',
    ]);
    expect(f.actors).toEqual([
      expect.objectContaining({ id: 'ann', cell: 'ann', at: [320, 300], facing: 'left', speaking: true, moving: true }),
    ]);
    expect(f.effects.map((e) => e.kind)).toEqual(['light', 'transition']);
  });

  it('precomputes the hit polygons: a target with nothing to tap is left out', () => {
    const f = sceneFrame(state, layouts, input());
    expect(f.hotspots.map((h) => [h.id, h.shape, h.polygon.length])).toEqual([
      ['door', 'box', 4],
      ['rug', 'poly', 3],
      ['vase', 'box', 4],
    ]);
    expect(f.hotspots[0]).toMatchObject({ box: [500, 100, 100, 200], area: 20000, verb: 'open', label: 'Door' });
  });

  it('hitTest: inside a polygon only within its shape, a box edges included, the smallest target wins', () => {
    const f = sceneFrame(state, layouts, input());
    expect(hitTest(f, [200, 360])).toBe('rug');
    expect(hitTest(f, [105, 388])).toBeNull(); // in the rug's bounds, outside its triangle
    expect(hitTest(f, [500, 100])).toBe('door'); // the corner of a box counts
    expect(hitTest(f, [120, 250])).toBe('vase');
    expect(hitTest(f, [10, 10])).toBeNull();
  });

  it('gives the stage and the sprites back in the order a painter adds them', () => {
    const f = sceneFrame(state, layouts, input());
    expect(stageOfFrame(f)).toEqual(stage);
    expect(spritesOfFrame(f).map((s) => s.id)).toEqual(['vase', 'ann']);
  });
});
