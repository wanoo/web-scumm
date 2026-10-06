// The session recorder: entries, their clock and digest, and the answers fed back on replay (core/session-runtime.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { begin, choose, end, feedSession, newSession, pickPlace, rand, ran } from '@engine/core/session-runtime';
import { Engine } from '@engine/core/engine';
import { stateDigest } from '@engine/core/diff';
import { SESSION_MAX } from '@engine/core/engine-shared';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { Session, SessionEntry } from '@engine/core/types';
import { mini, miniLayouts } from './fixtures/mini';

const engine = async () => {
  const ui = new FakePresenter();
  const e = new Engine(mini(), miniLayouts, ui, new MemoryStore());
  await e.newGame();
  e.session = null;
  e.open = [];
  return { e, ui };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('newSession', () => {
  it('starts from a copy of the state, undated without a clock', async () => {
    const { e } = await engine();
    e.sessionT0 = 99;
    const s = newSession(e, { kind: 'checkpoint', id: 'cp' });
    expect(e.session).toBe(s);
    expect(s).toEqual({ v: 1, start: { kind: 'checkpoint', id: 'cp' }, base: e.state, log: [] });
    expect(s.base).not.toBe(e.state);
    expect('at' in s).toBe(false);
    expect(e.sessionT0).toBe(0);
  });
  it('is dated by the clock, and its clock origin set, with a clock', async () => {
    const { e } = await engine();
    vi.spyOn(Date, 'now').mockReturnValue(5000); // never read: the clock is the only time the engine knows (4.1.4)
    e.clock = () => 123;
    const s = newSession(e, { kind: 'new' });
    expect(s.at).toBe(123);
    expect(e.sessionT0).toBe(123);
  });
});

describe('begin and end', () => {
  it('opens a load session when there is none, and logs the entry', async () => {
    const { e } = await engine();
    const entry: SessionEntry = { enter: 'b' };
    begin(e, entry);
    expect(e.session?.start).toEqual({ kind: 'load' });
    expect(e.session?.log).toEqual([entry]);
    expect(e.session?.log[0]).toBe(entry);
    expect(e.open).toEqual([{ entry, src: undefined, pi: 0, mi: 0, ri: 0, steps: 0 }]);
    expect('t' in entry).toBe(false);
  });
  it('keeps the current session below its cap', async () => {
    const { e } = await engine();
    const s = newSession(e, { kind: 'new' });
    begin(e, { enter: 'a' });
    expect(e.session).toBe(s);
    expect(s.log).toHaveLength(1);
  });
  it('starts a new session at the cap, from the current state', async () => {
    const { e } = await engine();
    const s = newSession(e, { kind: 'new' });
    s.log = Array.from({ length: SESSION_MAX - 1 }, () => ({ enter: 'a' }));
    begin(e, { enter: 'b' });
    expect(e.session).toBe(s);
    expect(s.log).toHaveLength(SESSION_MAX);
    end(e);
    e.state.flags.late = true;
    const entry: SessionEntry = { enter: 'a' };
    begin(e, entry);
    expect(e.session).not.toBe(s);
    expect(e.session?.start).toEqual({ kind: 'load' });
    expect(e.session?.base.flags.late).toBe(true);
    expect(e.session?.log).toEqual([entry]);
  });
  it('never cuts a session inside an open entry', async () => {
    const { e } = await engine();
    const s = newSession(e, { kind: 'new' });
    s.log = Array.from({ length: SESSION_MAX }, () => ({ enter: 'a' }));
    e.open.push({ entry: { enter: 'a' }, pi: 0, mi: 0, ri: 0, steps: 0 });
    begin(e, { enter: 'b' });
    expect(e.session).toBe(s);
    expect(s.log).toHaveLength(SESSION_MAX + 1);
    expect(e.open).toHaveLength(2);
  });
  it('dates the entry from the session start with a clock', async () => {
    const { e } = await engine();
    let now = 1000;
    e.clock = () => now;
    newSession(e, { kind: 'new' });
    now = 1250.6;
    const entry: SessionEntry = { enter: 'a' };
    begin(e, entry);
    expect(entry.t).toBe(251);
  });
  it('takes the recorded twin of the entry from the feed', async () => {
    const { e } = await engine();
    const rec: SessionEntry[] = [{ enter: 'a', picks: [1] }, { enter: 'b' }];
    feedSession(e, { v: 1, start: { kind: 'new' }, base: e.state, log: rec } as Session);
    expect(e.feed).toEqual(rec);
    expect(e.feed).not.toBe(rec);
    begin(e, { enter: 'a' });
    expect(e.open[0]?.src).toBe(rec[0]);
    expect(e.feed).toEqual([rec[1]]);
    expect(rec).toHaveLength(2);
  });
  it('closes the entry, with its digest only when digests are on', async () => {
    const { e } = await engine();
    const a: SessionEntry = { enter: 'a' };
    begin(e, a);
    end(e);
    expect(e.open).toEqual([]);
    expect('digest' in a).toBe(false);
    e.digestOn = true;
    const b: SessionEntry = { enter: 'b' };
    begin(e, b);
    end(e);
    expect(b.digest).toBe(stateDigest(e.state));
    expect(() => end(e)).not.toThrow();
    expect(e.open).toEqual([]);
  });
});

describe('ran', () => {
  it('records what answered in the innermost open entry only', async () => {
    const { e } = await engine();
    ran(e, 'rule:x');
    expect(e.session).toBeNull();
    const outer: SessionEntry = { enter: 'a' };
    const inner: SessionEntry = { enter: 'b' };
    begin(e, outer);
    ran(e, 'rule:a');
    begin(e, inner);
    ran(e, 'rule:b');
    ran(e, 'rule:c');
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
    expect(await choose(e, opts, 'ann')).toBe(1);
    expect(ui.asked.at(-1)).toEqual({ n: 3, topic: true, texts: ['yes', 'no', 'bye'] });
    expect(await pickPlace(e)).toBe('b');
    expect(rand(e)).toBe(0.25);
    expect(await choose(e, opts)).toBe(2);
    expect(await choose(e, opts)).toBe(2);
    expect(await pickPlace(e)).toBeNull();
    expect(await pickPlace(e)).toBeNull();
    expect(e.session).toBeNull();
  });

  it('asks the presenter in a live entry, and records the answers', async () => {
    const { e, ui } = await engine();
    ui.picks = [0, 2];
    ui.mapPicks = ['a'];
    let r = 0;
    e.random = () => (r += 0.5);
    const entry: SessionEntry = { enter: 'a' };
    begin(e, entry);
    expect(await choose(e, opts)).toBe(0);
    expect(await choose(e, opts)).toBe(2);
    expect(ui.asked.at(-1)?.topic).toBe(false);
    expect(await pickPlace(e)).toBe('a');
    expect(await pickPlace(e)).toBeNull();
    expect(rand(e)).toBe(0.5);
    expect(rand(e)).toBe(1);
    expect(entry).toEqual({ enter: 'a', picks: [0, 2], maps: ['a', null], rnd: [0.5, 1] });
  });

  it('takes the recorded answers in order when replaying, then asks', async () => {
    const { e, ui } = await engine();
    ui.picks = [1];
    ui.mapPicks = ['b'];
    e.random = () => 0.9;
    feedSession(e, {
      v: 1,
      start: { kind: 'new' },
      base: e.state,
      log: [{ enter: 'a', picks: [2, 0], maps: [null, 'a'], rnd: [0.1, 0.2] }],
    });
    const entry: SessionEntry = { enter: 'a' };
    begin(e, entry);
    expect(await choose(e, opts)).toBe(2);
    expect(await choose(e, opts)).toBe(0);
    expect(await choose(e, opts)).toBe(1);
    expect(ui.asked).toHaveLength(1);
    expect(await pickPlace(e)).toBeNull();
    expect(await pickPlace(e)).toBe('a');
    expect(await pickPlace(e)).toBe('b');
    expect(rand(e)).toBe(0.1);
    expect(rand(e)).toBe(0.2);
    expect(rand(e)).toBe(0.9);
    expect(e.open[0]).toMatchObject({ pi: 2, mi: 2, ri: 2 });
    expect(entry).toEqual({ enter: 'a', picks: [2, 0, 1], maps: [null, 'a', 'b'], rnd: [0.1, 0.2, 0.9] });
  });

  it('asks when the recorded twin has no answers of that kind', async () => {
    const { e, ui } = await engine();
    ui.picks = [1];
    ui.mapPicks = ['b'];
    e.random = () => 0.7;
    feedSession(e, { v: 1, start: { kind: 'new' }, base: e.state, log: [{ enter: 'a' }] });
    begin(e, { enter: 'a' });
    expect(await choose(e, opts)).toBe(1);
    expect(await pickPlace(e)).toBe('b');
    expect(rand(e)).toBe(0.7);
    expect(e.open[0]).toMatchObject({ pi: 0, mi: 0, ri: 0 });
  });
});
