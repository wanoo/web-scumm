// Replay of a session on a silent engine, its divergences, entry labels, device families and session files (tools/replay.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { GameDef, Layout, SessionEntry } from '@engine/core/types';
import { deviceFamily, labelOf, parseSessionFile, replay, sessionFile } from '@engine/tools/replay';
import { scale, scaleLayouts } from './fixtures/scale';

/** scale, with a map, a second player and a global script: every kind of entry can be recorded. */
const game = (): GameDef => {
  const g = scale();
  g.characters.bea = { name: 'Bea', color: '#ff0', sprites: { idle: ['p/1'] } };
  g.players = { ids: ['hero', 'bea'], start: { bea: { room: 'cellar' } } };
  g.map = {
    regions: { r: { name: 'R', image: 'm/r' } },
    start: 'r',
    places: {
      yard: { name: 'The yard', room: 'yard', region: 'r', pos: [1, 1] },
      cellar: { name: 'The cellar', room: 'cellar', region: 'r', pos: [2, 2] },
    },
  };
  g.scripts = [{ id: 'tick', do: [{ inc: 'ticks' }, { inc: 'ticks' }], stepIds: ['tick.a', 'tick.b'] }];
  return g;
};
const layouts: Record<string, Layout> = scaleLayouts;

/** A recorded session: take the key, open the map on the yard, travel, switch, step, script, teleport. */
async function record() {
  const ui = new FakePresenter();
  const e = new Engine(game(), layouts, ui, new MemoryStore());
  e.digestOn = true;
  await e.newGame();
  await e.act({ verb: 'take', a: 'mat' });
  await e.script([{ unlock: 'yard' }, { unlock: 'cellar' }]);
  ui.mapPicks = ['yard'];
  await e.openMap();
  await e.travel('cellar');
  await e.switchTo('bea');
  await e.switchTo('hero');
  await e.advance('tick');
  await e.teleport('attic');
  return { e, log: structuredClone(e.session!.log) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('replay', () => {
  it('plays a recorded new game again, entry by entry, to the same state', async () => {
    const { e, log } = await record();
    expect(log.map((x) => Object.keys(x)[0])).toEqual([
      'start',
      'act',
      'script',
      'map',
      'travel',
      'switch',
      'switch',
      'step',
      'enter',
    ]);
    const seen: number[] = [];
    const r = await replay(game(), layouts, { start: { kind: 'new' }, log }, { onEntry: (i) => seen.push(i) });
    expect(r.divergedAt).toBeUndefined();
    expect(r.divergence).toBeUndefined();
    expect('divergedAt' in r).toBe(false);
    expect(r.first).toBe(1);
    expect(r.played).toBe(8);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect({ ...r.state, started: 0 }).toEqual({ ...e.state, started: 0 });
    expect(r.ended).toBe(false);
    expect(r.session.log.map((x) => x.digest)).toEqual(log.map((x) => x.digest));
    expect(r.trace.length).toBeGreaterThan(0);
  });

  it('plays only the first upTo entries', async () => {
    const { log } = await record();
    const r = await replay(game(), layouts, { start: { kind: 'new' }, log }, { upTo: 3 });
    expect(r.played).toBe(2);
    expect(r.state.room).toBe('hall');
    expect(r.state.inventory).toEqual(['key']);
    expect(r.state.unlocked).toEqual(['yard', 'cellar']);
  });

  it('plays a new game whose log has no start entry from its first entry', async () => {
    const r = await replay(game(), layouts, { start: { kind: 'new' }, log: [{ act: { verb: 'take', a: 'mat' } }] });
    expect(r.first).toBe(0);
    expect(r.played).toBe(1);
    expect(r.state.inventory).toEqual(['key']);
  });

  it('says the ending was reached', async () => {
    const log: SessionEntry[] = [
      { start: 'new' },
      { enter: 'attic' },
      { script: [{ gain: 'gem' }] },
      { act: { verb: 'use', a: 'gem', b: 'chest' } },
    ];
    const r = await replay(game(), layouts, { start: { kind: 'new' }, log });
    expect(r.divergedAt).toBeUndefined();
    expect(r.ended).toBe(true);
    expect(r.state.done).toBe(true);
  });

  it('starts from a checkpoint', async () => {
    const r = await replay(game(), layouts, {
      start: { kind: 'checkpoint', id: 'yard' },
      log: [{ act: { verb: 'use', a: 'well' } }],
    });
    expect(r.first).toBe(0);
    expect(r.session.start).toEqual({ kind: 'checkpoint', id: 'yard' });
    expect(r.state.room).toBe('attic');
    expect(r.state.inventory).toEqual(['key', 'gem']);
  });

  it('starts from a save, and needs its base state', async () => {
    const { e } = await record();
    const base = structuredClone(e.state);
    const r = await replay(game(), layouts, {
      start: { kind: 'load' },
      base,
      v: 3,
      log: [{ enter: 'hall' }],
    });
    expect(r.state.room).toBe('hall');
    expect(r.state.unlocked).toEqual(['yard', 'cellar']);
    expect(base.room).toBe('attic');
    await expect(replay(game(), layouts, { start: { kind: 'load' }, log: [] })).rejects.toThrow(
      /^a session that starts from a save needs its base state$/,
    );
  });

  it('stops where nothing happened', async () => {
    const r = await replay(game(), layouts, {
      start: { kind: 'new' },
      log: [{ start: 'new' }, { act: { verb: 'take', a: 'mat' } }, { travel: 'yard' }, { enter: 'attic' }],
    });
    expect(r.divergedAt).toBe(2);
    expect(r.divergence).toBe('Map → The yard: nothing happened');
    expect(r.played).toBe(2);
    expect(r.state.room).toBe('hall');
  });

  it('stops at a second start entry: a new game cannot happen mid-session', async () => {
    const r = await replay(game(), layouts, { start: { kind: 'new' }, log: [{ start: 'new' }, { start: 'new' }] });
    expect(r.divergedAt).toBe(1);
    expect(r.divergence).toBe('New game: nothing happened');
  });

  it('stops where the state differs from the recorded digest', async () => {
    const { log } = await record();
    log[2]!.digest = '00000000';
    const r = await replay(game(), layouts, { start: { kind: 'new' }, log });
    expect(r.divergedAt).toBe(2);
    expect(r.divergence).toBe('Run 2 commands: the state differs from the recording');
    expect(r.played).toBe(2);
  });

  it('ignores a digest on one side only', async () => {
    const { log } = await record();
    for (const x of log) delete x.digest;
    const r = await replay(game(), layouts, { start: { kind: 'new' }, log });
    expect(r.divergedAt).toBeUndefined();
    expect(r.played).toBe(8);
  });

  it('stops where an action ran but the recording says it was interrupted, and the reverse', async () => {
    // With no start entry, the new game takes the first recorded entry as its own: every input reads the next one.
    const ran = await replay(game(), layouts, {
      start: { kind: 'new' },
      log: [{ act: { verb: 'look', a: 'mat' } }, { act: { verb: 'take', a: 'mat' }, aborted: true }],
    });
    expect(ran.divergedAt).toBe(0);
    expect(ran.divergence).toBe('Look mat: ran in the recording');
    const cut = await replay(game(), layouts, {
      start: { kind: 'new' },
      log: [{ act: { verb: 'look', a: 'mat' }, aborted: true }, { act: { verb: 'take', a: 'mat' } }],
    });
    expect(cut.divergedAt).toBe(0);
    expect(cut.divergence).toBe('Look mat (interrupted): was interrupted in the recording');
  });

  it('replays an interrupted action as interrupted', async () => {
    const r = await replay(game(), layouts, {
      start: { kind: 'new' },
      log: [{ start: 'new' }, { act: { verb: 'take', a: 'mat' }, aborted: true }],
    });
    expect(r.divergedAt).toBeUndefined();
    expect(r.state.inventory).toEqual([]);
    expect(r.session.log[1]).toMatchObject({ aborted: true });
  });

  it('never touches the game it is given', async () => {
    const g = game();
    const before = structuredClone(g);
    await replay(g, layouts, { start: { kind: 'new' }, log: [{ start: 'new' }, { act: { verb: 'take', a: 'mat' } }] });
    expect(g).toEqual(before);
  });

  it('waits for an intro paused on a tutorial step, the next input being that step', async () => {
    const g = game();
    g.start.intro = [{ guide: { verb: 'take', target: 'mat', say: 'Take the mat.' } }, { set: 'intro_done' }];
    const r = await replay(g, layouts, {
      start: { kind: 'new' },
      log: [{ start: 'new' }, { act: { verb: 'take', a: 'mat' } }],
    });
    expect(r.divergedAt).toBeUndefined();
    expect(r.played).toBe(1);
    expect(r.state.inventory).toEqual(['key']);
    expect(r.state.flags.intro_done).toBe(true);
  });

  it('goes on after an input that throws, as the game did', async () => {
    const r = await replay(game(), layouts, {
      start: { kind: 'new' },
      log: [{ start: 'new' }, { enter: 'nowhere' }, { act: { verb: 'take', a: 'mat' } }],
    });
    expect(r.divergedAt).toBeUndefined();
    expect(r.played).toBe(2);
    expect(r.session.log[1]).toMatchObject({ enter: 'nowhere' });
    expect(r.state.room).toBe('hall');
    expect(r.state.inventory).toEqual(['key']);
  });

  it('gives up on an input that never yields control back', async () => {
    // A presenter whose choice never answers: the replay must not hang on it.
    vi.spyOn(FakePresenter.prototype, 'choose').mockReturnValue(new Promise<number>(() => {}));
    await expect(
      replay(game(), layouts, {
        start: { kind: 'new' },
        log: [{ start: 'new' }, { script: [{ choice: [{ text: 'a', do: [] }] }] }],
      }),
    ).rejects.toThrow(/^the engine never yields control back \(stuck choice\?\)$/);
  }, 30_000); // 500 ticks of the guard: a few hundred ms here, seconds on the Windows runner
});

describe('labelOf', () => {
  const g = game();
  it('names an action with the verb label, its join, picks and interruption', () => {
    expect(labelOf(g, { act: { verb: 'look', a: 'mat' } })).toBe('Look mat');
    expect(labelOf(g, { act: { verb: 'use', a: 'key', b: 'door' } })).toBe('Use key with door');
    expect(labelOf(g, { act: { verb: 'look', a: 'key', b: 'door' } })).toBe('Look key → door');
    expect(labelOf(g, { act: { verb: 'kick', a: 'mat' } })).toBe('kick mat');
    expect(labelOf(g, { act: { verb: 'kick', a: 'mat', b: 'door' } })).toBe('kick mat → door');
    expect(labelOf(g, { act: { verb: 'look', a: 'mat' }, picks: [1, 0] })).toBe('Look mat [1,0]');
    expect(labelOf(g, { act: { verb: 'look', a: 'mat' }, picks: [] })).toBe('Look mat');
    expect(labelOf(g, { act: { verb: 'look', a: 'mat' }, picks: [2], aborted: true })).toBe(
      'Look mat [2] (interrupted)',
    );
  });
  it('names travels and the map by place name, or id', () => {
    expect(labelOf(g, { travel: 'yard' })).toBe('Map → The yard');
    expect(labelOf(g, { travel: 'moon' })).toBe('Map → moon');
    expect(labelOf(scale(), { travel: 'yard' })).toBe('Map → yard');
    expect(labelOf(g, { map: true, maps: ['cellar'] })).toBe('Map → The cellar');
    expect(labelOf(g, { map: true, maps: ['moon'] })).toBe('Map → moon');
    expect(labelOf(scale(), { map: true, maps: ['moon'] })).toBe('Map → moon');
    expect(labelOf(g, { map: true, maps: [null] })).toBe('Map (closed)');
    expect(labelOf(g, { map: true })).toBe('Map (closed)');
  });
  it('names switches, steps, scripts, teleports and the new game', () => {
    expect(labelOf(g, { switch: 'bea' })).toBe('Switch to bea');
    expect(labelOf(g, { step: 'tick' })).toBe('Script tick');
    expect(labelOf(g, { script: [{ set: 'a' }] })).toBe('Run 1 command');
    expect(labelOf(g, { script: [{ set: 'a' }, { set: 'b' }] })).toBe('Run 2 commands');
    expect(labelOf(g, { script: [] })).toBe('Run 0 command');
    expect(labelOf(g, { enter: 'attic' })).toBe('Go to attic');
    expect(labelOf(g, { start: 'new' })).toBe('New game');
    expect(labelOf(g, { start: 'new', picks: [] })).toBe('New game');
    expect(labelOf(g, { start: 'new', picks: [2, 1] })).toBe('New game [2,1]');
  });
});

describe('deviceFamily', () => {
  it('tells iOS, Android and desktop apart, an iPad posing as a Mac by its touch points', () => {
    expect(deviceFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('ios');
    expect(deviceFamily('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('ios');
    expect(deviceFamily('Mozilla/5.0 (iPod touch)')).toBe('ios');
    expect(deviceFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)).toBe('ios');
    expect(deviceFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 2)).toBe('ios');
    expect(deviceFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 1)).toBe('desktop');
    expect(deviceFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('desktop');
    expect(deviceFamily('Mozilla/5.0 (Linux; Android 14)', 5)).toBe('android');
    expect(deviceFamily('Mozilla/5.0 (Windows NT 10.0)', 10)).toBe('desktop');
  });
});

describe('sessionFile', () => {
  it('needs a session', () => {
    const e = new Engine(game(), layouts, new FakePresenter(), new MemoryStore());
    expect(() => sessionFile('scale', e)).toThrow(/^no session yet: start or load a game first$/);
  });
  it('writes the session, the journal, the version and the time', async () => {
    const { e } = await record();
    e.traceOn = true;
    e.trace.push({ kind: 'action', text: 'x' } as unknown as (typeof e.trace)[number]);
    vi.spyOn(Date, 'now').mockReturnValue(777);
    const f = sessionFile('scale', e);
    expect(f).toEqual({ kind: 'web-scumm-session', game: 'scale', v: 3, at: 777, session: e.session, trace: e.trace });
    expect(f.session).not.toBe(e.session);
    expect(f.trace).not.toBe(e.trace);
    expect((f.session.log[2] as { script: unknown[] }).script).toHaveLength(2);
  });
  it('dates the file by its session when it has a date', async () => {
    const { e } = await record();
    e.session!.at = 4242;
    expect(sessionFile('scale', e).at).toBe(4242);
  });
  it('strips a playtest of its journal and dev scripts, keeps device and misses when given', async () => {
    const { e } = await record();
    e.trace.push({ kind: 'action', text: 'x' } as unknown as (typeof e.trace)[number]);
    const misses = { 'hall/mat': 2 };
    const f = sessionFile('scale', e, { playtest: true, device: 'android', misses });
    expect(f.trace).toEqual([]);
    expect(f.session.log[2]).toMatchObject({ script: [] });
    expect((e.session!.log[2] as { script: unknown[] }).script).toHaveLength(2);
    expect(f.session.log[1]).toEqual(e.session!.log[1]);
    expect(f.device).toBe('android');
    expect(f.misses).toEqual(misses);
    expect(f.misses).not.toBe(misses);
    const bare = sessionFile('scale', e, { misses: {} });
    expect('misses' in bare).toBe(false);
    expect('device' in bare).toBe(false);
  });
});

describe('parseSessionFile', () => {
  const session = { v: 2, start: { kind: 'new' }, base: null, log: [{ start: 'new' }] };
  it('reads a full file back', () => {
    const file = {
      kind: 'web-scumm-session',
      game: 'scale',
      v: 3,
      at: 10,
      session,
      trace: [{ kind: 'action' }],
      device: 'ios',
      misses: { 'hall/mat': 2, 'yard/well-2': 1 },
    };
    expect(parseSessionFile(JSON.stringify(file))).toEqual(file);
  });
  it('reads a bare session with defaults', () => {
    expect(parseSessionFile(JSON.stringify(session))).toEqual({
      kind: 'web-scumm-session',
      game: '',
      v: 2,
      at: 0,
      session,
      trace: [],
    });
  });
  it('rejects what is not a session', () => {
    for (const bad of [{}, { log: 'x', start: { kind: 'new' } }, { log: [] }, { log: [], start: {} }, { session: {} }])
      expect(() => parseSessionFile(JSON.stringify(bad))).toThrow(/^not a session file$/);
    expect(() => parseSessionFile('{')).toThrow(SyntaxError);
  });
  it('keeps a known device family only', () => {
    for (const device of ['ios', 'android', 'desktop'])
      expect(parseSessionFile(JSON.stringify({ session, device })).device).toBe(device);
    expect('device' in parseSessionFile(JSON.stringify({ session, device: 'iPhone 15' }))).toBe(false);
  });
  it('keeps only well-formed misses', () => {
    const misses = { 'hall/mat': 3, 'hall/': 1, 'a b/c': 1, 'x/y': 0, 'x/z': -1, 'x/w': 1.5, 'x/v': '2', 'a/b/c': 1 };
    expect(parseSessionFile(JSON.stringify({ session, misses })).misses).toEqual({ 'hall/mat': 3 });
    expect('misses' in parseSessionFile(JSON.stringify({ session, misses: { 'x/y': 0 } }))).toBe(false);
    expect('misses' in parseSessionFile(JSON.stringify({ session, misses: 5 }))).toBe(false);
    expect('misses' in parseSessionFile(JSON.stringify({ session, misses: null }))).toBe(false);
  });
});
