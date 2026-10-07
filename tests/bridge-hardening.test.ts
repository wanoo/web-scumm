// What the second reading of 4.1.10 asked for (PR #45): a store error while a stream reads is logged and counted, never
// an unhandled rejection nor a failed proposal; V2's audience holds in a browser (an origin off the CORS list, a link
// paired without one, several origins); a V1 Bridge's keys bind no tenant; a V2 row signed again after a rotation
// names its new key; claims the store answers `pending` or `missing`; a row naming another player is quarantined;
// SQLite busy is a 503, its files are 0600; Postgres listens once and again after a drop, and a broken client is
// released with its error; a restore replaces a tenant in one transaction; pairings are exported.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { importBridgeKey, type Keyring, verifySignal } from '@engine/reality/protocol';
import { bridgeServer } from '../bridge/src/server';
import type { RealityStore } from '../bridge/src/store-async';
import { MemoryRealityStore } from '../bridge/src/store-memory';
import { type PgModule, PostgresRealityStore } from '../bridge/src/store-postgres';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';
import { eventKey, tenantBridge } from './fixtures/bridge-tenant';

const dir = mkdtempSync(join(tmpdir(), 'bridge-hardening-'));
const opened: RealityStore[] = [];
const servers: { close(): void }[] = [];
afterAll(async () => {
  for (const s of servers) s.close();
  for (const s of opened) await s.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});
const until = async (ok: () => boolean, ms = 3000) => {
  for (let t = 0; t < ms && !ok(); t += 10) await new Promise((r) => setTimeout(r, 10));
};
const keyring = (keys: { kid: string; raw: string }[]): Promise<Keyring> =>
  Promise.all(keys.map(({ kid, raw, ...w }) => importBridgeKey(kid, raw, w as never)));
const payloadOf = (jws: string) =>
  JSON.parse(Buffer.from(jws.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;

describe('a store error while a stream reads', () => {
  it('is logged and counted; the proposal is accepted all the same; the next read delivers', async () => {
    const store = new MemoryRealityStore();
    const t = await tenantBridge(store);
    const link = await t.pair();
    const got: number[] = [];
    await t.bridge.subscribe(link.capability, (seq) => got.push(seq));
    const listAfter = store.listAfter.bind(store);
    let fail = true;
    store.listAfter = async (c) => {
      if (fail) throw new Error('the store restarted');
      return listAfter(c);
    };
    await expect(t.propose(link.playerId, 'a')).resolves.toMatchObject({ sequence: 1, duplicate: false });
    expect(got).toEqual([]);
    expect(t.bridge.telemetry.snapshot()['errors:stream']).toBeGreaterThanOrEqual(1);
    expect(t.logs.some((l) => l.event === 'stream.error' && l.message === 'the store restarted')).toBe(true);
    fail = false;
    await t.propose(link.playerId, 'b');
    expect(got).toEqual([1, 2]);
  });

  it('from the slow pass and from a wake-up: no unhandled rejection, the stream goes on', async () => {
    const store = new MemoryRealityStore();
    const t = await tenantBridge(store, { pollMs: 10 });
    const link = await t.pair();
    const got: number[] = [];
    await t.bridge.subscribe(link.capability, (seq) => got.push(seq));
    const listAfter = store.listAfter.bind(store);
    let failures = 0;
    store.listAfter = async (c) => {
      if (failures < 5) {
        failures++;
        throw new Error('busy');
      }
      return listAfter(c);
    };
    await t.propose(link.playerId, 'a');
    await until(() => got.length === 1);
    expect(got).toEqual([1]);
    expect(t.bridge.telemetry.snapshot()['errors:stream']).toBeGreaterThan(1);
    t.bridge.close();
  });
});

describe("V2's audience in a browser", () => {
  const origin = 'https://game.example';
  const expectFor = (playerId: string, audience: string) => ({
    gameId: 'signals',
    playerId,
    signals: new Set(['mail.answer.correct']),
    now: Date.now(),
    audience,
  });

  it('the origin is recorded at pairing even when it is not on the CORS list (a same-origin deployment)', async () => {
    const t = await tenantBridge(new MemoryRealityStore(), { signalVersion: 2 });
    const server = bridgeServer(t.bridge).listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise((ok) => server.once('listening', ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { code } = (await (
      await fetch(`${url}/v1/pairings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ gameId: 'signals' }),
      })
    ).json()) as { code: string };
    await t.bridge.confirmPairing(t.mail, code);
    const link = await t.bridge.claimPairing(code);
    if (link.status !== 'paired') throw new Error('not paired');
    await t.propose(link.playerId, 'a');
    const [s] = await t.bridge.signals(link.capability, 0);
    expect(payloadOf(s!.jws).audience).toBe(origin);
    expect(await verifySignal(s!.jws, await keyring(t.bridge.keys()), expectFor(link.playerId, origin))).toMatchObject({
      ok: true,
    });
  });

  it("a link paired without an origin: the Bridge's own audience, which its keys declare, is accepted", async () => {
    const t = await tenantBridge(new MemoryRealityStore(), {
      signalVersion: 2,
      origins: ['https://elsewhere.example'],
    });
    const link = await t.pair();
    await t.propose(link.playerId, 'a');
    const [s] = await t.bridge.signals(link.capability, 0);
    expect(payloadOf(s!.jws).audience).toBe('bridge.test');
    const keys = await keyring(t.bridge.keys());
    expect((await verifySignal(s!.jws, keys, expectFor(link.playerId, origin))).ok).toBe(true);
    // Under keys that do not declare it (another Bridge's), the same signal is refused.
    const bare = await keyring(
      t.bridge.keys().map(({ kid, raw, tenantId, environment }) => ({ kid, raw, tenantId, environment })),
    );
    expect(await verifySignal(s!.jws, bare, expectFor(link.playerId, origin))).toMatchObject({
      code: 'audience-mismatch',
    });
  });

  it('several origins: each link carries its own; a page of another origin refuses it', async () => {
    const t = await tenantBridge(new MemoryRealityStore(), {
      signalVersion: 2,
      origins: ['https://a.example', 'https://b.example'],
    });
    const link = await t.pair('https://b.example');
    await t.propose(link.playerId, 'a');
    const [s] = await t.bridge.signals(link.capability, 0);
    const keys = await keyring(t.bridge.keys());
    expect((await verifySignal(s!.jws, keys, expectFor(link.playerId, 'https://b.example'))).ok).toBe(true);
    expect(await verifySignal(s!.jws, keys, expectFor(link.playerId, 'https://a.example'))).toMatchObject({
      code: 'audience-mismatch',
    });
  });
});

describe('keys, rotation, claims, quarantine', () => {
  it("a V1 Bridge's keys bind no tenant, so its V1 signals verify; a V2 Bridge's keys do", async () => {
    const v1 = await tenantBridge(new MemoryRealityStore());
    expect(v1.bridge.keys()[0]).toEqual({ kid: 'k1', raw: v1.config.eventKey.raw });
    const link = await v1.pair();
    await v1.propose(link.playerId, 'a');
    const [s] = await v1.bridge.signals(link.capability, 0);
    expect(
      (
        await verifySignal(s!.jws, await keyring(v1.bridge.keys()), {
          gameId: 'signals',
          playerId: link.playerId,
          signals: new Set(['mail.answer.correct']),
          now: Date.now(),
        })
      ).ok,
    ).toBe(true);
    const v2 = await tenantBridge(new MemoryRealityStore(), { tenantId: 'acme' });
    expect(v2.bridge.keys()[0]).toMatchObject({ tenantId: 'acme', environment: 'prod', audience: 'bridge.test' });
  });

  it('a V2 row signed again after a rotation names the key that signs it now', async () => {
    const store = new MemoryRealityStore();
    const before = await tenantBridge(store, { tenantId: 'acme', key: await eventKey('k-old') });
    const link = await before.pair();
    await before.propose(link.playerId, 'a');
    const after = await tenantBridge(store, {
      tenantId: 'acme',
      key: await eventKey('k-new'),
      rootPrivate: before.rootPrivate,
    });
    const [s] = await after.bridge.signals(link.capability, 0);
    expect(JSON.parse(Buffer.from(s!.jws.split('.')[0]!, 'base64url').toString()).kid).toBe('k-new');
    expect(payloadOf(s!.jws)).toMatchObject({ schema: 2, keyId: 'k-new', tenantId: 'acme' });
    expect(after.bridge.resignedCount()).toBe(1);
  });

  it('a claim the store answers `pending` stays pending; `missing` is a 410', async () => {
    const store = new MemoryRealityStore();
    const t = await tenantBridge(store);
    for (const [answer, outcome] of [
      ['pending', { status: 'pending' }],
      ['missing', { status: 410 }],
    ] as const) {
      const { code } = await t.bridge.startPairing('signals');
      await t.bridge.confirmPairing(t.mail, code);
      const claim = store.claimPairing.bind(store);
      store.claimPairing = async () => answer;
      const r = t.bridge.claimPairing(code);
      if (answer === 'pending') await expect(r).resolves.toEqual(outcome);
      else await expect(r).rejects.toMatchObject(outcome);
      store.claimPairing = claim;
    }
  });

  it('a stored row whose payload names another player or sequence is quarantined, never sent', async () => {
    const store = await SqliteRealityStore.open(join(dir, 'rows.sqlite'));
    opened.push(store);
    const t = await tenantBridge(store);
    const link = await t.pair();
    for (const k of ['a', 'b']) await t.propose(link.playerId, k);
    const [row] = await store.db.all('SELECT payload FROM signals WHERE player_id = $1 AND sequence = 1', [
      link.playerId,
    ]);
    const forged = { ...JSON.parse(String(row!.payload)), playerId: 'p-0000000000000000' };
    await store.db.run('UPDATE signals SET payload = $1 WHERE player_id = $2 AND sequence = 1', [
      JSON.stringify(forged),
      link.playerId,
    ]);
    expect((await t.bridge.signals(link.capability, 0)).map((s) => s.sequence)).toEqual([2]);
    expect((await store.quarantined('default'))[0]?.reason).toMatch(/another player/);
  });
});

describe('SQLite under contention', () => {
  it('a store busy longer than busyMs answers 503 with Retry-After; its files are 0600', async () => {
    const file = join(dir, 'busy.sqlite');
    const store = await SqliteRealityStore.open(file, { busyMs: 150 });
    opened.push(store);
    // NTFS has no POSIX mode: Windows keeps the files, not the 0600 (the smoke job runs this file).
    if (process.platform !== 'win32')
      for (const f of [file, `${file}-wal`, `${file}-shm`]) expect(statSync(f).mode & 0o777, f).toBe(0o600);
    const t = await tenantBridge(store);
    const link = await t.pair();
    const server = bridgeServer(t.bridge).listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise((ok) => server.once('listening', ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // Another connection (another process, as far as SQLite knows) holds the write lock.
    const { DatabaseSync } = await import('node:sqlite');
    const other = new DatabaseSync(file);
    other.exec('BEGIN IMMEDIATE');
    const started = Date.now();
    const r = await fetch(`${url}/v1/signals`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t.mail}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: link.playerId, signal: 'mail.answer.correct', source: 'mail', dedupeKey: 'x' }),
    });
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('1');
    expect(Date.now() - started).toBeLessThan(2000);
    other.exec('ROLLBACK');
    other.close();
    await expect(t.propose(link.playerId, 'x')).resolves.toMatchObject({ sequence: 1 });
  });
});

/** A stand-in for `pg`: counts connections, lets a test drop the listening one and fail a ROLLBACK. */
function fakePg() {
  const state = {
    connects: 0,
    released: [] as (Error | undefined)[],
    clients: [] as FakeClient[],
    failRollback: false,
  };
  type FakeClient = {
    handlers: Record<string, (x: never) => void>;
    query(sql: string): Promise<{ rows: never[]; rowCount: number }>;
    release(e?: Error): void;
    on(ev: string, fn: (x: never) => void): void;
  };
  const client = (): FakeClient => {
    const c: FakeClient = {
      handlers: {},
      async query(sql: string) {
        if (sql === 'ROLLBACK' && state.failRollback) throw new Error('connection lost');
        if (sql === 'SELECT boom') throw new Error('boom');
        return { rows: [], rowCount: 0 };
      },
      release: (e?: Error) => void state.released.push(e),
      on(ev, fn) {
        c.handlers[ev] = fn;
      },
    };
    state.clients.push(c);
    return c;
  };
  const mod = {
    Pool: class {
      async query() {
        return { rows: [], rowCount: 0 };
      }
      async connect() {
        state.connects++;
        return client();
      }
      async end() {}
      on() {}
    },
  } as unknown as PgModule;
  return { mod, state };
}

describe('Postgres connections', () => {
  it('listens once whoever watches, and again after the listening connection drops', async () => {
    const { mod, state } = fakePg();
    const store = await PostgresRealityStore.open('postgres://fake', { pg: mod, migrate: false });
    for (const t of ['t-a', 't-b', 't-c']) store.watch(t, () => {});
    await store.listening();
    expect(state.connects).toBe(1);
    const woken: string[] = [];
    store.watch('t-a', (p) => woken.push(p));
    const listener = state.clients[0]!;
    (listener.handlers.notification as (m: { channel: string; payload: string }) => void)({
      channel: 'web_scumm_signals',
      payload: 't-a p-1',
    });
    expect(woken).toEqual(['p-1']);
    const drop = new Error('terminated');
    (listener.handlers.error as (e: Error) => void)(drop);
    expect(state.released).toContain(drop);
    await until(() => state.connects === 2, 2000);
    expect(state.connects).toBe(2);
    await store.close();
  });

  it('a transaction whose ROLLBACK fails releases its client with the error', async () => {
    const { mod, state } = fakePg();
    const store = await PostgresRealityStore.open('postgres://fake', { pg: mod, migrate: false });
    state.failRollback = true;
    await expect(store.db.tx(undefined, (q) => q.exec('SELECT boom'))).rejects.toThrow('boom');
    expect(state.released.at(-1)?.message).toBe('connection lost');
    await store.close();
  });
});

describe('export and restore', () => {
  it('a restore with replace is one transaction: a failing import leaves the tenant as it was; pairings travel', async () => {
    const store = await SqliteRealityStore.open(join(dir, `restore-${randomBytes(3).toString('hex')}.sqlite`));
    opened.push(store);
    const t = await tenantBridge(store, { tenantId: 'acme' });
    const link = await t.pair();
    await t.propose(link.playerId, 'a');
    await t.bridge.startPairing('signals');
    const before = await store.exportTenant('acme');
    expect(before.pairings?.length).toBe(2);
    const broken = { ...before, signals: [...before.signals, ...before.signals] }; // the same row twice
    await expect(store.importTenant(broken, { replace: true })).rejects.toThrow();
    expect(await store.exportTenant('acme')).toEqual(before);
    await store.importTenant(before, { replace: true });
    expect(await store.exportTenant('acme')).toEqual(before);
  });
});

describe('the edges the coverage floor asked for', () => {
  it('a store failure that is not an Error is logged as unknown', async () => {
    const store = new MemoryRealityStore();
    const t = await tenantBridge(store);
    const link = await t.pair();
    await t.bridge.subscribe(link.capability, () => {});
    store.listAfter = async () => {
      throw 'not an error';
    };
    await t.propose(link.playerId, 'a');
    expect(t.logs.some((l) => l.event === 'stream.error' && l.message === 'unknown')).toBe(true);
  });

  it('V2 without a configured environment says prod; a link from before 4.1.10 is its own session', async () => {
    const store = new MemoryRealityStore();
    const t = await tenantBridge(store, { tenantId: 'acme' });
    (t.config as { environment?: string }).environment = undefined;
    expect(t.bridge.keys()[0]).toMatchObject({ environment: 'prod' });
    const link = await t.pair();
    const p = await store.player('acme', link.playerId);
    const { sessionId: _, ...old } = p!;
    await store.putPlayer('acme', old);
    await t.propose(link.playerId, 'a');
    const [s] = await t.bridge.signals(link.capability, 0);
    expect(payloadOf(s!.jws)).toMatchObject({ environment: 'prod', sessionId: link.playerId });
  });

  it('a confirmation another instance won is a 409; a claim whose player is gone carries no session', async () => {
    const store = new MemoryRealityStore();
    const t = await tenantBridge(store);
    const { code } = await t.bridge.startPairing('signals');
    const confirm = store.confirmPairing.bind(store);
    store.confirmPairing = async () => false;
    await expect(t.bridge.confirmPairing(t.mail, code)).rejects.toMatchObject({ status: 409 });
    store.confirmPairing = confirm;
    await t.bridge.confirmPairing(t.mail, code);
    const player = store.player.bind(store);
    store.player = async () => undefined;
    const r = await t.bridge.claimPairing(code);
    store.player = player;
    expect(r).toMatchObject({ status: 'paired' });
    expect(r).not.toHaveProperty('sessionId');
  });

  it('a stored payload that is not a world signal is quarantined', async () => {
    const store = await SqliteRealityStore.open(join(dir, 'payload.sqlite'));
    opened.push(store);
    const t = await tenantBridge(store);
    const link = await t.pair();
    for (const k of ['a', 'b']) await t.propose(link.playerId, k);
    await store.db.run('UPDATE signals SET payload = $1 WHERE player_id = $2 AND sequence = 2', [
      JSON.stringify({ schema: 1, format: 'nope' }),
      link.playerId,
    ]);
    expect((await t.bridge.signals(link.capability, 0)).map((s) => s.sequence)).toEqual([1]);
    expect((await store.quarantined('default'))[0]?.reason).toBe('payload is not a world signal');
  });
});
