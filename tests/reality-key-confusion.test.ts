// Key confusion between tenants (4.1.10, ADR 0010, docs/dev/threat-models/constellation.md §1): one raw signing key
// shared by two tenants, the misconfiguration a hosted deployment invites. A V1 signal of tenant A verifies at tenant
// B when the game and the player match; a V2 signal names its tenant, environment, origin, link and key, and B's
// player refuses it (`audience-mismatch`). The SignalV2 vectors (bridge/test-vectors/signal-v2/conformance.json) are
// checked here in JavaScript and by `npm run reality:xcheck` in Rust.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  importBridgeKey,
  type SignalExpectation,
  signSignal,
  verifySignal,
  type WorldSignalV1,
  type WorldSignalV2,
} from '@engine/reality/protocol';

const NOW = Date.UTC(2026, 9, 7, 12);
const v1: WorldSignalV1 = {
  format: 'web-scumm-world-signal',
  schema: 1,
  id: 's-1',
  sequence: 1,
  gameId: 'signals',
  playerId: 'p-0123456789abcdef',
  signal: 'mail.answer.correct',
  source: 'mail',
  receivedAt: NOW,
  dedupeKey: 'mail:1',
  policyVersion: '1',
};
const v2 = (o: Partial<WorldSignalV2> = {}): WorldSignalV2 => ({
  ...v1,
  schema: 2,
  tenantId: 'tenant-a',
  environment: 'prod',
  audience: 'https://game.example',
  sessionId: 'sess-1',
  keyId: 'k-shared',
  ...o,
});

async function sharedKey() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  return { priv: kp.privateKey, raw };
}

describe('a signal of one tenant presented to another, with the same key', () => {
  it('V1 cannot tell the tenants apart (why V2 exists): accepted only under a key bound to no tenant', async () => {
    const k = await sharedKey();
    const jws = await signSignal(v1, k.priv, 'k-shared');
    const tenantB = [await importBridgeKey('k-shared', k.raw, { tenantId: 'tenant-b', environment: 'prod' })];
    const expectB: SignalExpectation = {
      gameId: 'signals',
      playerId: v1.playerId,
      signals: new Set(['mail.answer.correct']),
      now: NOW,
    };
    // Under a key that names no tenant (a 4.1.9 Bridge), the replay verifies: nothing in V1 tells the tenants apart.
    const unbound = [await importBridgeKey('k-shared', k.raw)];
    expect((await verifySignal(jws, unbound, expectB)).ok).toBe(true);
    // A key bound to a tenant signs V2 only: the same V1 signal is refused under it.
    expect(await verifySignal(jws, tenantB, expectB)).toMatchObject({ code: 'schema' });
    // A player that knows it talks to a multi-tenant Bridge accepts V2 only, whatever the key.
    expect(await verifySignal(jws, unbound, { ...expectB, versions: [2] })).toMatchObject({ code: 'schema' });
  });

  it('V2 is refused by the other tenant: by its key, by its expectation, by both', async () => {
    const k = await sharedKey();
    const jws = await signSignal(v2(), k.priv, 'k-shared');
    const base = { gameId: 'signals', playerId: v1.playerId, signals: new Set(['mail.answer.correct']), now: NOW };
    const keyOf = (tenantId?: string) =>
      importBridgeKey('k-shared', k.raw, tenantId ? { tenantId, environment: 'prod' } : {});
    // Tenant A's own player accepts it.
    expect((await verifySignal(jws, [await keyOf('tenant-a')], { ...base, tenantId: 'tenant-a' })).ok).toBe(true);
    // Tenant B's keyring binds the shared key to B.
    expect(await verifySignal(jws, [await keyOf('tenant-b')], base)).toMatchObject({ code: 'audience-mismatch' });
    // A keyring without tenants: B's player expects B.
    expect(await verifySignal(jws, [await keyOf()], { ...base, tenantId: 'tenant-b' })).toMatchObject({
      code: 'audience-mismatch',
    });
    // Another origin, another link, another environment: each refused.
    for (const o of [{ audience: 'https://other.example' }, { sessionId: 'sess-2' }, { environment: 'dev' as const }])
      expect(await verifySignal(jws, [await keyOf()], { ...base, ...o })).toMatchObject({ code: 'audience-mismatch' });
    // A `keyId` naming another key than the one that signed: refused before the context is read.
    const renamed = await signSignal(v2({ keyId: 'k-other' }), k.priv, 'k-shared');
    expect(await verifySignal(renamed, [await keyOf('tenant-a')], base)).toMatchObject({ code: 'key' });
  });
});

const vectors = JSON.parse(readFileSync('bridge/test-vectors/signal-v2/conformance.json', 'utf8')) as {
  keys: { kid: string; raw: string; tenantId?: string; environment?: 'prod' }[];
  expect: Record<string, unknown> & { signals: string[] };
  cases: { name: string; jws: string; verdict: string; expect?: Record<string, unknown> }[];
};

describe('the SignalV2 vectors', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    const keyring = await Promise.all(vectors.keys.map(({ kid, raw, ...w }) => importBridgeKey(kid, raw, w)));
    const merged: Record<string, unknown> = { ...vectors.expect, ...c.expect };
    for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
    const r = await verifySignal(c.jws, keyring, {
      ...(merged as unknown as SignalExpectation),
      signals: new Set(vectors.expect.signals),
    });
    expect(r.ok ? 'ok' : r.code).toBe(c.verdict);
  });

  it('cover the refusals V2 adds', () => {
    const codes = new Set(vectors.cases.map((c) => c.verdict));
    for (const c of ['ok', 'schema', 'key', 'audience-mismatch', 'payload', 'player'])
      expect(codes.has(c), c).toBe(true);
  });
});
