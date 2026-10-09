// The speedrun queue's own rules (4.1.17, the `runs` mutation set): what a submission must be before it is admitted,
// how a run is recognised as the same run, the queue's room, its lease bound, its timers, a Daily run sent late, and
// what anyone may read of a run. Each case is one the mutation run left alive; the worker is the protocol's stand-in
// (tests/fixtures/runs-stub-worker.mjs), the store the memory one.
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRunStore, RunQueue } from '../bridge/src/runs';

const WORKER = [process.execPath, resolve('tests/fixtures/runs-stub-worker.mjs')];
const approved = {
  reference: {
    dir: resolve('games/reference'),
    fingerprint: { logic: '', trustedExtensions: '', presentation: '', engine: '' },
  },
};
const queues: RunQueue[] = [];
afterEach(() => {
  for (const q of queues.splice(0)) q.close();
  vi.useRealTimers();
});
const queue = (o: Partial<ConstructorParameters<typeof RunQueue>[0]> = {}) => {
  const q = new RunQueue({
    store: new MemoryRunStore(),
    approved,
    worker: WORKER,
    purgeEveryMs: 0,
    pollMs: 0,
    perMinute: 1000,
    log: () => {},
    audit: () => {},
    ...o,
  });
  queues.push(q);
  return q;
};
const envelope = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'web-scumm-speedrun',
    schema: 2,
    gameId: 'reference',
    categoryId: 'any%',
    runSeed: 'seed-1',
    timing: { logicalTime: '1000' },
    chunks: [{ entries: [{ start: 'new' }, { act: { verb: 'look', a: 'door' }, t: 5 }] }],
    ...o,
  });
const submit = (q: RunQueue, env: string, tenant = 't') =>
  q.submit(tenant, { player: 'Lou', envelope: env }).then(
    (r) => ({ ok: true as const, ...r }),
    (e: { status: number; code: string; retryAfterS?: number }) => ({
      ok: false as const,
      status: e.status,
      code: e.code,
      retryAfterS: e.retryAfterS,
    }),
  );

describe('a submission', () => {
  it('is a JSON speedrun envelope with a game and a category id, of an approved game', async () => {
    const q = queue();
    const refused = async (env: string) => (await submit(q, env)) as { status: number; code: string };
    for (const bad of [
      'null',
      '1',
      '"x"',
      envelope({ format: 'other' }),
      envelope({ gameId: 1 }),
      envelope({ categoryId: 2 }),
    ])
      expect(await refused(bad), bad.slice(0, 40)).toMatchObject({ status: 400, code: 'envelope' });
    expect(await refused(envelope({ categoryId: 'any% 1' }))).toMatchObject({ status: 400, code: 'envelope' });
    expect(await refused(envelope({ gameId: 'demo' }))).toMatchObject({ status: 404, code: 'game' });
    expect(await refused(envelope({ gameId: '__proto__' }))).toMatchObject({ status: 404, code: 'game' });
    expect((await submit(q, envelope())).ok).toBe(true);
  });

  it('is at most maxBytes: that many is taken, one more is refused', async () => {
    const env = envelope();
    const q = queue({ maxBytes: Buffer.byteLength(env) });
    expect((await submit(q, env)).ok).toBe(true);
    expect(await submit(q, envelope({ pad: 'x' }))).toMatchObject({ ok: false, status: 413 });
  });

  it("is a tenant's own when the queue serves one", async () => {
    const q = queue({ tenant: 't' });
    expect((await submit(q, envelope(), 't')).ok).toBe(true);
    expect(await submit(q, envelope({ runSeed: 's2' }), 'u')).toMatchObject({ status: 404, code: 'tenant' });
  });

  it('finds no room in a full queue: 429, retry in a minute', async () => {
    const q = queue({ maxQueued: 1 });
    expect((await submit(q, envelope({ stub: { sleepMs: 2000 } }))).ok).toBe(true);
    expect(await submit(q, envelope({ runSeed: 's2' }))).toMatchObject({
      ok: false,
      status: 429,
      code: 'busy',
      retryAfterS: 60,
    });
    await q.idle();
  });
});

describe('the same run', () => {
  const twice = async (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const q = queue();
    await submit(q, envelope(a));
    return (await submit(q, envelope(b))) as { ok: boolean; code?: string };
  };
  it('is recognised whatever the order of its keys and its RTA stamps', async () => {
    const entries = (t: number, flip: boolean) => [
      flip ? { t, act: { a: 'door', verb: 'look' } } : { act: { verb: 'look', a: 'door' }, t },
    ];
    expect(
      await twice({ chunks: [{ entries: entries(1, false) }] }, { chunks: [{ entries: entries(9, true) }] }),
    ).toMatchObject({
      ok: false,
      code: 'duplicate',
    });
  });

  it('is not another run: other inputs, an array that is not an object, a number that is not another', async () => {
    expect(
      (await twice({ chunks: [{ entries: [{ picks: [1, 2] }] }] }, { chunks: [{ entries: [{ picks: [2, 1] }] }] })).ok,
    ).toBe(true);
    expect(
      (await twice({ chunks: [{ entries: [{ picks: [1] }] }] }, { chunks: [{ entries: [{ picks: { 0: 1 } }] }] })).ok,
    ).toBe(true);
    expect((await twice({ chunks: [{ entries: [1] }] }, { chunks: [{ entries: [2] }] })).ok).toBe(true);
    expect((await twice({ chunks: [{ entries: [{ a: 1 }] }] }, { chunks: [{ entries: [{ a: 2 }] }] })).ok).toBe(true);
    expect(
      (
        await twice(
          { chunks: [{ entries: [{ a: 1 }] }, { entries: [{ a: 3 }] }] },
          { chunks: [{ entries: [{ a: 1 }] }, { entries: [{ a: 4 }] }] },
        )
      ).ok,
    ).toBe(true);
  });

  it('is read from any shape without a crash: chunks or entries that are not lists, null entries', async () => {
    const q = queue();
    for (const chunks of ['x', [{ entries: 'y' }], [null], [{ entries: [null, 1, 'a'] }]])
      expect((await submit(q, envelope({ chunks, runSeed: JSON.stringify(chunks) }))).ok, JSON.stringify(chunks)).toBe(
        true,
      );
  });
});

describe('the queue', () => {
  it('refuses a lease shorter than the worker budget plus ten seconds, and says both', () => {
    expect(() => queue({ timeoutMs: 1000, leaseMs: 10_999 })).toThrow(
      'runs: leaseMs (10999) is at least timeoutMs + 10 s (11000)',
    );
    expect(() => queue({ timeoutMs: 1000, leaseMs: 11_000 })).not.toThrow();
    expect(() => queue({ timeoutMs: 1000 })).not.toThrow();
  });

  it('runs no purge and no poll when they are switched off (0), and runs them when asked', async () => {
    vi.useFakeTimers();
    const store = new MemoryRunStore();
    const purge = vi.spyOn(store, 'purge');
    const claim = vi.spyOn(store, 'claimNext');
    queue({ store, purgeEveryMs: 0, pollMs: 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(purge).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    queue({ store, purgeEveryMs: 1000, pollMs: 1000 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(purge).toHaveBeenCalled();
    expect(claim).toHaveBeenCalled();
  });

  it('puts a Daily run sent after its day on no board, says so, and keeps its verdict', async () => {
    let now = 5000;
    const q = queue({ now: () => now });
    const late = (await submit(q, envelope({ stub: { validUntil: 4000 } }))) as { id: string };
    const onTime = (await submit(q, envelope({ runSeed: 's2', stub: { validUntil: 5000 } }))) as { id: string };
    now = 6000;
    await q.idle();
    const a = (await q.o.store.get('t', late.id))!;
    expect(a).toMatchObject({ verdict: 'valid', ranked: null });
    expect(a.reason).toContain('sent after its day');
    expect((await q.o.store.get('t', onTime.id))!.ranked).toBe('1000');
  });

  it('says a run unknown to the store when asked to delete or moderate it', async () => {
    const q = queue();
    await expect(q.remove('t', 'run_none', 'x')).rejects.toMatchObject({ status: 404 });
    await expect(q.moderate('t', 'run_none')).rejects.toMatchObject({ status: 404 });
  });
});

describe('the queue at work', () => {
  it('runs as many workers as it is told, never one more', async () => {
    const q = queue({ workers: 1 });
    await submit(q, envelope({ runSeed: 'w1', stub: { sleepMs: 400 } }));
    await submit(q, envelope({ runSeed: 'w2', stub: { sleepMs: 400 } }));
    const t0 = Date.now();
    await q.idle();
    // One worker: one run after the other (two in parallel would end in about 400 ms).
    expect(Date.now() - t0).toBeGreaterThanOrEqual(750);
  });

  it('says a verification that threw: the run is inconclusive, the queue goes on', async () => {
    // A run waiting in the store for a game this instance no longer approves: its verification throws.
    const store = new MemoryRunStore();
    await store.create({
      id: 'run_orphan',
      tenantId: 't',
      gameId: 'reference',
      categoryId: 'any%',
      player: 'Lou',
      submittedAt: 1,
      status: 'queued',
      trust: 'local',
      runKey: 'orphan',
      deleteTokenHash: '0',
      envelope: envelope(),
    });
    await queue({ store, approved: {} }).idle();
    expect(await store.get('t', 'run_orphan')).toMatchObject({
      status: 'done',
      verdict: 'inconclusive',
      trust: 'local',
    });
  });

  it('idle() takes a run queued while its workers were finishing', async () => {
    const store = new MemoryRunStore();
    const original = store.claimNext.bind(store);
    let first = true;
    // The first claim finds nothing, and a run lands right after it (another instance's submission).
    store.claimNext = async (...args) => {
      if (first) {
        first = false;
        await store.create({
          id: 'run_late',
          tenantId: 't',
          gameId: 'reference',
          categoryId: 'any%',
          player: 'Late',
          submittedAt: 1,
          status: 'queued',
          trust: 'local',
          runKey: 'late',
          deleteTokenHash: '0',
          envelope: envelope({ runSeed: 'late' }),
        });
        return undefined;
      }
      return original(...args);
    };
    await queue({ store }).idle();
    expect((await store.get('t', 'run_late'))!.status).toBe('done');
  });

  it('purges runs past their retention and quota buckets idle two minutes, nothing newer', async () => {
    const day = 86_400_000;
    let now = 100 * day;
    const store = new MemoryRunStore();
    const q = queue({ store, now: () => now, retentionDays: 90 });
    await store.create({
      id: 'old',
      tenantId: 't',
      gameId: 'g',
      categoryId: 'c',
      player: 'P',
      submittedAt: 10 * day - 1,
      status: 'done',
      trust: 'local',
      runKey: 'o',
      deleteTokenHash: '0',
      envelope: '',
    });
    await store.create({
      id: 'kept',
      tenantId: 't',
      gameId: 'g',
      categoryId: 'c',
      player: 'P',
      submittedAt: 10 * day + 1,
      status: 'done',
      trust: 'local',
      runKey: 'k',
      deleteTokenHash: '0',
      envelope: '',
    });
    await q.limiter.take('t', 'idle', now - 120_001);
    await q.limiter.take('t', 'recent', now - 119_999);
    expect(await q.purge()).toBe(1);
    expect((await store.list('t')).map((r) => r.id)).toEqual(['kept']);
    expect((q.limiter as unknown as { size: number }).size).toBe(1);
  });
});

describe('the queue says what happened', () => {
  it('a submission whose envelope is not a text is a 400, not a crash', async () => {
    const q = queue();
    for (const env of [42, null, { format: 'web-scumm-speedrun' }])
      await expect(q.submit('t', { player: 'Lou', envelope: env })).rejects.toMatchObject({
        status: 400,
        code: 'envelope',
      });
  });

  it("leases a run for the worker's budget and 30 s; an idle queue logs nothing", async () => {
    const store = new MemoryRunStore();
    const claim = vi.spyOn(store, 'claimNext');
    const log = vi.fn();
    const q = queue({ store, timeoutMs: 7000, log });
    await q.idle();
    expect(claim).toHaveBeenCalledWith(expect.any(String), 37_000, expect.any(Number), undefined);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs a verdict whose lease was taken over, and a game this instance does not approve', async () => {
    const store = new MemoryRunStore();
    store.complete = async () => false;
    const log = vi.fn();
    const q = queue({ store, log });
    await submit(q, envelope());
    await q.idle();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('the lease was taken over before the verdict'));
    const other = new MemoryRunStore();
    await other.create({
      id: 'run_x',
      tenantId: 't',
      gameId: 'reference',
      categoryId: 'any%',
      player: 'Lou',
      submittedAt: 1,
      status: 'queued',
      trust: 'local',
      runKey: 'x',
      deleteTokenHash: '0',
      envelope: envelope(),
    });
    const log2 = vi.fn();
    await queue({ store: other, approved: {}, log: log2 }).idle();
    expect(log2).toHaveBeenCalledWith(expect.stringContaining('no approved package for "reference"'));
  });

  it('says "sent after its day" of a late Daily run only', async () => {
    let now = 5000;
    const q = queue({ now: () => now });
    const onTime = (await submit(q, envelope({ stub: { validUntil: 9000 } }))) as { id: string };
    now = 6000;
    await q.idle();
    expect((await q.o.store.get('t', onTime.id))!.reason).not.toContain('sent after its day');
  });
});
