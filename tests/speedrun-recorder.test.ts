// The live recorder's own promises (4.1.17, the speedrun mutation set): the RTA it reads (its `now`, else the engine's
// run clock; 0 before the start; from the moment the start link is handed out), the pauses, menus and background the
// client declares (the first opening counts, a close without an opening is nothing, an interval still open at the
// finish is closed there), the finish (sealed by itself, never before), the start and finish triggers read from the
// journal, the world a run may start in, the Reality signals it keeps, why sealing failed, and what a resume after a
// crash restores or refuses. The fixture game is tests/fixtures/speedrun-game.ts; every time here is exact.
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { sha256Hex } from '@engine/core/fingerprint';
import { CHUNK_SIZE, MemoryChunkStore, type RunHead, type StoredChunk } from '@engine/core/journal-chunks';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { storyWorld } from '@engine/core/remix/story';
import type { ExternalEntry, SpeedrunCategory } from '@engine/core/types';
import {
  type RecorderOptions,
  type ResumePoint,
  RunStartRefused,
  SpeedrunRecorder,
} from '@engine/tools/speedrun/recorder';
import { ROUTE, speedrunGame, speedrunLayouts } from './fixtures/speedrun-game';
import { ENGINE_VERSION, fixtureFingerprint } from './fixtures/speedrun-run';

const game = speedrunGame();
const fingerprint = await fixtureFingerprint(game);
const any = game.speedrun!.categories.find((c) => c.id === 'any%')!;
const category = (patch: Partial<SpeedrunCategory>): SpeedrunCategory => ({ ...any, id: 'custom', ...patch });

/** A recorder on a fresh engine of the fixture game, timed by `clock.t` unless `now` is overridden. */
function recorder(patch: Partial<RecorderOptions> = {}) {
  const engine = new Engine(speedrunGame(), speedrunLayouts, new FakePresenter(), new MemoryStore());
  const clock = { t: 0 };
  const opts: RecorderOptions = {
    engine,
    gameId: game.id,
    manifest: game.speedrun!,
    category: any,
    store: new MemoryChunkStore(),
    fingerprint,
    engineVersion: ENGINE_VERSION,
    now: () => clock.t,
    ...patch,
  };
  return { engine, clock, rec: new SpeedrunRecorder(opts), opts };
}

const look = { verb: 'look', a: 'desk' } as const;
const takeKey = ROUTE[1];
const useKey = ROUTE[2];
const takeGem = ROUTE[3];

describe('RTA', () => {
  it('is 0 before the start, then counts from the moment the start link is handed out (the next entry)', async () => {
    const { engine, clock, rec } = recorder();
    clock.t = 5000;
    expect(rec.rtaMs()).toBe(0);
    await rec.start();
    // The new game's entry is handed out when the next one begins: the run has not started yet.
    expect(rec.rtaMs()).toBe(0);
    clock.t = 6000;
    await engine.act({ ...look });
    clock.t = 9000;
    expect(rec.rtaMs()).toBe(3000);
    // A split does not move the origin.
    clock.t = 10000;
    await engine.act({ ...takeKey });
    clock.t = 11000;
    await engine.act({ ...useKey });
    clock.t = 12000;
    await engine.act({ ...takeGem });
    expect(rec.rtaMs()).toBe(6000);
    const env = await rec.seal();
    expect(env.timing.rtaMs).toBe(6000);
    expect(env.splits.map((s) => [s.id, s.rtaMs])).toEqual([
      ['key', 5000],
      ['found', 5000],
      ['vault', 6000],
      ['end', 6000],
    ]);
  });

  it('reads the engine run clock without `now`, and only `now` when it is given', async () => {
    const bare = recorder({ now: undefined });
    let engineNow = 100;
    bare.engine.runClock.now = () => engineNow;
    await bare.rec.start();
    engineNow = 400;
    await bare.engine.act({ ...look });
    engineNow = 1150;
    expect(bare.rec.rtaMs()).toBe(750);

    const timed = recorder();
    timed.engine.runClock.now = () => 987654;
    await timed.rec.start();
    timed.clock.t = 1000;
    await timed.engine.act({ ...look });
    timed.clock.t = 3500;
    expect(timed.rec.rtaMs()).toBe(2500);
  });
});

describe('declared intervals', () => {
  it('keeps the first opening, ignores a close without one, and closes what is still open at the finish', async () => {
    const { engine, clock, rec } = recorder();
    await rec.start();
    clock.t = 1000;
    await engine.act({ ...look }); // the run starts at 1000
    clock.t = 2000;
    rec.interval('pause', true);
    clock.t = 3000;
    rec.interval('pause', true); // already open: the first opening stands
    clock.t = 4000;
    await engine.act({ ...takeKey });
    clock.t = 5000;
    rec.interval('pause', false);
    rec.interval('menu', false); // never opened: nothing
    clock.t = 6000;
    rec.interval('background', true);
    clock.t = 7000;
    await engine.act({ ...useKey });
    clock.t = 8000;
    await engine.act({ ...takeGem }); // the finish seals the run with the background still open
    const env = await rec.seal();
    expect(env.timing.excluded).toEqual([
      { kind: 'pause', entry: 3, atMs: 1000, durationMs: 3000 },
      { kind: 'background', entry: 5, atMs: 5000, durationMs: 2000 },
    ]);
  });
});

describe('the finish', () => {
  it('is not sealed before the finish: the stored run stays open', async () => {
    const { engine, rec, opts } = recorder({ runId: 'early' });
    await rec.start();
    await engine.act({ ...look });
    await expect(rec.seal()).rejects.toThrow('the run has not reached its finish');
    expect((await opts.store.head('early'))?.sealed).toBeUndefined();
  });

  it('seals the run by itself when the finish fires, once', async () => {
    const { engine, rec } = recorder();
    const sealed: unknown[] = [];
    rec.listeners.add((s) => {
      if (s.kind === 'sealed') sealed.push(s.envelope);
    });
    await rec.start();
    for (const a of ROUTE) await engine.act({ ...a });
    await expect.poll(() => rec.envelope).not.toBeNull();
    expect(rec.tracker.finish?.entry).toBe(4);
    expect(sealed).toEqual([rec.envelope]);
    expect(await rec.seal()).toBe(rec.envelope);
  });

  it('seals a run whose start and finish fire in the same entry', async () => {
    const cat = category({
      start: { event: 'itemAcquired', item: 'key' },
      finish: { event: 'flagChanged', flag: 'found' },
    });
    const { engine, rec } = recorder({ category: cat });
    await rec.start();
    await engine.act({ ...takeKey });
    await expect.poll(() => rec.envelope).not.toBeNull();
    expect(rec.tracker.finish?.entry).toBe(1);
  });

  it('does not hand a link out early for a finish trigger seen before the start', async () => {
    // `itemAcquired key` (a finish) comes before `found` (the start) in the same entry: not a finish yet, so the start
    // link is handed out when the next entry begins, which is when the RTA starts.
    const cat = category({ start: { event: 'flagChanged', flag: 'found' }, finish: { event: 'itemAcquired' } });
    const { engine, clock, rec } = recorder({ category: cat });
    await rec.start();
    clock.t = 1000;
    await engine.act({ ...takeKey });
    clock.t = 3000;
    await engine.act({ ...look });
    clock.t = 5000;
    expect(rec.rtaMs()).toBe(2000);
  });

  it('a finish trigger that met the start on one event hands out the next links as usual', async () => {
    // `itemAcquired key` is both the start and (any item) the finish: the tracker only starts there, the tape is
    // handed out at that entry's end, and the links after it again when the next entry begins.
    const cat = category({ start: { event: 'itemAcquired', item: 'key' }, finish: { event: 'itemAcquired' } });
    const { engine, clock, rec } = recorder({ category: cat });
    await rec.start();
    clock.t = 1000;
    await engine.act({ ...takeKey });
    clock.t = 2000;
    await engine.act({ ...useKey });
    clock.t = 3000;
    await engine.act({ ...look });
    expect(rec.tracker.splits.find((s) => s.id === 'vault')?.rtaMs).toBe(2000);
  });
});

describe('the world a run starts in', () => {
  it('a Daily category refuses a world of another mode, before anything is stored', async () => {
    const { rec, opts } = recorder({
      category: category({ world: { policy: 'daily', mode: 'daily' } }),
      worldEvidence: { kind: 'daily', token: 't' },
    });
    const refused = await rec.prepare().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RunStartRefused);
    expect((refused as RunStartRefused).reasons).toEqual(["the world's mode is story, the category's daily"]);
    expect(await opts.store.runs()).toEqual([]);
  });

  it('without an engine, the world must be given', async () => {
    const { rec } = recorder({ engine: null as never });
    await expect(rec.prepare()).rejects.toThrow(
      'a recorder without an engine is given the world of its run (`variant`)',
    );
  });

  it('records the story world and its policy, with no evidence when none was given', async () => {
    const { rec } = recorder();
    await rec.prepare();
    expect(rec.world).toStrictEqual({ variant: storyWorld(game.remix), policy: { policy: 'story', mode: 'story' } });
  });
});

describe('Reality signals', () => {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const entry = (id: string, sequence: number, extra: Partial<ExternalEntry> = {}): ExternalEntry => ({
    id,
    sequence,
    signal: 'mail.answer',
    source: 'mail',
    receivedAt: 1_000 + sequence,
    ...extra,
  });

  it("keeps each signal's JWS, its hash, its key id when the header names one, and whether it was skipped", async () => {
    const { engine, rec } = recorder();
    await rec.start();
    const withKid = `${enc({ alg: 'EdDSA', kid: 'k1' })}.${enc({ a: 1 })}.sig`;
    const withoutKid = `${enc({ alg: 'EdDSA' })}.${enc({ a: 2 })}.sig`;
    rec.realitySignal(withKid, entry('s1', 1));
    rec.realitySignal(withoutKid, entry('s2', 2, { skipped: 'expired' }));
    for (const a of ROUTE) await engine.act({ ...a });
    const env = await rec.seal();
    expect(env.realitySignals).toStrictEqual([
      {
        id: 's1',
        sequence: 1,
        signal: 'mail.answer',
        source: 'mail',
        receivedAt: 1001,
        jws: withKid,
        kid: 'k1',
        hash: await sha256Hex(withKid),
        verdict: 'ok',
      },
      {
        id: 's2',
        sequence: 2,
        signal: 'mail.answer',
        source: 'mail',
        receivedAt: 1002,
        jws: withoutKid,
        hash: await sha256Hex(withoutKid),
        verdict: 'skipped',
      },
    ]);
  });
});

describe('why sealing failed', () => {
  it('keeps the store’s own error when the last chunk is refused', async () => {
    const refusal = new Error('quota exceeded');
    class Refusing extends MemoryChunkStore {
      override async putChunk(chunk: StoredChunk, head: RunHead): Promise<void> {
        if (head.sealed) throw refusal;
        return super.putChunk(chunk, head);
      }
    }
    const { engine, rec } = recorder({ store: new Refusing() });
    await rec.start();
    for (const a of ROUTE) await engine.act({ ...a });
    await expect.poll(() => rec.failure).toBe(refusal);
  });

  it('makes an Error of a failure that is not one', async () => {
    let sealedOnce = false;
    class Lost extends MemoryChunkStore {
      override async putChunk(chunk: StoredChunk, head: RunHead): Promise<void> {
        if (head.sealed) sealedOnce = true;
        return super.putChunk(chunk, head);
      }
      override async chunks(runId: string): Promise<StoredChunk[]> {
        if (sealedOnce) throw 'disk gone';
        return super.chunks(runId);
      }
    }
    const { engine, rec } = recorder({ store: new Lost() });
    await rec.start();
    for (const a of ROUTE) await engine.act({ ...a });
    await expect.poll(() => rec.failure).not.toBeNull();
    expect(rec.failure).toBeInstanceOf(Error);
    expect(rec.failure!.message).toBe('disk gone');
  });
});

describe('resume', () => {
  /** A run of CHUNK_SIZE + 5 looks, 10 ms apart: one stored chunk, its head's resume point. */
  async function storedRun(cat: SpeedrunCategory) {
    const { engine, clock, rec, opts } = recorder({ category: cat, runId: 'r' });
    await rec.start();
    for (let i = 0; i < CHUNK_SIZE + 5; i++) {
      clock.t += 10;
      await engine.act({ ...look });
    }
    await rec.flushed();
    return { head: (await opts.store.head('r'))!, chunks: await opts.store.chunks('r') };
  }
  let stored: Awaited<ReturnType<typeof storedRun>>;
  beforeAll(async () => {
    stored = await storedRun(any);
  }, 60000);

  /** A copy of the stored run, its head edited. */
  async function store(edit: (head: RunHead & { resume: ResumePoint }) => void = () => {}) {
    const s = new MemoryChunkStore();
    const head = structuredClone(stored.head) as RunHead & { resume: ResumePoint };
    edit(head);
    for (const c of stored.chunks) await s.putChunk(c, head);
    await s.putHead(head);
    return s;
  }
  const resume = async (s: MemoryChunkStore, patch: Partial<RecorderOptions> = {}) => {
    const r = recorder({ store: s, runId: 'r', ...patch });
    return { ...r, again: await SpeedrunRecorder.resume({ ...r.opts, runId: 'r' }) };
  };
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => (e instanceof RunStartRefused ? e.reasons : e),
    );

  it('restores the RTA from the stored point and the draws, and records the loads the player makes after', async () => {
    const point = stored.head.resume as ResumePoint;
    expect(point.rtaMs).toBe(4990);
    const { engine, clock, again } = await resume(await store(), {});
    expect(again).not.toBeNull();
    // The RTA goes on from the stored point: the time the page was closed is not counted.
    expect(again!.rtaMs()).toBe(4990);
    clock.t = 250;
    expect(again!.rtaMs()).toBe(5240);
    expect(engine.sessions.drawState()).toEqual(point.draws);
    await engine.act({ ...look }); // entry CHUNK_SIZE
    const saved = structuredClone(engine.state);
    await engine.act({ ...look });
    await engine.load(structuredClone(saved));
    for (const a of ROUTE) await engine.act({ ...a });
    const env = await again!.seal();
    expect(env.loads).toEqual([
      { before: CHUNK_SIZE, from: CHUNK_SIZE - 1, resume: true },
      { before: CHUNK_SIZE + 2, from: CHUNK_SIZE },
    ]);
  });

  it('resumes a point stored before any draw', async () => {
    const { again } = await resume(await store((h) => (h.resume.draws = null)));
    expect(again).not.toBeNull();
  });

  it('refuses a head that counts more chunks than the store holds (its point is not theirs)', async () => {
    const { again } = await resume(await store((h) => (h.chunks += 1)));
    expect(again).toBeNull();
  });

  it('never resumes a sealed run, even from a store that kept its last point', async () => {
    const { again } = await resume(await store((h) => (h.sealed = 'abandoned')));
    expect(again).toBeNull();
  });

  it('refuses a point with no world, and a category that no longer plays the run’s world', async () => {
    const s = await store((h) => delete (h.resume as Partial<ResumePoint>).world);
    const r1 = recorder({ store: s, runId: 'r' });
    expect(await refusal(SpeedrunRecorder.resume({ ...r1.opts, runId: 'r' }))).toEqual([
      'this stored run predates the world binding (4.1.16): start again',
    ]);
    const r2 = recorder({
      store: await store(),
      runId: 'r',
      category: category({ id: 'any%', world: { policy: 'daily', mode: 'daily' } }),
    });
    expect(await refusal(SpeedrunRecorder.resume({ ...r2.opts, runId: 'r' }))).toEqual([
      "this run's category no longer plays the world it was started in",
    ]);
  });

  it('keeps the proof sealed in its head: another is refused, a Mystery dated anew by the page is the same', async () => {
    const mystery = { kind: 'mystery', commitmentToken: 'c', revealToken: 'r', startedAt: 1000 } as const;
    const sealed = await store((h) => (h.resume.world = { ...h.resume.world!, evidence: mystery }));
    const later = await resume(sealed, { worldEvidence: { ...mystery, startedAt: 9000 } });
    expect(later.again!.world!.evidence).toEqual(mystery);
    // Nothing given: the sealed proof, unchecked against nothing.
    expect(
      (await resume(await store((h) => (h.resume.world = { ...h.resume.world!, evidence: mystery })))).again,
    ).not.toBeNull();
    const another = ['this run rests on another proof of its world than the one given now'];
    for (const given of [
      { ...mystery, revealToken: 'other' },
      { kind: 'daily', token: 'c' },
    ] as const) {
      const r = recorder({
        store: await store((h) => (h.resume.world = { ...h.resume.world!, evidence: mystery })),
        runId: 'r',
        worldEvidence: given,
      });
      expect(await refusal(SpeedrunRecorder.resume({ ...r.opts, runId: 'r' }))).toEqual(another);
    }
    // A run sealed without a proof, given one: refused too.
    const bare = recorder({ store: await store(), runId: 'r', worldEvidence: { kind: 'daily', token: 't' } });
    expect(await refusal(SpeedrunRecorder.resume({ ...bare.opts, runId: 'r' }))).toEqual(another);
  });

  it('ignores the start trigger while resuming: a finish trigger before the real start hands nothing out early', async () => {
    const cat = category({ start: { event: 'flagChanged', flag: 'found' }, finish: { event: 'itemAcquired' } });
    const run = await storedRun(cat);
    const s = new MemoryChunkStore();
    for (const c of run.chunks) await s.putChunk(c, run.head);
    const { engine, clock, again } = await resume(s, { category: cat });
    clock.t = 1000;
    await engine.act({ ...takeKey }); // the key (a finish) before `found` (the start)
    clock.t = 3000;
    await engine.act({ ...look });
    clock.t = 5000;
    expect(again!.rtaMs()).toBe(2000);
  }, 60000);
});
