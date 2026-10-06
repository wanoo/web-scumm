// The script scheduler (4.1.5): which loops a room entry and a new session start, and which generation ends them.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { world, worldLayouts } from './fixtures/world';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** A presenter whose waits take time: a looping script yields to the test, as it does in a browser. */
class SlowPresenter extends FakePresenter {
  override async wait(): Promise<void> {
    await tick(2);
  }
}

const make = async (auto = true) => {
  const g = world();
  g.scripts = [...(g.scripts ?? []), { id: 'game_clock', loop: true, do: [{ wait: 1 }] }];
  const e = new Engine(g, worldLayouts, new SlowPresenter(), new MemoryStore());
  e.autoScripts = auto;
  await e.newGame();
  await tick();
  return e;
};

describe('the scheduler', () => {
  it('starts the room loops and the game loops on a new session; nothing when auto mode is off', async () => {
    const e = await make();
    expect(e.scheduler.has('hall_clock')).toBe(true);
    expect(e.scheduler.has('game_clock')).toBe(true);
    e.destroy();
    const off = await make(false);
    expect(off.scheduler.size).toBe(0);
    off.destroy();
  });

  it('a room change ends the room loops and keeps the game loops; a new session ends both', async () => {
    const e = await make();
    e.scheduler.next(false);
    await tick(30);
    expect(e.scheduler.has('hall_clock')).toBe(false);
    expect(e.scheduler.has('game_clock')).toBe(true);
    e.scheduler.next(true);
    await tick(30);
    expect(e.scheduler.has('game_clock')).toBe(false);
    expect(e.scheduler.size).toBe(0);
    e.destroy();
  });
});
