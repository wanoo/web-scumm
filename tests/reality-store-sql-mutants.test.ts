// The SQL store's rows read back exactly as written (4.1.18, plan §6): every optional column absent stays absent,
// present comes back; pairings claimed, keys retired, tenants imported with and without `replace`, an export read in
// one snapshot. The migrations: up to a target and no further, and a step another instance applied meanwhile is
// skipped, not run twice. One in-memory SQLite database per test, no process, no Postgres: short enough for mutants.
import { describe, expect, it } from 'vitest';
import { migrate, schemaVersion } from '../bridge/src/migrations';
import type { Pairing, Player } from '../bridge/src/store';
import type { TenantExport } from '../bridge/src/store-async';
import { type Row, type SqlDb, type SqlQuery, SqlRealityStore } from '../bridge/src/store-sql';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';

const T = 'acme';
const open = () => SqliteRealityStore.open(':memory:', { pollMs: 0 });

const bare: Player = { playerId: 'p1', gameId: 'g', capabilityHash: 'h1', capabilityExpiresAt: 10 };
const full: Player = {
  playerId: 'p2',
  gameId: 'g',
  capabilityHash: 'h2',
  capabilityExpiresAt: 20,
  issuedAt: 5,
  revoked: true,
  sessionId: 's2',
  origin: 'https://a.example',
};

/** A SQL store over a real SQLite database that records what it hands the driver: statements' parameters, transactions' options. */
class Probe extends SqlRealityStore {
  readonly kind = 'sqlite' as const;
  readonly runs: unknown[][] = [];
  readonly txs: { lockKey: string | undefined; readOnly?: boolean }[] = [];
  constructor(inner: SqlDb) {
    const record = (q: SqlQuery): SqlQuery => ({
      all: (sql, params) => q.all(sql, params),
      run: (sql, params) => {
        this.runs.push(params ?? []);
        return q.run(sql, params);
      },
      exec: (sql) => q.exec(sql),
    });
    super({
      dialect: 'sqlite',
      ...record(inner),
      tx: (lockKey, fn, o) => {
        this.txs.push({ lockKey, readOnly: o?.readOnly });
        return inner.tx(lockKey, (q) => fn(record(q)), o);
      },
      close: () => inner.close(),
    });
  }
  protected async announce() {}
  watch() {
    return () => {};
  }
}

describe('the SQL store reads back what it wrote', () => {
  it('a player: optional columns absent stay absent, present come back', async () => {
    const s = await open();
    await s.putPlayer(T, bare);
    await s.putPlayer(T, full);
    expect(await s.player(T, 'p1')).toStrictEqual(bare);
    expect(await s.player(T, 'p2')).toStrictEqual(full);
    await s.close();
  });

  it('a pairing: claimed and origin come back, and their absence too', async () => {
    const s = await open();
    const plain: Pairing = { code: 'c1', gameId: 'g', expiresAt: 9 };
    const claimed: Pairing = { code: 'c2', gameId: 'g', expiresAt: 9, playerId: 'p', claimed: true, origin: 'o' };
    await s.putPairing(T, plain);
    await s.putPairing(T, claimed);
    expect(await s.pairing(T, 'c1')).toStrictEqual(plain);
    expect(await s.pairing(T, 'c2')).toStrictEqual(claimed);
    await s.close();
  });

  it('claiming a pairing whose player row is gone is `missing`, not `claimed`', async () => {
    const s = await open();
    await s.putPairing(T, { code: 'c', gameId: 'g', expiresAt: 9, playerId: 'ghost' });
    expect(await s.claimPairing(T, 'c', 'h')).toBe('missing');
    await s.close();
  });

  it('a signal: kid and payload absent stay absent; a payload that is not JSON reads as unreadable', async () => {
    const s = await open();
    await s.importTenant({
      tenantId: T,
      players: [bare],
      signals: [{ tenantId: T, playerId: 'p1', sequence: 1, id: 'i1', dedupeKey: 'd1', jws: 'j', at: 1 }],
      acks: [],
      revokedTokens: [],
      keys: [],
      quarantine: [],
    });
    await s.db.run(
      "INSERT INTO signals (tenant_id, player_id, sequence, id, dedupe_key, jws, at, kid, payload) VALUES ($1, 'p1', 2, 'i2', 'd2', 'j', 2, 'k', '{nope')",
      [T],
    );
    const [one, two] = await s.listAfter({ tenantId: T, playerId: 'p1', after: 0, limit: 10 });
    expect(one).toStrictEqual({ tenantId: T, playerId: 'p1', sequence: 1, id: 'i1', dedupeKey: 'd1', jws: 'j', at: 1 });
    expect(two?.kid).toBe('k');
    expect(two?.payload).toStrictEqual({ unreadable: true });
    await s.close();
  });

  it('keys: a retired key keeps its date, the current one has none (listed and exported)', async () => {
    const s = await open();
    await s.rotateKeys({ tenantId: T, keyId: 'k1', publicKey: 'pub1', retireAfter: '2026-01-01' });
    await s.rotateKeys({ tenantId: T, keyId: 'k2', publicKey: 'pub2' });
    const keys = [
      { tenantId: T, keyId: 'k1', publicKey: 'pub1', retireAfter: '2026-01-01' },
      { tenantId: T, keyId: 'k2', publicKey: 'pub2' },
    ];
    expect(await s.keys(T)).toStrictEqual(keys);
    expect((await s.exportTenant(T)).keys).toStrictEqual(keys);
    await s.close();
  });

  it('quarantine without a tenant lists every tenant', async () => {
    const s = await open();
    await s.quarantine({ tenantId: 'a', playerId: 'p', sequence: 1, reason: 'r', at: 1 });
    await s.quarantine({ tenantId: 'b', playerId: 'p', sequence: 1, reason: 'r', at: 1 });
    expect((await s.quarantined()).map((r) => r.tenantId)).toEqual(['a', 'b']);
    await s.close();
  });

  it('an export lists only the acknowledgements made, and is read in one read-only snapshot', async () => {
    const inner = await open();
    const s = new Probe(inner.db);
    await s.putPlayer(T, bare);
    await s.putPlayer(T, full);
    await s.acknowledge({ tenantId: T, playerId: 'p2', sequence: 3 });
    const x = await s.exportTenant(T);
    expect(x.acks).toStrictEqual([{ playerId: 'p2', through: 3 }]);
    expect(s.txs.at(-1)).toStrictEqual({ lockKey: undefined, readOnly: true });
    await s.close();
  });

  it('a signal without payload is written as NULL, never handed to the driver as undefined', async () => {
    const inner = await open();
    const s = new Probe(inner.db);
    await s.importTenant({
      tenantId: T,
      players: [],
      signals: [{ tenantId: T, playerId: 'p1', sequence: 1, id: 'i1', dedupeKey: 'd1', jws: 'j', at: 1 }],
      acks: [],
      revokedTokens: [],
      keys: [],
      quarantine: [],
    });
    expect(s.runs.at(-1)?.at(-1)).toBeNull();
    await s.close();
  });

  it('import: pairings keep claimed; replace clears the tenant first, without it the old rows stay', async () => {
    const s = await open();
    await s.putPlayer(T, full);
    const x: TenantExport = {
      tenantId: T,
      players: [bare],
      signals: [],
      acks: [],
      revokedTokens: [],
      keys: [],
      quarantine: [],
      pairings: [
        { code: 'c1', gameId: 'g', expiresAt: 9 },
        { code: 'c2', gameId: 'g', expiresAt: 9, playerId: 'p1', claimed: true },
      ],
    };
    await s.importTenant(x);
    expect(await s.player(T, 'p2')).toStrictEqual(full);
    expect(await s.pairing(T, 'c1')).toStrictEqual({ code: 'c1', gameId: 'g', expiresAt: 9 });
    expect(await s.pairing(T, 'c2')).toStrictEqual({
      code: 'c2',
      gameId: 'g',
      expiresAt: 9,
      playerId: 'p1',
      claimed: true,
    });
    await s.importTenant(x, { replace: true });
    expect(await s.player(T, 'p2')).toBeUndefined();
    expect(await s.player(T, 'p1')).toStrictEqual(bare);
    await s.close();
  });
});

describe('migrations', () => {
  it('stop at their target', async () => {
    const s = await SqliteRealityStore.open(':memory:', { migrate: false, pollMs: 0 });
    expect(await migrate(s.db, { to: 1 })).toEqual([1]);
    expect(await schemaVersion(s.db)).toBe(1);
    await s.close();
  });

  it('open no transaction for a step already recorded (4.1.19: the `>` that was an equivalent mutant)', async () => {
    const s = await SqliteRealityStore.open(':memory:', { migrate: false, pollMs: 0 });
    await migrate(s.db);
    let txs = 0;
    const counting = {
      exec: (sql: string) => s.db.exec(sql),
      all: (sql: string, params?: unknown[]): Promise<Row[]> => s.db.all(sql, params),
      tx: <R>(key: string | undefined, fn: (q: SqlQuery) => Promise<R>) => {
        txs++;
        return s.db.tx(key, fn);
      },
    };
    expect(await migrate(counting)).toEqual([]);
    // schemaVersion's own transaction only: the step at the current version is not opened again.
    expect(txs).toBe(1);
    await s.close();
  });

  it('skip a step another instance applied after this one read the version', async () => {
    const s = await SqliteRealityStore.open(':memory:', { migrate: false, pollMs: 0 });
    await migrate(s.db, { to: 1 });
    // This instance read the version before the other applied step 1: it sees 0.
    const stale = {
      exec: (sql: string) => s.db.exec(sql),
      all: (sql: string, params?: unknown[]): Promise<Row[]> =>
        sql.startsWith('SELECT MAX(version)') ? Promise.resolve([{ v: 0 }]) : s.db.all(sql, params),
      tx: <R>(key: string | undefined, fn: (q: SqlQuery) => Promise<R>) => s.db.tx(key, fn),
    };
    expect(await migrate(stale, { to: 2 })).toEqual([2]);
    expect(await schemaVersion(s.db)).toBe(2);
    await s.close();
  });
});
