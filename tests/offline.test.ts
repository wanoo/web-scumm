import { describe, expect, it } from 'vitest';
import { offlinePlan, planSize } from '@engine/dom/offline';
import type { AssetManifest } from '@engine/dom/assets';
import { mini } from './fixtures/mini';
import { game as demo, manifest as demoManifest } from '../games/demo';

describe('offlinePlan', () => {
  it('orders images, effects, voices, music, videos; music and videos one at a time', () => {
    const g = mini();
    g.audio = { sfx: { a: 'a.mp3', b: 'b.mp3' }, voices: { v: 'v.mp3' }, music: { m1: 'm1.mp3', m2: 'm2.mp3' } };
    const manifest: AssetManifest = { images: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`img${i}`, [1, 1]])), videos: { 'intro.mp4': 3 } };
    const plan = offlinePlan(g, manifest, { initialImages: 2, audioFiles: 2 });
    expect(plan.map((b) => `${b.kind}:${b.ids.length}`)).toEqual(['img:2', 'img:2', 'img:1', 'sfx:2', 'voice:1', 'music:1', 'music:1', 'video:1']);
    expect(planSize(plan)).toEqual({ files: 11, batches: 8 });
  });

  it('covers every image and sound of the sample game, with the default batch sizes', () => {
    const plan = offlinePlan(demo, demoManifest);
    const { files } = planSize(plan);
    const expected = Object.keys(demoManifest.images).length + Object.keys(demo.audio?.sfx ?? {}).length + Object.keys(demo.audio?.music ?? {}).length + Object.keys(demoManifest.videos ?? {}).length;
    expect(files).toBe(expected);
    expect(plan.filter((b) => b.kind === 'img').every((b) => b.ids.length <= 120)).toBe(true);
    expect(plan.find((b) => b.kind === 'music')?.ids).toEqual(['swan_lake.mp3']);
  });
});
