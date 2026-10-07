// Two tenants on one store (4.1.10, docs/dev/threat-models/constellation.md): every operation of one tenant that
// names the other's player, capability, code or operator token is refused, and leaves the other tenant as it was
// (a property, fast-check, over memory, SQLite, and Postgres with BRIDGE_PG_URL); a connector's token bound to its
// tenant is refused by another even with one Biscuit root; a V2 signal of one tenant is refused by the other's
// keyring even with one event key; quotas and rotations are each tenant's own; the server routes by `Host`.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { importBridgeKey, verifySignal } from '@engine/reality/protocol';
import { bridgeServer } from '../bridge/src/server';
import type { RealityStore } from '../bridge/src/store-async';
import { MemoryRealityStore } from '../bridge/src/store-memory';
import { type PgModule, PostgresRealityStore } from '../bridge/src/store-postgres';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';
import { eventKey, tenantBridge } from './fixtures/bridge-tenant';

const dir = mkdtempSync(join(tmpdir(), 'bridge-tenancy-'));
const opened: RealityStore[] = [];
const servers: { close(): void }[] = [];
afterAll(async () => {
  for (const s of servers) s.close();
  for (const s of opened) await s.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

const STORES: { name: string; open: () => Promise<RealityStore> }[] = [
  { name: 'memory', open: async () => new MemoryRealityStore() },
  {
    name: 'sqlite',
    open: async () => {
      const s = await SqliteRealityStore.open(join(dir, `${randomBytes(4).toString('hex')}.sqlite`));
      opened.push(s);
      return s;
    },
  },
];
if (process.env.BRIDGE_PG_URL)
  STORES.push({
    name: 'postgres',
    open: async () => {
      const pg = ((await import(/* @vite-ignore */ process.env.BRIDGE_PG_MODULE ?? 'pg')) as { default: PgModule })
        .default;
      const s = await PostgresRealityStore.open(process.env.BRIDGE_PG_URL!, { pg });
      opened.push(s);
      return s;
    },
  });

const tid = () => `t-${randomBytes(4).toString('hex')}`;
const refused = (status: number) => [401, 403, 404, 410].includes(status);

describe.each(STORES)('two tenants on one $name store', ({ open }) => {
  it('every operation naming the other tenant is refused and changes nothing there (property)', async () => {
    const store = await open();
    type Op = { actor: 0 | 1; cross: boolean; kind: number; n: number };
    const ops = fc.array(
      fc.record({
        actor: fc.constantFrom<0 | 1>(0, 1),
        cross: fc.boolean(),
        kind: fc.integer({ min: 0, max: 10 }),
        n: fc.integer({ min: 0, max: 3 }),
      }),
      { minLength: 1, maxLength: 12 },
    );
    await fc.assert(
      fc.asyncProperty(ops, async (list: Op[]) => {
        const t = [await tenantBridge(store, { tenantId: tid() }), await tenantBridge(store, { tenantId: tid() })];
        const links = [await t[0]!.pair(), await t[1]!.pair()];
        const codes = [await t[0]!.bridge.startPairing('signals'), await t[1]!.bridge.startPairing('signals')];
        await t[0]!.propose(links[0]!.playerId, 'seed');
        await t[1]!.propose(links[1]!.playerId, 'seed');
        const snapshot = (i: number) => store.exportTenant(t[i]!.tenantId);
        for (const op of list) {
          const me = t[op.actor]!;
          const target = op.cross ? 1 - op.actor : op.actor;
          const other = 1 - op.actor;
          const link = links[target]!;
          const before = await snapshot(other);
          const run = (): Promise<unknown> => {
            switch (op.kind) {
              case 0:
                return me.propose(link.playerId, `k${op.n}`);
              case 1:
                // The other tenant's connector token, at my Bridge, for the player named.
                return me.bridge.propose(t[other]!.mail, {
                  playerId: link.playerId,
                  signal: 'mail.answer.correct',
                  source: 'mail',
                  dedupeKey: `x${op.n}`,
                });
              case 2:
                return me.bridge.signals(link.capability, 0);
              case 3:
                return me.bridge.ack(link.capability, 1);
              case 4:
                return me.bridge.subscribe(link.capability, () => {}).then((off) => off());
              case 5:
                return me.bridge.exportPlayer(me.admin, link.playerId);
              case 6:
                return me.bridge.revoke(me.admin, { playerId: link.playerId });
              case 7:
                return me.bridge.forgetPlayer(me.admin, link.playerId);
              case 8:
                // The other tenant's operator token, at my Bridge.
                return me.bridge.exportPlayer(t[other]!.admin, link.playerId);
              case 9:
                return me.bridge.claimPairing(codes[target]!.code);
              default:
                return me.bridge.unlink(link.capability);
            }
          };
          const crossing = op.cross || op.kind === 1 || op.kind === 8;
          const outcome = await run().then(
            () => 200,
            (e: { status?: number }) => e.status ?? 500,
          );
          // Named the other tenant (its player, capability, code, connector token or operator token): refused.
          if (crossing) expect(refused(outcome), `kind ${op.kind}: ${outcome}`).toBe(true);
          // Within a tenant, an operation succeeds or is refused as the Bridge refuses; never a crash.
          else expect(outcome, `kind ${op.kind}`).not.toBe(500);
          // Whatever happened, the tenant not acting is as it was.
          expect(await snapshot(other)).toEqual(before);
        }
      }),
      { numRuns: 12 },
    );
  });

  it('quotas and keys are each tenant’s own', async () => {
    const store = await open();
    const a = await tenantBridge(store, { tenantId: tid(), limits: { perMinutePerConnector: 1 } });
    const b = await tenantBridge(store, { tenantId: tid() });
    const pa = await a.pair();
    const pb = await b.pair();
    await a.propose(pa.playerId, 'one');
    await expect(a.propose(pa.playerId, 'two')).rejects.toMatchObject({ status: 429 });
    for (const k of ['one', 'two', 'three']) await b.propose(pb.playerId, k);
    expect((await store.keys(a.tenantId)).map((k) => k.keyId)).toEqual([a.config.eventKey.kid]);
    await store.rotateKeys({ tenantId: b.tenantId, keyId: 'k-new', publicKey: 'raw' });
    expect((await store.keys(a.tenantId)).map((k) => k.keyId)).toEqual([a.config.eventKey.kid]);
    expect((await store.keys(b.tenantId)).map((k) => k.keyId).sort()).toEqual(['k-new', b.config.eventKey.kid].sort());
    // A revocation in one tenant is not one in the other, even for a token id both happen to know.
    await a.bridge.revoke(a.admin, { tokenId: 'ab'.repeat(16) });
    expect(await store.tokenRevoked(b.tenantId, 'ab'.repeat(16))).toBe(false);
  });
});

describe('one root or one key shared by two tenants (a misconfiguration)', () => {
  it('a connector token bound to its tenant is refused by the other, even with the same Biscuit root', async () => {
    const store = new MemoryRealityStore();
    const a = await tenantBridge(store, { tenantId: 'tenant-a', bindToken: true });
    const b = await tenantBridge(store, { tenantId: 'tenant-b', rootPrivate: a.rootPrivate, bindToken: true });
    const pb = await b.pair();
    await expect(b.propose(pb.playerId, 'own')).resolves.toMatchObject({ sequence: 1 });
    await expect(b.propose(pb.playerId, 'foreign', a.mail)).rejects.toMatchObject({ status: 403 });
  });

  it("tenant A's signal, re-presented to tenant B's player with the same event key, is refused", async () => {
    const store = new MemoryRealityStore();
    const key = await eventKey('k-shared');
    const a = await tenantBridge(store, { tenantId: 'tenant-a', key, origins: ['https://game.example'] });
    const b = await tenantBridge(store, { tenantId: 'tenant-b', key, origins: ['https://game.example'] });
    const pa = await a.pair('https://game.example');
    await a.propose(pa.playerId, 'one');
    const [signal] = await a.bridge.signals(pa.capability, 0);
    const keyring = async (bridge: typeof a.bridge) =>
      Promise.all(bridge.keys().map(({ kid, raw, ...w }) => importBridgeKey(kid, raw, w as never)));
    const expect0 = {
      gameId: 'signals',
      playerId: pa.playerId,
      signals: new Set(['mail.answer.correct']),
      now: Date.now(),
      versions: [2] as const,
      audience: 'https://game.example',
    };
    expect((await verifySignal(signal!.jws, await keyring(a.bridge), { ...expect0, tenantId: 'tenant-a' })).ok).toBe(
      true,
    );
    expect(await verifySignal(signal!.jws, await keyring(b.bridge), expect0)).toMatchObject({
      code: 'audience-mismatch',
    });
    expect(
      await verifySignal(signal!.jws, await keyring(a.bridge), { ...expect0, tenantId: 'tenant-b' }),
    ).toMatchObject({ code: 'audience-mismatch' });
  });
});

describe('one server, several tenants', () => {
  it('routes by Host, by the tenant header when allowed, and answers 404 to an unknown tenant', async () => {
    const store = new MemoryRealityStore();
    const a = await tenantBridge(store, { tenantId: 'tenant-a', hosts: ['a.bridge.test'] });
    const b = await tenantBridge(store, { tenantId: 'tenant-b', hosts: ['b.bridge.test'] });
    for (const tenantHeader of [false, true]) {
      const server = bridgeServer([a.bridge, b.bridge], { tenantHeader }).listen(0, '127.0.0.1');
      servers.push(server);
      await new Promise((ok) => server.once('listening', ok));
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const port = (server.address() as AddressInfo).port;
      const keys = (headers: Record<string, string>) =>
        new Promise<string | number>((ok, ko) => {
          const r = request({ host: '127.0.0.1', port, path: '/v1/keys', headers }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () =>
              ok(
                res.statusCode === 200
                  ? (JSON.parse(body) as { keys: { tenantId: string }[] }).keys[0]!.tenantId
                  : res.statusCode!,
              ),
            );
          });
          r.on('error', ko);
          r.end();
        });
      expect(await keys({ Host: 'a.bridge.test' })).toBe('tenant-a');
      expect(await keys({ Host: 'B.bridge.test:8787' })).toBe('tenant-b');
      expect(await keys({ Host: 'c.bridge.test', 'X-Web-Scumm-Tenant': 'tenant-b' })).toBe(
        tenantHeader ? 'tenant-b' : 404,
      );
      expect(await keys({ Host: 'c.bridge.test' })).toBe(404);
      expect((await fetch(`${url}/livez`)).status).toBe(200);
      expect(await (await fetch(`${url}/readyz`)).json()).toEqual({ status: 'ok' });
    }
  });
});
