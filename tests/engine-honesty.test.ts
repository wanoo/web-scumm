// The engine's honesty (4.1.4): a script that throws is stopped and said, not silently dead while the save calls it
// alive; the time in a state, a trace and a save comes from the injected clock; what the store writes and what a
// load restores go through hooks, not through replaced methods; `destroy` ends the loops and releases whoever waits.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { saveEnvelope } from '@engine/core/save';
import { stateDigest } from '@engine/core/diff';
import type { GameDef, GameState } from '@engine/core/types';
import { world, worldLayouts } from './fixtures/world';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** A presenter whose waits take time: a looping script with `wait` yields to the test, as it does in a browser. */
class SlowPresenter extends FakePresenter {
  override async wait(): Promise<void> {
    await tick(2);
  }
}

describe('a script that throws', () => {
  it('is stopped, marked off in the save, and reported through onError; the engine plays on', async () => {
    const g = world();
    // `startScript` of a script nobody declares throws inside `advance`; nothing else of the game is touched.
    g.scripts!.push({ id: 'broken', do: [{ startScript: 'ghost' }] });
    const e = new Engine(g, worldLayouts, new SlowPresenter(), new MemoryStore());
    const errors: string[] = [];
    e.onError = (err, where) => errors.push(`${where}: ${err instanceof Error ? err.message : String(err)}`);
    e.autoScripts = true;
    await e.newGame();
    for (let i = 0; i < 20 && !errors.length; i++) await tick();
    expect(errors).toEqual(['script broken: unknown script: ghost']);
    expect(e.state.scripts?.broken).toMatchObject({ off: true });
    expect(e.loops.has('broken')).toBe(false);
    await e.act({ verb: 'look', a: 'door' });
    expect(e.state.room).toBe('hall');
    e.destroy();
  });
});

describe('time comes from the clock', () => {
  it('two new games under the same clock have the same state, trace and envelope', async () => {
    const make = async () => {
      const e = new Engine(world(), worldLayouts, new FakePresenter(), new MemoryStore());
      e.clock = () => 1_000_000;
      e.traceOn = true;
      await e.newGame();
      e.log('action', 'x');
      return e;
    };
    const a = await make();
    const b = await make();
    expect(a.state.started).toBe(1_000_000);
    expect(stateDigest(a.state)).toBe(stateDigest(b.state));
    expect(a.trace[0]?.t).toBe(1_000_000);
    expect(a.session?.at).toBe(1_000_000);
    expect(saveEnvelope(a.game, a.state, 42).savedAt).toBe(42);
  });
});

describe('hooks around the store', () => {
  it('beforeSave shapes what is written; onLoad sees the migrated state before, and the end after', async () => {
    const store = new MemoryStore();
    const e = new Engine(world(), worldLayouts, new FakePresenter(), store);
    e.beforeSave = (s) => ({ ...s, music: { id: 'theme', at: 7 } });
    await e.newGame();
    expect(store.data?.music).toEqual({ id: 'theme', at: 7 });
    expect(e.state.music).toBeUndefined(); // the hook shapes the copy written, never the state itself
    const order: string[] = [];
    e.onLoad = {
      before: (s: GameState) => order.push(`before ${s.room} ${s.music?.id}`),
      after: () => order.push('after'),
    };
    await e.load(structuredClone(store.data!));
    expect(order).toEqual(['before hall theme', 'after']);
    e.destroy();
  });
});

describe('destroy', () => {
  it('stops the loops, releases waitUntil, and calls nothing back any more', async () => {
    const g: GameDef = world();
    // A rule that waits for a flag nothing sets (a `waitUntil` inside a rule blocks that rule, unlike a script's own).
    g.rooms[0]!.on!.push({ verb: 'look', a: 'gong', do: [{ waitUntil: 'never_set' }, { set: 'after_wait' }] });
    const e = new Engine(g, worldLayouts, new SlowPresenter(), new MemoryStore());
    e.autoScripts = true;
    let changes = 0;
    e.onChange = () => changes++;
    await e.newGame();
    await tick();
    expect(e.loops.has('hall_clock')).toBe(true);
    const waiting = e.act({ verb: 'look', a: 'gong' });
    await tick();
    expect(e.waiters.size).toBeGreaterThan(0);
    const seen = changes;
    e.destroy();
    await Promise.race([waiting, tick(200).then(() => 'late')]).then((r) => expect(r).not.toBe('late'));
    await tick(20);
    expect(e.loops.size).toBe(0);
    expect(e.destroyed).toBe(true);
    expect(e.state.flags.after_wait).toBeUndefined();
    await e.act({ verb: 'look', a: 'door' });
    expect(changes).toBe(seen); // onChange is gone
  });

  it('waitUntil wakes on the state change that satisfies it, not a quarter of a second later', async () => {
    const g: GameDef = world();
    g.rooms[0]!.on!.push({ verb: 'look', a: 'gong', do: [{ waitUntil: 'open' }, { set: 'passed' }] });
    const e = new Engine(g, worldLayouts, new SlowPresenter(), new MemoryStore());
    await e.newGame();
    const run = e.act({ verb: 'look', a: 'gong' });
    await tick();
    const t0 = Date.now();
    await e.run(async () => {
      e.state.flags.open = true;
    });
    await run;
    expect(e.state.flags.passed).toBe(true);
    expect(Date.now() - t0).toBeLessThan(200);
    e.destroy();
  });
});
