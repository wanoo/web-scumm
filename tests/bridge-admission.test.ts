// Admission across instances (4.1.17, plan §7): the queue's room and the submission quota hold for every instance
// together. Until 4.1.17 an instance counted the waiting runs, then wrote (two instances seeing 99 of 100 both wrote),
// and each process kept its own quota (three instances, three quotas). Now `admit` counts and writes in one step under
// the tenant's lock, and a SqlLimiter keeps one bucket per client in the store's database, keyed by an HMAC — never
// the address. On SQLite three processes race on one file; on Postgres (BRIDGE_PG_URL) connections race for real.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { clientKey, MemoryLimiter, SqlLimiter } from '../bridge/src/runs-limiter';
import { MemoryRunStore, type RunRecord, SqlRunStore } from '../bridge/src/runs-store';
import { RunQueue, runsRoute } from '../bridge/src/runs';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';
import { type PgModule, PostgresRealityStore } from '../bridge/src/store-postgres';
import type { SqlDb } from '../bridge/src/store-sql';

const dir = mkdtempSync(join(tmpdir(), 'bridge-admit-'));
const closers: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  for (const c of closers) await c().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const run = (tenantId: string, runKey = `k-${++n}`, status: RunRecord['status'] = 'queued'): RunRecord => ({
  id: `run_${++n}_${randomBytes(3).toString('hex')}`,
  tenantId,
  gameId: 'g',
  categoryId: 'c',
  player: 'P',
  submittedAt: n,
  status,
  trust: 'local',
  runKey,
  deleteTokenHash: '0',
  envelope: '{}',
});

describe('admit, in one process', () => {
  it('a duplicate, then the room: queued and verifying runs count, finished ones do not', async () => {
    const s = new MemoryRunStore();
    expect(await s.admit(run('t', 'a'), 2)).toBe('created');
    expect(await s.admit(run('t', 'a'), 2)).toBe('duplicate');
    expect(await s.admit(run('t', 'b', 'verifying'), 2)).toBe('created');
    expect(await s.admit(run('t', 'c'), 2)).toBe('full');
    // A duplicate is said as such even when the queue is full.
    expect(await s.admit(run('t', 'a'), 2)).toBe('duplicate');
    // Another tenant has its own room.
    expect(await s.admit(run('u', 'c'), 2)).toBe('created');
    await s.create(run('t', 'd', 'done'));
    expect((await s.list('t')).length).toBe(3);
  });
});

describe('admit and the quota, across processes on one SQLite file', () => {
  it('three instances at once: never more than the room, the same run once, one quota for a client', async () => {
    const file = join(dir, 'race.sqlite');
    const first = await SqliteRealityStore.open(file, { pollMs: 0 });
    await first.close(); // the schema made once, before the race
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    const startAt = Date.now() + 1500;
    const outs = await Promise.all(
      ['a', 'b', 'c'].map(
        (who) =>
          new Promise<{ admitted: string[]; quota: boolean[] }>((ok, ko) => {
            const c = spawn(
              process.execPath,
              [tsx, resolve('tests/fixtures/admit-child.ts'), file, who, String(startAt), '7'],
              {
                stdio: ['ignore', 'pipe', 'pipe'],
              },
            );
            let out = '';
            let err = '';
            c.stdout.on('data', (d) => (out += d));
            c.stderr.on('data', (d) => (err += d));
            c.on('exit', (code) => (code === 0 ? ok(JSON.parse(out.trim().split('\n').at(-1)!)) : ko(new Error(err))));
          }),
      ),
    );
    const all = outs.flatMap((o) => o.admitted);
    expect(all.filter((a) => a === 'created')).toHaveLength(7);
    expect(all.filter((a) => a === 'duplicate')).toHaveLength(2); // `same`: one row, two told so
    expect(all.filter((a) => a === 'full')).toHaveLength(21);
    // 6 tokens a minute for one client, whichever instance it reaches: 6 of the 12 takes, at the same instant.
    expect(outs.flatMap((o) => o.quota).filter(Boolean)).toHaveLength(6);
    const s = await SqliteRealityStore.open(file, { pollMs: 0 });
    closers.push(() => s.close());
    expect((await new SqlRunStore(s.db).list('t')).length).toBe(7);
    // The address never reaches the database: only its HMAC.
    const rows = await s.db.all('SELECT * FROM run_quota');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.7');
    expect(rows[0]!.client_key).toBe(clientKey('shared', 't', '203.0.113.7'));
  }, 60_000);
});

const PG_URL = process.env.BRIDGE_PG_URL;
describe.skipIf(!PG_URL)('admit and the quota on Postgres, connections racing', () => {
  it('ten connections at once: never more than the room, one quota', async () => {
    const pg = ((await import(/* @vite-ignore */ process.env.BRIDGE_PG_MODULE ?? 'pg')) as { default: PgModule })
      .default;
    const dbs: SqlDb[] = [];
    for (let i = 0; i < 10; i++) {
      const s = await PostgresRealityStore.open(PG_URL!, { pg });
      closers.push(() => s.close());
      dbs.push(s.db);
    }
    const t = `t-${randomBytes(4).toString('hex')}`;
    const got = await Promise.all(
      dbs.flatMap((db, i) =>
        [0, 1, 2].map((k) => new SqlRunStore(db).admit(run(t, k === 0 ? 'same' : `${i}-${k}`), 5)),
      ),
    );
    expect(got.filter((g) => g === 'created')).toHaveLength(5);
    expect(await new SqlRunStore(dbs[0]!).list(t)).toHaveLength(5);
    const takes = await Promise.all(
      dbs.map((db) => new SqlLimiter(db, { perMinute: 4, secret: 's', keyVersion: 'k' }).take(t, 'client', 1000)),
    );
    expect(takes.filter((x) => x.ok)).toHaveLength(4);
  }, 60_000);
});

describe('the quota', () => {
  it('refills over the minute, keeps tenants apart, says when to come back', async () => {
    const l = new MemoryLimiter({ perMinute: 2, secret: 's' });
    expect((await l.take('t', 'c', 0)).ok).toBe(true);
    expect((await l.take('t', 'c', 0)).ok).toBe(true);
    expect(await l.take('t', 'c', 0)).toEqual({ ok: false, retryAfterS: 30 });
    expect((await l.take('u', 'c', 0)).ok).toBe(true); // another tenant, another bucket
    expect((await l.take('t', 'other', 0)).ok).toBe(true);
    expect((await l.take('t', 'c', 30_000)).ok).toBe(true); // half a minute: one token back
    expect(await l.purge(1)).toBe(2);
    expect(l.size).toBe(1);
  });

  it('keeps at most maxBuckets, the least recently used going first', async () => {
    const l = new MemoryLimiter({ perMinute: 2, secret: 's', maxBuckets: 3 });
    for (const c of ['a', 'b', 'c', 'd']) await l.take('t', c, 0);
    expect(l.size).toBe(3);
  });

  it('a rotated key starts a new bucket, and the old ones are purged', async () => {
    const s = await SqliteRealityStore.open(join(dir, 'rotate.sqlite'), { pollMs: 0 });
    closers.push(() => s.close());
    const old = new SqlLimiter(s.db, { perMinute: 1, secret: 'one', keyVersion: 'k1' });
    expect((await old.take('t', 'c', 0)).ok).toBe(true);
    expect((await old.take('t', 'c', 0)).ok).toBe(false);
    const rotated = new SqlLimiter(s.db, { perMinute: 1, secret: 'two', keyVersion: 'k2' });
    expect((await rotated.take('t', 'c', 0)).ok).toBe(true); // the controlled reset, said in REALITY-OPS
    // Another tenant on the same database, its own key: never touched by this tenant's purge.
    const other = new SqlLimiter(s.db, { perMinute: 1, secret: 'b', keyVersion: 'kb' });
    expect((await other.take('u', 'c', 0)).ok).toBe(true);
    expect(await rotated.purge(-1, 't')).toBe(1); // t's k1 bucket only
    expect(
      (await s.db.all('SELECT tenant_id, key_version FROM run_quota ORDER BY tenant_id')).map(
        (r) => `${r.tenant_id}:${r.key_version}`,
      ),
    ).toEqual(['t:k2', 'u:kb']);
    expect((await other.take('u', 'c', 0)).ok).toBe(false); // u's client is still limited
    // Without a tenant only idle buckets go, whatever their key.
    expect(await rotated.purge(1)).toBe(2);
  });

  it('a 429 says Retry-After; a duplicate or an invalid run costs a token too', async () => {
    const q = new RunQueue({
      store: new MemoryRunStore(),
      approved: {},
      worker: ['true'],
      perMinute: 2,
      purgeEveryMs: 0,
      pollMs: 0,
      log: () => {},
      audit: () => {},
    });
    closers.push(async () => q.close());
    const route = runsRoute(
      q,
      () => 't',
      () => '198.51.100.9',
    );
    const post = async (body: unknown) => {
      let status = 0;
      const headers: Record<string, string> = {};
      const raw = Buffer.from(JSON.stringify(body));
      const req = Object.assign(
        (async function* () {
          yield raw;
        })(),
        { method: 'POST', url: '/v1/runs', headers: {}, resume() {} },
      );
      const res = {
        writeHead: (s: number) => ((status = s), res),
        setHeader: (k: string, v: string) => ((headers[k] = v), res),
        end: () => res,
      };
      await route(req as never, res as never, '/v1/runs');
      return { status, headers };
    };
    expect((await post({ player: 'Ann', envelope: 'not json' })).status).toBe(400);
    expect((await post({ player: 'Ann', envelope: 'not json' })).status).toBe(400);
    const third = await post({ player: 'Ann', envelope: 'not json' });
    expect(third.status).toBe(429);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('bridge serve keys the quota by a secret derived from the tenant’s event key, never the raw address', () => {
    const cli = readFileSync('bridge/src/cli.ts', 'utf8');
    expect(cli).toMatch(/new SqlLimiter\(sql, \{/);
    expect(cli).toMatch(/keyVersion: f\.eventKey\.kid/);
  });
});
