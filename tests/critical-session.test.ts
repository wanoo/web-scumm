// The session recorder: entries, their clock and digest, and the answers fed back on replay (core/session-runtime.ts, `SessionLog`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '@engine/core/engine';
import { stateDigest } from '@engine/core/diff';
import { SESSION_MAX } from '@engine/core/engine-shared';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { Session, SessionEntry } from '@engine/core/types';
import { derive } from '@engine/core/prng';
import { mini, miniLayouts } from './fixtures/mini';

const engine = async () => {
  const ui = new FakePresenter();
  const e = new Engine(mini(), miniLayouts, ui, new MemoryStore());
  await e.newGame();
  e.session = null;
  e.sessions.open = [];
  return { e, ui };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newSession', () => {
  it('starts from a copy of the state, undated without a clock', async () => {
    const { e } = await engine();
    e.sessions.t0 = 99;
    const s = e.sessions.newSession({ kind: 'checkpoint', id: 'cp' });
    expect(e.session).toBe(s);
    expect(s).toEqual({ v: 1, start: { kind: 'checkpoint', id: 'cp' }, base: e.state, log: [] });
    expect(s.base).not.toBe(e.state);
    expect('at' in s).toBe(false);
    expect(e.sessions.t0).toBe(0);
  });
  it('is dated by the clock, and its clock origin set, with a clock', async () => {
    const { e } = await engine();
    vi.spyOn(Date, 'now').mockReturnValue(5000); // never read: the clock is the only time the engine knows (4.1.4)
    e.clock = () => 123;
    const s = e.sessions.newSession({ kind: 'new' });
    expect(s.at).toBe(123);
    expect(e.sessions.t0).toBe(123);
  });
});

describe('begin and end', () => {
  it('opens a load session when there is none, and logs the entry', async () => {
    const { e } = await engine();
    const entry: SessionEntry = { enter: 'b' };
    e.sessions.begin(entry);
    expect(e.session?.start).toEqual({ kind: 'load' });
    expect(e.session?.log).toEqual([entry]);
    expect(e.session?.log[0]).toBe(entry);
    expect(e.sessions.open).toEqual([{ entry, src: undefined, pi: 0, mi: 0, ri: 0, gi: 0, steps: 0 }]);
    expect('t' in entry).toBe(false);
  });
  it('keeps the current session below its cap', async () => {
    const { e } = await engine();
    const s = e.sessions.newSession({ kind: 'new' });
    e.sessions.begin({ enter: 'a' });
    expect(e.session).toBe(s);
    expect(s.log).toHaveLength(1);
  });
  it('starts a new session at the cap, from the current state', async () => {
    const { e } = await engine();
    const s = e.sessions.newSession({ kind: 'new' });
    s.log = Array.from({ length: SESSION_MAX - 1 }, () => ({ enter: 'a' }));
    e.sessions.begin({ enter: 'b' });
    expect(e.session).toBe(s);
    expect(s.log).toHaveLength(SESSION_MAX);
    e.sessions.end();
    e.state.flags.late = true;
    const entry: SessionEntry = { enter: 'a' };
    e.sessions.begin(entry);
    expect(e.session).not.toBe(s);
    expect(e.session?.start).toEqual({ kind: 'load' });
    expect(e.session?.base.flags.late).toBe(true);
    expect(e.session?.log).toEqual([entry]);
  });
  it('never cuts a session inside an open entry', async () => {
    const { e } = await engine();
    const s = e.sessions.newSession({ kind: 'new' });
    s.log = Array.from({ length: SESSION_MAX }, () => ({ enter: 'a' }));
    e.sessions.open.push({ entry: { enter: 'a' }, pi: 0, mi: 0, ri: 0, gi: 0, steps: 0 });
    e.sessions.begin({ enter: 'b' });
    expect(e.session).toBe(s);
    expect(s.log).toHaveLength(SESSION_MAX + 1);
    expect(e.sessions.open).toHaveLength(2);
  });
  it('dates the entry from the session start with a clock', async () => {
    const { e } = await engine();
    let now = 1000;
    e.clock = () => now;
    e.sessions.newSession({ kind: 'new' });
    now = 1250.6;
    const entry: SessionEntry = { enter: 'a' };
    e.sessions.begin(entry);
    expect(entry.t).toBe(251);
  });
  it('takes the recorded twin of the entry from the feed', async () => {
    const { e } = await engine();
    const rec: SessionEntry[] = [{ enter: 'a', picks: [1] }, { enter: 'b' }];
    e.sessions.feedSession({ v: 1, start: { kind: 'new' }, base: e.state, log: rec } as Session);
    expect(e.sessions.feed).toEqual(rec);
    expect(e.sessions.feed).not.toBe(rec);
    e.sessions.begin({ enter: 'a' });
    expect(e.sessions.open[0]?.src).toBe(rec[0]);
    expect(e.sessions.feed).toEqual([rec[1]]);
    expect(rec).toHaveLength(2);
  });
  it('closes the entry, with its digest only when digests are on', async () => {
    const { e } = await engine();
    const a: SessionEntry = { enter: 'a' };
    e.sessions.begin(a);
    e.sessions.end();
    expect(e.sessions.open).toEqual([]);
    expect('digest' in a).toBe(false);
    e.digestOn = true;
    const b: SessionEntry = { enter: 'b' };
    e.sessions.begin(b);
    e.sessions.end();
    expect(b.digest).toBe(stateDigest(e.state));
    expect(() => e.sessions.end()).not.toThrow();
    expect(e.sessions.open).toEqual([]);
  });
});

describe('ran', () => {
  it('records what answered in the innermost open entry only', async () => {
    const { e } = await engine();
    e.sessions.ran('rule:x');
    expect(e.session).toBeNull();
    const outer: SessionEntry = { enter: 'a' };
    const inner: SessionEntry = { enter: 'b' };
    e.sessions.begin(outer);
    e.sessions.ran('rule:a');
    e.sessions.begin(inner);
    e.sessions.ran('rule:b');
    e.sessions.ran('rule:c');
    expect(outer.ran).toEqual(['rule:a']);
    expect(inner.ran).toEqual(['rule:b', 'rule:c']);
  });
});

describe('answers', () => {
  const opts = [{ text: 'yes' }, { text: 'no' }, { text: 'bye' }];

  it('asks the presenter outside an entry, and records nothing', async () => {
    const { e, ui } = await engine();
    ui.picks = [1];
    ui.mapPicks = ['b'];
    e.random = () => 0.25;
    expect(await e.sessions.choose(opts, 'ann')).toBe(1);
    expect(ui.asked.at(-1)).toEqual({ n: 3, topic: true, texts: ['yes', 'no', 'bye'] });
    expect(await e.sessions.pickPlace()).toBe('b');
    expect(e.sessions.rand()).toBe(0.25);
    expect(await e.sessions.choose(opts)).toBe(2);
    expect(await e.sessions.choose(opts)).toBe(2);
    expect(await e.sessions.pickPlace()).toBeNull();
    expect(await e.sessions.pickPlace()).toBeNull();
    expect(e.session).toBeNull();
  });

  it('asks the presenter in a live entry, and records the answers', async () => {
    const { e, ui } = await engine();
    ui.picks = [0, 2];
    ui.mapPicks = ['a'];
    let r = 0;
    e.random = () => (r += 0.5);
    const entry: SessionEntry = { enter: 'a' };
    e.sessions.begin(entry);
    expect(await e.sessions.choose(opts)).toBe(0);
    expect(await e.sessions.choose(opts)).toBe(2);
    expect(ui.asked.at(-1)?.topic).toBe(false);
    expect(await e.sessions.pickPlace()).toBe('a');
    expect(await e.sessions.pickPlace()).toBeNull();
    expect(e.sessions.rand()).toBe(0.5);
    expect(e.sessions.rand()).toBe(1);
    expect(entry).toEqual({ enter: 'a', picks: [0, 2], maps: ['a', null], rnd: [0.5, 1] });
  });

  it('takes the recorded answers in order when replaying, then asks', async () => {
    const { e, ui } = await engine();
    ui.picks = [1];
    ui.mapPicks = ['b'];
    e.random = () => 0.9;
    e.sessions.feedSession({
      v: 1,
      start: { kind: 'new' },
      base: e.state,
      log: [{ enter: 'a', picks: [2, 0], maps: [null, 'a'], rnd: [0.1, 0.2] }],
    });
    const entry: SessionEntry = { enter: 'a' };
    e.sessions.begin(entry);
    expect(await e.sessions.choose(opts)).toBe(2);
    expect(await e.sessions.choose(opts)).toBe(0);
    expect(await e.sessions.choose(opts)).toBe(1);
    expect(ui.asked).toHaveLength(1);
    expect(await e.sessions.pickPlace()).toBeNull();
    expect(await e.sessions.pickPlace()).toBe('a');
    expect(await e.sessions.pickPlace()).toBe('b');
    expect(e.sessions.rand()).toBe(0.1);
    expect(e.sessions.rand()).toBe(0.2);
    expect(e.sessions.rand()).toBe(0.9);
    expect(e.sessions.open[0]).toMatchObject({ pi: 2, mi: 2, ri: 2 });
    expect(entry).toEqual({ enter: 'a', picks: [2, 0, 1], maps: [null, 'a', 'b'], rnd: [0.1, 0.2, 0.9] });
  });

  it('asks when the recorded twin has no answers of that kind', async () => {
    const { e, ui } = await engine();
    ui.picks = [1];
    ui.mapPicks = ['b'];
    e.random = () => 0.7;
    e.sessions.feedSession({ v: 1, start: { kind: 'new' }, base: e.state, log: [{ enter: 'a' }] });
    e.sessions.begin({ enter: 'a' });
    expect(await e.sessions.choose(opts)).toBe(1);
    expect(await e.sessions.pickPlace()).toBe('b');
    expect(e.sessions.rand()).toBe(0.7);
    expect(e.sessions.open[0]).toMatchObject({ pi: 0, mi: 0, ri: 0 });
  });
});

// 4.1.14 (ADR 0016): the session owns the run's seed, its logic stream and the run clock; its listeners hear entries.
describe('the session’s seed, stream, clock and listeners (4.1.14)', () => {
  const engine = () => new Engine(mini(), miniLayouts, new FakePresenter(), new MemoryStore());

  it('a draw before any session seeds the stream once and goes on along it', () => {
    const e = engine();
    expect(e.sessions.drawState()).toBeNull();
    e.sessions.nextSeed = 'early';
    const ref = derive('early', 'logic');
    expect([e.random(), e.random(), e.random()]).toEqual([ref.next(), ref.next(), ref.next()]);
    expect(e.sessions.drawState()).toMatchObject({ seed: 'early' });
  });

  it('a new game reseeds and resets the clock; a load keeps the stream and the clock', async () => {
    const e = engine();
    e.sessions.nextSeed = 'one';
    await e.newGame();
    expect(e.session?.seed).toBe('one');
    const ref = derive('one', 'logic');
    expect(e.random()).toBe(ref.next());
    await e.act({ verb: 'look', a: 'valise' });
    const steps = e.runClock.logicalSteps();
    const time = e.runClock.logicalTime();
    const draws = e.sessions.drawState();
    expect(time).toBeGreaterThan(0n);
    e.sessions.nextSeed = 'ignored-by-a-load';
    await e.load(structuredClone(e.state));
    expect(e.sessions.seed).toBe('one');
    expect(e.sessions.drawState()).toEqual(draws);
    expect(e.runClock.logicalSteps()).toBe(steps);
    expect(e.runClock.logicalTime()).toBe(time);
    e.sessions.nextSeed = 'two';
    await e.newGame();
    expect(e.sessions.seed).toBe('two');
    expect(e.session?.seed).toBe('two');
    expect(e.runClock.logicalSteps()).toBe(1n);
    expect(e.random()).toBe(derive('two', 'logic').next());
  });

  it('a first session that is a load takes nextSeed; a session nobody seeded writes no seed', async () => {
    const e = engine();
    e.sessions.nextSeed = 'loaded';
    await e.load(e.fresh());
    expect(e.session?.seed).toBe('loaded');
    expect(e.random()).toBe(derive('loaded', 'logic').next());
    const f = engine();
    await f.newGame();
    expect(f.session && 'seed' in f.session).toBe(false);
  });

  it('listeners hear each entry begin and end; an end with nothing open is ignored', async () => {
    const e = engine();
    const heard: string[] = [];
    e.sessions.listeners.add({
      begin: (x) => heard.push(`b:${Object.keys(x)[0]}`),
      end: (x) => heard.push(`e:${Object.keys(x)[0]}`),
    });
    await e.newGame();
    await e.act({ verb: 'look', a: 'valise' });
    expect(heard).toEqual(['b:start', 'e:start', 'b:act', 'e:act']);
    expect(() => e.sessions.end()).not.toThrow();
    expect(heard).toHaveLength(4);
  });
});
