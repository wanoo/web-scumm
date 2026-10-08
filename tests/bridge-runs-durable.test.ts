// The speedrun leaderboards are durable and shared (4.1.16, ADR 0019, plan §8): runs live in the Reality store's SQL
// (SQLite here, Postgres when `BRIDGE_PG_URL` names one: CI's `bridge-postgres` job). Two instances receiving the same
// run create one; three workers across two instances verify each run once; a run whose worker died is claimed again
// when its lease expires; a restart loses nothing; a leaderboard is the verifier's key and ties share a rank. The
// worker is a stand-in speaking the real protocol (tests/fixtures/runs-stub-worker.mjs).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { RunQueue, SqlRunStore } from '../bridge/src/runs';
import type { RunStore } from '../bridge/src/runs-store';
import { MemoryDailyStore, SqlDailyStore, dailyRoutes } from '../bridge/src/daily';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';
import { type PgModule, PostgresRealityStore } from '../bridge/src/store-postgres';
import type { SqlDb } from '../bridge/src/store-sql';

const dir = mkdtempSync(join(tmpdir(), 'bridge-runs-'));
const closers: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  for (const c of closers) await c().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

const WORKER = [process.execPath, resolve('tests/fixtures/runs-stub-worker.mjs')];
const approved = {
  reference: {
    dir: resolve('games/reference'),
    fingerprint: { logic: '', trustedExtensions: '', presentation: '', engine: '' },
  },
};
/** A run's text: its inputs make its key, its time ranks it, its world and the stub's answer are said in it. */
const run = (
  n: number | string,
  o: { time?: string; category?: string; seed?: string; stub?: Record<string, unknown> } = {},
) =>
  JSON.stringify({
    format: 'web-scumm-speedrun',
    schema: 2,
    gameId: 'reference',
    categoryId: o.category ?? 'any%',
    runSeed: `seed-${n}`,
    variant: {
      hash: (o.seed ?? 'story').padEnd(64, '0').slice(0, 64),
      mode: o.seed ? 'remix' : 'story',
      seed: o.seed ?? 'story',
    },
    timing: { logicalTime: o.time ?? String(1000 + Number(n) || 1000) },
    chunks: [{ entries: [{ start: 'new' }, { act: { verb: 'look', a: `thing-${n}` } }] }],
    ...(o.stub ? { stub: o.stub } : {}),
  });

const PG_URL = process.env.BRIDGE_PG_URL;
const pgModule = async (): Promise<PgModule> =>
  ((await import(/* @vite-ignore */ process.env.BRIDGE_PG_MODULE ?? 'pg')) as { default: PgModule }).default;

/** Two handles on one database (two instances of the Bridge), and a third opened later (a restart). */
type Opened = [SqlDb, SqlDb] & { reopen(): Promise<SqlDb> };
const KINDS: { name: string; open(): Promise<Opened> }[] = [
  {
    name: 'sqlite',
    open: async () => {
      const file = join(dir, `${randomBytes(4).toString('hex')}.sqlite`);
      const one = async () => {
        const s = await SqliteRealityStore.open(file, { pollMs: 0 });
        closers.push(() => s.close());
        return s.db;
      };
      return Object.assign([await one(), await one()] as [SqlDb, SqlDb], { reopen: one });
    },
  },
];
if (PG_URL)
  KINDS.push({
    name: 'postgres',
    open: async () => {
      const pg = await pgModule();
      const one = async () => {
        const s = await PostgresRealityStore.open(PG_URL, { pg });
        closers.push(() => s.close());
        return s.db;
      };
      return Object.assign([await one(), await one()] as [SqlDb, SqlDb], { reopen: one });
    },
  });

const queue = (store: RunStore, o: Partial<ConstructorParameters<typeof RunQueue>[0]> = {}) => {
  const audit: { event: string; run?: string; worker?: string }[] = [];
  const q = new RunQueue({
    store,
    approved,
    worker: WORKER,
    purgeEveryMs: 0,
    pollMs: 0,
    perMinute: 1000,
    audit: (l) => audit.push(l as never),
    log: () => {},
    ...o,
  });
  closers.push(async () => q.close());
  return { q, audit };
};
/** A tenant of its own per test (Postgres keeps one database for the whole run). */
const tenant = () => `t-${randomBytes(4).toString('hex')}`;

for (const kind of KINDS)
  describe(`runs on ${kind.name}`, () => {
    it('two instances receive the same run at once: one is created, the other is told it exists', async () => {
      const [da, db] = await kind.open();
      const t = tenant();
      const a = queue(new SqlRunStore(da)).q;
      const b = queue(new SqlRunStore(db)).q;
      const body = { player: 'Lou', envelope: run(1) };
      const got = await Promise.allSettled([a.submit(t, body), b.submit(t, body)]);
      expect(got.filter((g) => g.status === 'fulfilled')).toHaveLength(1);
      expect(got.find((g) => g.status === 'rejected')).toMatchObject({ reason: { status: 409, code: 'duplicate' } });
      expect(await new SqlRunStore(da).list(t)).toHaveLength(1);
      await a.idle();
      await b.idle();
    }, 60_000);

    it('three workers over two instances verify each run exactly once, and the verdicts survive a restart', async () => {
      const opened = await kind.open();
      const [da, db] = opened;
      const t = tenant();
      const A = queue(new SqlRunStore(da), { workers: 2 });
      const B = queue(new SqlRunStore(db), { workers: 1 });
      const ids: string[] = [];
      for (let i = 0; i < 6; i++)
        ids.push(
          (await (i % 2 ? A.q : B.q).submit(t, { player: `P${i}`, envelope: run(i, { stub: { sleepMs: 50 } }) })).id,
        );
      await Promise.all([A.q.idle(), B.q.idle()]);
      const verified = [...A.audit, ...B.audit].filter((l) => l.event === 'run.verified').map((l) => l.run);
      expect(verified.sort()).toEqual([...ids].sort());
      // Every worker that took part was this run's alone (no run twice), and both instances worked.
      expect(
        new Set([...A.audit, ...B.audit].filter((l) => l.event === 'run.verified').map((l) => l.worker?.split(':')[0]))
          .size,
      ).toBe(2);
      // A restart: a new handle on the same database reads every verdict.
      const rows = await new SqlRunStore(await opened.reopen()).list(t);
      expect(rows.map((r) => [r.status, r.verdict, r.envelope])).toEqual(ids.map(() => ['done', 'valid', '']));
    }, 60_000);

    it('a run whose worker died is claimed again when its lease expires; the dead worker cannot store a verdict', async () => {
      const [da] = await kind.open();
      const t = tenant();
      let now = 1_000_000;
      const store = new SqlRunStore(da);
      const { q } = queue(store, { now: () => now, leaseMs: 5_000 });
      // Queued by another instance, claimed by its worker, which then dies (it never completes).
      await store.create({
        id: 'run_dead',
        tenantId: t,
        gameId: 'reference',
        categoryId: 'any%',
        player: 'Ann',
        submittedAt: now,
        status: 'queued',
        trust: 'local',
        runKey: `k-${t}`,
        deleteTokenHash: '00',
        envelope: run('lease'),
      });
      expect((await store.claimNext('dead:0', 5_000, now))?.id).toBe('run_dead');
      expect(await store.claimNext('other:0', 5_000, now + 1_000)).toBeUndefined();
      await q.idle();
      expect((await store.get(t, 'run_dead'))?.status).toBe('verifying');
      now += 6_000;
      await q.idle();
      expect(await store.get(t, 'run_dead')).toMatchObject({ status: 'done', verdict: 'valid' });
      expect(
        await store.complete(t, 'run_dead', 'dead:0', { verdict: 'invalid-replay', trust: 'local', ranked: null }),
      ).toBe(false);
      expect((await store.get(t, 'run_dead'))?.verdict).toBe('valid');
    }, 60_000);

    it('a leaderboard is one verifier key; equal times share a rank; a run outside the board is not on it', async () => {
      const [da] = await kind.open();
      const t = tenant();
      const { q } = queue(new SqlRunStore(da));
      await q.submit(t, { player: 'Ann', envelope: run('a', { time: '500' }) });
      await q.submit(t, { player: 'Bob', envelope: run('b', { time: '500' }) });
      await q.submit(t, { player: 'Cat', envelope: run('c', { time: '700' }) });
      await q.submit(t, { player: 'Dan', envelope: run('d', { time: '100', stub: { verdict: 'valid-unranked' } }) });
      await q.submit(t, {
        player: 'Eve',
        envelope: run('e', {
          time: '50',
          category: 'fixed',
          seed: 'WS-AAAA-AAAA',
          stub: { board: 'fixed:WS-AAAA-AAAA' },
        }),
      });
      await q.idle();
      const board = await q.leaderboard(t, 'reference', 'any%');
      expect(board.map((r) => [r.rank, r.player])).toEqual([
        [1, 'Ann'],
        [1, 'Bob'],
        [3, 'Cat'],
      ]);
      const fixed = await q.leaderboard(t, 'reference', 'fixed', { key: 'fixed:WS-AAAA-AAAA' });
      expect(fixed.map((r) => r.player)).toEqual(['Eve']);
      expect(await q.leaderboard(t, 'reference', 'fixed')).toEqual([]);
      // Two tenants keep their runs apart, the same run included.
      const other = tenant();
      await q.submit(other, { player: 'Ann', envelope: run('a', { time: '500' }) });
      await q.idle();
      expect((await q.leaderboard(other, 'reference', 'any%')).map((r) => r.player)).toEqual(['Ann']);
      expect(await q.o.store.get(other, board[0]!.id)).toBeUndefined();
    }, 60_000);

    it('a copy re-sealed in another world is the same run: the first submitter keeps it', async () => {
      const [da] = await kind.open();
      const t = tenant();
      const { q } = queue(new SqlRunStore(da));
      await q.submit(t, { player: 'Lou', envelope: run('w', { seed: 'WS-AAAA-AAAA' }) });
      await expect(
        q.submit(t, { player: 'Thief', envelope: run('w', { seed: 'WS-BBBB-BBBB' }) }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'duplicate',
      });
      await q.idle();
    }, 60_000);

    it("a Daily run sent after its day is practice: its verdict stands, it is not on that day's board", async () => {
      const [da] = await kind.open();
      const t = tenant();
      const now = Date.parse('2026-10-09T08:00:00Z');
      const { q } = queue(new SqlRunStore(da), { now: () => now });
      const board = 'daily:WS-AAAA-AAAA';
      const day = { category: 'daily', seed: 'WS-AAAA-AAAA' };
      const { id: late } = await q.submit(t, {
        player: 'Late',
        envelope: run('late', { ...day, stub: { board, validUntil: Date.parse('2026-10-09T00:00:00Z') } }),
      });
      await q.submit(t, {
        player: 'OnTime',
        envelope: run('ok', { ...day, stub: { board, validUntil: Date.parse('2026-10-10T00:00:00Z') } }),
      });
      await q.idle();
      expect(await q.o.store.get(t, late)).toMatchObject({ verdict: 'valid', ranked: null });
      expect((await q.leaderboard(t, 'reference', 'daily', { key: board })).map((r) => r.player)).toEqual(['OnTime']);
    }, 60_000);

    it("the daily challenge's records are written once for every instance", async () => {
      const [da, db] = await kind.open();
      const a = new SqlDailyStore(da);
      const b = new SqlDailyStore(db);
      const k = `daily|${tenant()}|2026-10-08`;
      const [x, y] = await Promise.all([a.putIfAbsent(k, 'first'), b.putIfAbsent(k, 'second')]);
      expect(x).toBe(y);
      expect(await b.get(k)).toBe(x);
    });
  });

describe('the daily routes refuse what is not a day, a game or a bounded request', () => {
  it('a malformed or impossible date, a day beyond the retention, an inherited game id', async () => {
    const key = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const now = Date.parse('2026-10-08T12:00:00Z');
    const d = dailyRoutes({
      games: { reference: { daily: 'daily', mystery: 'mystery' } },
      key: key.privateKey,
      kid: 'k',
      secret: 's',
      store: new MemoryDailyStore(),
      now: () => now,
    });
    const get = async (q: string) => (await d.handle({ method: 'GET', url: `/v1/daily?${q}` }))!.status;
    expect(await get('game=reference')).toBe(200);
    expect(await get('game=reference&date=2026-10-07')).toBe(200);
    for (const date of ['', '1999-99-99', '2026-02-30', '26-10-08', '2026-10-08T00'])
      expect(await get(`game=reference&date=${encodeURIComponent(date)}`), date).toBe(400);
    expect(await get('game=reference&date=2026-10-09')).toBe(403);
    expect(await get('game=reference&date=2026-08-01')).toBe(410);
    for (const g of ['__proto__', 'constructor', 'toString']) expect(await get(`game=${g}`), g).toBe(404);
    const commit = await d.handle({ method: 'POST', url: '/v1/commit', body: { game: '__proto__' }, client: 'c' });
    expect(commit!.status).toBe(404);
  });
});

describe('bridgeServer mounts the leaderboards and the daily challenge when its options name them', () => {
  it('the routes answer behind the tenant, CORS and the anonymous budget of every other route', async () => {
    const { bridgeServer } = await import('../bridge/src/server');
    const { MemoryRealityStore } = await import('../bridge/src/store-memory');
    const { MemoryRunStore } = await import('../bridge/src/runs');
    const { tenantBridge } = await import('./fixtures/bridge-tenant');
    const { bridge } = await tenantBridge(new MemoryRealityStore(), { origins: ['https://game.test'] });
    const key = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const runs = queue(new MemoryRunStore()).q;
    const daily = dailyRoutes({ games: { reference: { daily: 'daily' } }, key: key.privateKey, kid: 'k', secret: 's' });
    const server = bridgeServer(bridge, { runs, daily: { [bridge.tenantId]: daily }, perMinutePerIp: 1000 });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
    closers.push(() => new Promise((ok) => server.close(ok)));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const day = await fetch(`${base}/v1/daily?game=reference`);
    expect(day.status).toBe(200);
    expect(((await day.json()) as { token: string }).token.split('.')).toHaveLength(3);
    expect((await fetch(`${base}/v1/daily?game=reference&date=2026-02-30`)).status).toBe(400);
    const sent = await fetch(`${base}/v1/runs`, {
      method: 'POST',
      body: JSON.stringify({ player: 'Lou', envelope: run('http') }),
    });
    expect(sent.status).toBe(202);
    await runs.idle();
    const board = (await (await fetch(`${base}/v1/runs?game=reference&category=any%25`)).json()) as {
      runs: { player: string; rank: number; leaderboardKey: string }[];
    };
    expect(board.runs).toMatchObject([{ player: 'Lou', rank: 1, leaderboardKey: 'any%' }]);
    const pre = await fetch(`${base}/v1/runs`, { method: 'OPTIONS', headers: { origin: 'https://game.test' } });
    expect(pre.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(pre.headers.get('access-control-allow-headers')).toContain('X-Delete-Token');
  }, 60_000);
});
