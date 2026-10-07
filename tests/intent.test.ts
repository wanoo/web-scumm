// Intentions without a page (4.1.11, D21): the null renderer draws nothing, and a game is played through it by
// intentions alone; what reaches the engine is the same session a player's taps would record. `pick` and `open` are
// the presenter's: the engine is not touched by them.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { applyIntent } from '@engine/scene/intent';
import { NullRenderer } from '@engine/scene/null-renderer';
import type { Intent } from '@engine/scene/frame';
import { game, layouts } from './fixture';

async function boot() {
  const e = new Engine(structuredClone(game), layouts, new FakePresenter(), new MemoryStore());
  await e.checkpoint('free');
  return e;
}

describe('applyIntent', () => {
  it('act, with an item or not, and walk reach the engine as the player’s actions', async () => {
    const e = await boot();
    const target = e.targets()[0]!;
    expect(await applyIntent(e, { kind: 'act', verb: 'look', target })).toBe(true);
    expect(await applyIntent(e, { kind: 'act', verb: 'use', target, item: 'talkie' })).toBe(true);
    expect(e.session!.log.map((x) => ('act' in x ? x.act : null))).toEqual([
      { verb: 'look', a: target },
      { verb: 'use', a: 'talkie', b: target },
    ]);
    expect(await applyIntent(e, { kind: 'walk', to: [300, 350] })).toBe(true);
    expect(e.state.hero[e.state.room]).toEqual([300, 350]);
  });

  it('pick and open are not the engine’s', async () => {
    const e = await boot();
    const before = JSON.stringify(e.state);
    for (const i of [
      { kind: 'pick', choice: 0 },
      { kind: 'open', what: 'map' },
    ] as Intent[])
      expect(await applyIntent(e, i)).toBe(false);
    expect(JSON.stringify(e.state)).toBe(before);
    expect(e.session!.log).toEqual([]);
  });
});

describe('NullRenderer', () => {
  it('skips a frame equal to the last, keeps the others, and plays a game by intentions', async () => {
    const e = await boot();
    const r = new NullRenderer();
    r.mount(null);
    const pending: Promise<boolean>[] = [];
    r.onIntent((i) => pending.push(applyIntent(e, i)));
    const f = {
      hash: 'x',
      room: 'house',
      camera: { x: 0, y: 0, zoom: 1, width: 640 },
      layers: [],
      actors: [],
      hotspots: [],
      effects: [],
      reduceMotion: false,
    };
    r.render(f);
    r.render({ ...f });
    r.render({ ...f, hash: 'y' });
    expect(r.frames.map((x) => x.hash)).toEqual(['x', 'y']);
    r.intend({ kind: 'act', verb: 'look', target: e.targets()[0]! });
    await Promise.all(pending);
    expect(e.session!.log).toHaveLength(1);
    r.unmount();
    expect(r.mounted).toBe(false);
  });
});
