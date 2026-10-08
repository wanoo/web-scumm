// The leaderboard at any size (4.1.17, plan §6): the store ranks — each pseudonym's best, then the rank, then the
// limit — so the 10 001st run, faster than all, is first. Until 4.1.17 the store gave the first 10 000 runs by
// submission and the queue ranked those: that run was lost. The memory store, SQLite and Postgres (when BRIDGE_PG_URL
// names one) give the same JSON; a time is canonical (`"00042"` is `"42"`); the envelopes are never read; the schema 3
// migration brings 4.1.16's rows to that form.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  canonicalTime,
  type LeaderboardQuery,
  MemoryRunStore,
  type RunRecord,
  type RunStore,
  SqlRunStore,
} from '../bridge/src/runs-store';
import { BOARD_LIMIT, RunQueue, runsRoute } from '../bridge/src/runs';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';
import { type PgModule, PostgresRealityStore } from '../bridge/src/store-postgres';
import type { SqlDb } from '../bridge/src/store-sql';

const dir = mkdtempSync(join(tmpdir(), 'bridge-board-'));
const closers: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  for (const c of closers) await c().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
/** A verified run, as a worker leaves it. */
const done = (o: Partial<RunRecord> & { player: string; ranked: string | null }): RunRecord => {
  n++;
  return {
    id: `run_${String(n).padStart(6, '0')}`,
    tenantId: 't1',
    gameId: 'reference',
    categoryId: 'any%',
    submittedAt: 1_000_000 + n,
    status: 'done',
    verdict: 'valid',
    trust: 'replay-valid',
    leaderboardKey: 'any%',
    runKey: `key-${n}-${randomBytes(4).toString('hex')}`,
    deleteTokenHash: '0'.repeat(64),
    envelope: '',
    ...o,
  };
};
const q = (o: Partial<LeaderboardQuery> = {}): LeaderboardQuery => ({
  tenantId: 't1',
  gameId: 'reference',
  categoryId: 'any%',
  leaderboardKey: 'any%',
  limit: 100,
  ...o,
});

const PG_URL = process.env.BRIDGE_PG_URL;
const sqlite = async (): Promise<SqlDb> => {
  const s = await SqliteRealityStore.open(join(dir, `${randomBytes(4).toString('hex')}.sqlite`), { pollMs: 0 });
  closers.push(() => s.close());
  return s.db;
};
const STORES: { name: string; make(): Promise<RunStore> }[] = [
  { name: 'memory', make: async () => new MemoryRunStore() },
  { name: 'sqlite', make: async () => new SqlRunStore(await sqlite()) },
];
if (PG_URL)
  STORES.push({
    name: 'postgres',
    make: async () => {
      const pg = ((await import(/* @vite-ignore */ process.env.BRIDGE_PG_MODULE ?? 'pg')) as { default: PgModule })
        .default;
      const s = await PostgresRealityStore.open(PG_URL, { pg });
      closers.push(() => s.close());
      return new SqlRunStore(s.db);
    },
  });

/** Many rows at once: one transaction for a SQL store (ten thousand commits would be the test's time). */
async function fill(store: RunStore, rows: RunRecord[]) {
  if (store instanceof SqlRunStore) {
    const db = store.db;
    await db.tx(undefined, async (tx) => {
      const inner = new SqlRunStore({
        dialect: db.dialect,
        run: (s, p) => tx.run(s, p),
        all: (s, p) => tx.all(s, p),
      } as SqlDb);
      for (const r of rows) await inner.create(r);
    });
  } else for (const r of rows) await store.create(r);
}

describe('canonical times', () => {
  it('keeps decimal digits without leading zeros, refuses the rest', () => {
    expect(canonicalTime('00042')).toBe('42');
    expect(canonicalTime('0')).toBe('0');
    expect(canonicalTime('000')).toBe('0');
    expect(canonicalTime('9007199254740993')).toBe('9007199254740993');
    expect(canonicalTime('1'.repeat(30))).toBe('1'.repeat(30));
    expect(canonicalTime(`000${'1'.repeat(30)}`)).toBe('1'.repeat(30));
    for (const bad of ['1'.repeat(31), '-1', '+1', '1.5', '1e3', ' 1', '', 'abc', 42, null, undefined])
      expect(canonicalTime(bad), String(bad)).toBeNull();
  });
});

for (const kind of STORES)
  describe(`the leaderboard, ${kind.name}`, () => {
    it('the 10 001st run, faster than every other, is first; a player with 10 001 runs is one line', async () => {
      const store = await kind.make();
      const many = Array.from({ length: 10_000 }, (_, i) => done({ player: `p${i % 50}`, ranked: String(2000 + i) }));
      await fill(store, [...many, done({ player: 'late', ranked: '1000' })]);
      const board = await store.board(q());
      expect(board[0]).toMatchObject({ rank: 1, run: { player: 'late', ranked: '1000' } });
      expect(board.length).toBe(51);
      expect(new Set(board.map((r) => r.run.player)).size).toBe(51);
      // One player's 10 001 runs: only the best, wherever it was submitted.
      const solo = await kind.make();
      await fill(solo, [
        ...Array.from({ length: 10_000 }, (_, i) => done({ player: 'solo', ranked: String(5000 + i) })),
        done({ player: 'solo', ranked: '4999' }),
      ]);
      const one = await solo.board(q());
      expect(one.map((r) => [r.rank, r.run.player, r.run.ranked])).toEqual([[1, 'solo', '4999']]);
    }, 120_000);

    it('a late faster run replaces the older; equal times share a rank, then submission and id order them', async () => {
      const store = await kind.make();
      await fill(store, [
        done({ player: 'Ann', ranked: '500', id: 'run_b' }),
        done({ player: 'Bob', ranked: '500', id: 'run_a' }),
        done({ player: 'Cat', ranked: '700' }),
        done({ player: 'Ann', ranked: '400' }),
        done({ player: 'Dan', ranked: '700' }),
        done({ player: 'Eve', ranked: '900' }),
      ]);
      const board = await store.board(q());
      expect(board.map((r) => [r.rank, r.run.player, r.run.ranked])).toEqual([
        [1, 'Ann', '400'],
        [2, 'Bob', '500'],
        [3, 'Cat', '700'],
        [3, 'Dan', '700'],
        [5, 'Eve', '900'],
      ]);
      // The limit is the answer's: the ranks are the whole board's.
      expect((await store.board(q({ limit: 4 }))).map((r) => [r.rank, r.run.player])).toEqual([
        [1, 'Ann'],
        [2, 'Bob'],
        [3, 'Cat'],
        [3, 'Dan'],
      ]);
    });

    it('orders equal times by submission, then by id; an empty time is no time', async () => {
      const store = await kind.make();
      await fill(store, [
        done({ player: 'Zed', ranked: '600', id: 'run_z', submittedAt: 5 }),
        done({ player: 'Amy', ranked: '600', id: 'run_a', submittedAt: 5 }),
        done({ player: 'Bo', ranked: '600', id: 'run_b', submittedAt: 4 }),
        done({ player: 'Empty', ranked: '' }),
      ]);
      expect((await store.board(q())).map((r) => [r.rank, r.run.player])).toEqual([
        [1, 'Bo'],
        [1, 'Amy'],
        [1, 'Zed'],
      ]);
    });

    it('orders times past Number.MAX_SAFE_INTEGER as decimals, and never reads an envelope', async () => {
      const store = await kind.make();
      await fill(store, [
        done({ player: 'Big', ranked: '9007199254740993' }),
        done({ player: 'Bigger', ranked: '10000000000000000' }),
        done({ player: 'Small', ranked: '9007199254740992' }),
        done({ player: 'Huge', ranked: '1'.repeat(30) }),
        done({ player: 'Nine', ranked: '9' }),
      ]);
      const board = await store.board(q());
      expect(board.map((r) => r.run.player)).toEqual(['Nine', 'Small', 'Big', 'Bigger', 'Huge']);
      expect(board.every((r) => r.run.envelope === '')).toBe(true);
    });

    it('keeps tenants, games, categories, worlds and seed kinds apart; only valid, ranked, finished runs', async () => {
      const store = await kind.make();
      await fill(store, [
        done({ player: 'In', ranked: '100' }),
        done({ player: 'Tenant', ranked: '1', tenantId: 't2' }),
        done({ player: 'Game', ranked: '1', gameId: 'demo' }),
        done({ player: 'Category', ranked: '1', categoryId: 'other' }),
        done({ player: 'World', ranked: '1', leaderboardKey: 'any%:WS-0000-0000' }),
        done({ player: 'Unranked', ranked: null }),
        done({ player: 'Unverified', ranked: '1', verdict: 'valid-unranked' }),
        done({ player: 'Waiting', ranked: '1', status: 'queued' }),
        done({ player: 'Old', ranked: '200', leaderboardKey: undefined, seedKind: 'fixed' }),
        done({ player: 'Random', ranked: '300', seedKind: 'random' }),
      ]);
      expect((await store.board(q())).map((r) => r.run.player)).toEqual(['In', 'Old', 'Random']);
      expect((await store.board(q({ seedKind: 'fixed' }))).map((r) => r.run.player)).toEqual(['Old']);
      expect((await store.board(q({ tenantId: 't2' }))).map((r) => r.run.player)).toEqual(['Tenant']);
      expect((await store.board(q({ leaderboardKey: 'any%:WS-0000-0000' }))).map((r) => r.run.player)).toEqual([
        'World',
      ]);
    });
  });

describe('every store, the same board', () => {
  it('memory, SQLite (and Postgres when given) answer the same JSON', async () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      done({
        player: `p${(i * 7) % 40}`,
        ranked: String(1000 + ((i * 7919) % 97)),
        seedKind: i % 3 ? 'random' : 'fixed',
      }),
    );
    const answers: string[] = [];
    for (const kind of STORES) {
      const store = await kind.make();
      await fill(
        store,
        rows.map((r) => ({ ...r })),
      );
      // The same text, keys sorted (a row's fields are built in another order by each store).
      const canon = (v: unknown) =>
        JSON.stringify(v, (_, x) =>
          x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x,
        );
      answers.push(canon([await store.board(q()), await store.board(q({ seedKind: 'fixed', limit: 7 }))]));
    }
    for (const a of answers.slice(1)) expect(a).toBe(answers[0]);
  });
});

describe('the queue', () => {
  it('bounds the answer: 100 rows by default, 1 000 at most, whatever is asked', async () => {
    const store = new MemoryRunStore();
    for (let i = 0; i < 1200; i++) await store.create(done({ player: `p${i}`, ranked: String(1000 + i) }));
    const queue = new RunQueue({ store, approved: {}, worker: ['true'], purgeEveryMs: 0, pollMs: 0, log: () => {} });
    try {
      expect((await queue.leaderboard('t1', 'reference', 'any%')).length).toBe(BOARD_LIMIT.default);
      expect((await queue.leaderboard('t1', 'reference', 'any%', { limit: 5000 })).length).toBe(BOARD_LIMIT.max);
      expect((await queue.leaderboard('t1', 'reference', 'any%', { limit: 0 })).length).toBe(1);
      expect((await queue.leaderboard('t1', 'reference', 'any%', { limit: 3 })).map((r) => r.rank)).toEqual([1, 2, 3]);
      expect((await queue.leaderboard('t1', 'reference', 'any%', { limit: Number.NaN })).length).toBe(100);
      // Over HTTP: `&limit=` from 1 to 1 000, anything else is a 400.
      const route = runsRoute(queue, () => 't1');
      const get = async (qs: string) => {
        let status = 0;
        let body = '';
        const res = {
          writeHead: (s: number) => ((status = s), res),
          setHeader: () => res,
          end: (b?: string) => ((body = b ?? ''), res),
        } as never;
        await route({ method: 'GET', url: `/v1/runs?${qs}`, headers: {} } as never, res, '/v1/runs');
        return { status, body: body ? JSON.parse(body) : null };
      };
      expect((await get('game=reference&category=any%25&limit=7')).body.runs.length).toBe(7);
      for (const bad of ['0', '1001', '9999', 'x', '-1'])
        expect((await get(`game=reference&category=any%25&limit=${bad}`)).status, bad).toBe(400);
    } finally {
      queue.close();
    }
  });
});

describe('schema 3', () => {
  it("brings 4.1.16's ranked times to the canonical form, and sets aside what is not a time", async () => {
    const file = join(dir, 'v2.sqlite');
    const old = await SqliteRealityStore.open(file, { pollMs: 0, migrate: false });
    await old.migrate({ to: 2 });
    const v2 = new SqlRunStore(old.db);
    await v2.create(done({ player: 'Zeros', ranked: '00042' }));
    await v2.create(done({ player: 'Zero', ranked: '000' }));
    await v2.create(done({ player: 'Plain', ranked: '43' }));
    await v2.create(done({ player: 'Word', ranked: 'abc', reason: 'replayed' }));
    await v2.create(done({ player: 'Long', ranked: '1'.repeat(31) }));
    await old.migrate();
    expect(await old.schemaVersion()).toBe(3);
    const board = await v2.board(q());
    expect(board.map((r) => [r.rank, r.run.player, r.run.ranked])).toEqual([
      [1, 'Zero', '0'],
      [2, 'Zeros', '42'],
      [3, 'Plain', '43'],
    ]);
    const word = (await v2.list('t1')).find((r) => r.player === 'Word')!;
    expect(word).toMatchObject({ ranked: null, trust: 'replay-valid' });
    expect(word.reason).toContain('the ranked time "abc" is not a decimal of at most 30 digits; set aside');
    const long = (await v2.list('t1')).find((r) => r.player === 'Long')!;
    expect(long.ranked).toBeNull();
    // A run without a reason gets one: the concatenation never turns it into NULL.
    expect(long.reason).toContain(`the ranked time "${'1'.repeat(31)}" is not a decimal`);
    await old.close();
  });
});
