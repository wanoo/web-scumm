// Stage physics (core/motion.ts): computed motions. Closed forms of time, so a flight is the same on every device and
// at every frame rate; presentation only, so the solver sees nothing of them.
import { describe, expect, it } from 'vitest';
import { arc, motionAt, motionEnd, spline, spring } from '@engine/core/motion';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { solve } from '@engine/tools/solve';
import type { GameDef } from '@engine/core/types';
import { game, layouts } from './fixture';

describe('the closed forms', () => {
  it('an arc starts and lands on its ends and peaks at mid-flight', () => {
    expect(arc([0, 300], [200, 300], 50, 0)).toEqual([0, 300]);
    expect(arc([0, 300], [200, 300], 50, 1)).toEqual([200, 300]);
    expect(arc([0, 300], [200, 300], 50, 0.5)).toEqual([100, 250]);
  });
  it('a spring starts at its amplitude and dies out; the same instant gives the same value', () => {
    expect(spring(10, 3, 0.25, 0)).toBe(10);
    expect(Math.abs(spring(10, 3, 0.25, 3))).toBeLessThan(0.01);
    expect(spring(10, 3, 0.25, 0.37)).toBe(spring(10, 3, 0.25, 0.37));
  });
  it('a spline goes through its points', () => {
    const pts: [number, number][] = [[0, 0], [100, 50], [200, 0], [300, 80]];
    expect(spline(pts, 0)).toEqual([0, 0]);
    const mid = spline(pts, 1 / 3);
    expect(mid[0]).toBeCloseTo(100); expect(mid[1]).toBeCloseTo(50);
    const end = spline(pts, 1);
    expect(end[0]).toBeCloseTo(300, 0); expect(end[1]).toBeCloseTo(80, 0);
  });
  it('frames and ends: a launch turns as it flies, a spring is back at rest, a follower keeps its offset', () => {
    expect(motionAt({ kind: 'launch', from: [0, 0], to: [100, 0], height: 0, ms: 900, rotate: 360 }, 0.5)).toEqual({ at: [50, 0], rot: 180 });
    expect(motionAt({ kind: 'spring', axis: 'y', amplitude: 10, frequency: 3, damping: 0.2, ms: 1000 }, 1)).toEqual({ dy: 0, rot: 0 });
    expect(motionAt({ kind: 'follow', offset: [0, -40], ms: 500 }, 0.3)).toEqual({ dx: 0, dy: -40, rot: 0 });
    expect(motionEnd({ kind: 'path', points: [[0, 0], [10, 10]], ms: 100, orient: false })).toEqual([10, 10]);
    expect(motionEnd({ kind: 'spring', axis: 'x', amplitude: 1, frequency: 1, damping: 0.5, ms: 100 })).toBeNull();
  });
});

describe('in the engine', () => {
  it('a character keeps where its flight ends; a prop changes nothing in the state', async () => {
    const ui = new FakePresenter();
    const e = new Engine(structuredClone(game), layouts, ui, new MemoryStore());
    await e.checkpoint('free');
    const room = e.room().id;
    const before = JSON.stringify(e.state.props);
    await e.exec([{ launch: { target: 'hero', to: [300, 350] } }], { room: e.room(), fast: true } as never);
    expect(e.state.hero[room]).toEqual([300, 350]);
    expect(ui.log).toContain('motion hero launch');
    expect(JSON.stringify(e.state.props)).toBe(before);
  });
  it('the solver: the same game with motions everywhere proves the same', async () => {
    const plain = await solve(structuredClone(game), layouts, { mode: 'prove' });
    const g = structuredClone(game) as GameDef;
    for (const r of g.rooms) for (const rule of r.on ?? []) rule.do = [{ spring: { target: 'hero' } }, ...rule.do];
    const moved = await solve(g, layouts, { mode: 'prove' });
    expect([moved.status, moved.states]).toEqual([plain.status, plain.states]);
  }, 60000);
});
