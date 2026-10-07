// The busy owner (4.1.11, core/busy.ts; the remainder of 4.1.5): one object holds whether the engine runs something,
// the tutorial step it waits for and a skip in progress. The engine reads it; the player only asks `busy` and
// `guiding`, never sets them.
import { describe, expect, it } from 'vitest';
import { Busy } from '@engine/core/busy';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { game, layouts } from './fixture';

describe('Busy', () => {
  it('counts the runs in progress; a tutorial step waiting makes it idle for the player', () => {
    const b = new Busy();
    expect(b.busy).toBe(false);
    b.enter();
    b.enter();
    expect(b.busy).toBe(true);
    expect(b.leave()).toBe(false);
    b.guide = { verb: 'look', target: 'door', say: 'Look at the door.', resolve: () => {} };
    expect(b.busy).toBe(false);
    expect(b.guiding).toEqual({ verb: 'look', target: 'door' });
    expect(b.leave()).toBe(true);
  });

  it('accepts the awaited action only, as the object or the target; nothing without a step', () => {
    const b = new Busy();
    expect(b.accepts({ verb: 'use', a: 'door' })).toBe(false);
    b.guide = { verb: 'use', target: 'door', say: '', resolve: () => {} };
    expect(b.accepts({ verb: 'look', a: 'door' })).toBe(false);
    expect(b.accepts({ verb: 'use', a: 'door' })).toBe(true);
    expect(b.accepts({ verb: 'use', a: 'key', b: 'door' })).toBe(true);
  });

  it('reset forgets the step, the count and the skip (a new session)', () => {
    const b = new Busy();
    b.enter();
    b.skipping = true;
    b.guide = { verb: 'look', target: 'x', say: '', resolve: () => {} };
    b.reset();
    expect([b.count, b.guide, b.skipping]).toEqual([0, null, false]);
  });

  it("is the engine's: busy while an action runs, idle after", async () => {
    const e = new Engine(structuredClone(game), layouts, new FakePresenter(), new MemoryStore());
    await e.checkpoint('free');
    const seen: boolean[] = [];
    e.onChange = () => seen.push(e.busy);
    await e.script([{ set: 'x' }]);
    expect(seen[0]).toBe(true);
    expect(e.busy).toBe(false);
    expect(e.busyState.count).toBe(0);
  });
});
