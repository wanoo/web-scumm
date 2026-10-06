// The reference Bridge (4.1.1, bridge/src/), over real HTTP on a free port: pairing, signals proposed under a
// Biscuit or by a signed webhook, deduplication, the fetch by cursor and SSE, acknowledgements, revocation, quotas,
// sizes, export and deletion by player, a restart on its journal, and a log with no secret.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { manifestHash, realityManifest } from '@engine/reality/manifest';
import { importBridgeKey } from '@engine/reality/protocol';
import { RealityClient } from '@engine/reality/client';
import { httpPort } from '@engine/reality/http-port';
import { Bridge, type BridgeConfig, type BridgeLog } from '../bridge/src/bridge';
import { biscuitLib } from '../bridge/src/biscuit';
import { grantToken } from '../bridge/src/policy';
import { bridgeServer, webhookSignature } from '../bridge/src/server';
import { JsonlBridgeStore, MemoryBridgeStore, type BridgeStore } from '../bridge/src/store';
import { signals, signalsLayouts } from './fixtures/signals';
import { createHash } from 'node:crypto';

const temps: string[] = [];
const servers: { close(): void }[] = [];
afterAll(() => {
  for (const s of servers) s.close();
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

async function setup(o: { store?: BridgeStore; limits?: BridgeConfig['limits']; now?: () => number } = {}) {
  const b = await biscuitLib();
  const root = new b.KeyPair(b.SignatureAlgorithm.Ed25519);
  const ev = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', ev.publicKey)).toString('base64url');
  const manifest = realityManifest(signals())!;
  const admin = 'operator-secret-token';
  const logs: BridgeLog[] = [];
  const config: BridgeConfig = {
    gameId: 'signals',
    manifest,
    manifestHash: await manifestHash(manifest),
    audience: 'bridge.test',
    biscuitRootPublicKey: root.getPublicKey().toString(),
    eventKey: { kid: 'k1', privateKey: ev.privateKey, raw },
    adminTokenHash: createHash('sha256').update(admin).digest('hex'),
    policyVersion: '1',
    ...(o.limits ? { limits: o.limits } : {}),
  };
  const bridge = await Bridge.start(config, o.store ?? new MemoryBridgeStore(), {
    log: (l) => logs.push(l),
    ...(o.now ? { now: o.now } : {}),
  });
  const mail = await grantToken(root.getPrivateKey().toString(), {
    connector: 'mail-1',
    gameId: 'signals',
    sources: ['mail'],
    signals: ['mail.answer.correct', 'mail.answer.wrong'],
    players: 'any',
    audience: 'bridge.test',
    pair: true,
    expiresAt: Date.now() + 3_600_000,
  });
  const hookSecret = 'hook-secret';
  const hookToken = await grantToken(root.getPrivateKey().toString(), {
    connector: 'hook',
    gameId: 'signals',
    sources: ['webhook'],
    signals: ['hook.bell'],
    players: 'any',
    audience: 'bridge.test',
    expiresAt: Date.now() + 3_600_000,
  });
  const server = bridgeServer(bridge, {
    origins: ['http://game.test'],
    webhooks: { webhook: { secret: hookSecret, token: hookToken, source: 'webhook', map: { bell: 'hook.bell' } } },
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const call = (path: string, init: RequestInit & { token?: string } = {}) =>
    fetch(new URL(path, url), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.headers as Record<string, string>),
      },
    });
  const pair = async () => {
    const { code } = (await (
      await call('v1/pairings', { method: 'POST', body: JSON.stringify({ gameId: 'signals' }) })
    ).json()) as { code: string };
    expect(await (await call(`v1/pairings/${code}`)).json()).toEqual({ status: 'pending' });
    expect((await call(`v1/pairings/${code}/confirm`, { method: 'POST', token: mail })).status).toBe(200);
    return (await (await call(`v1/pairings/${code}`)).json()) as {
      status: string;
      playerId: string;
      capability: string;
    };
  };
  const propose = (playerId: string, signal: string, dedupeKey: string, token = mail) =>
    call('v1/signals', {
      method: 'POST',
      token,
      body: JSON.stringify({
        playerId,
        signal,
        source: signal.split('.')[0] === 'hook' ? 'webhook' : 'mail',
        dedupeKey,
      }),
    });
  return {
    bridge,
    url,
    call,
    pair,
    propose,
    mail,
    admin,
    logs,
    hookSecret,
    raw,
    rootPub: root.getPublicKey().toString(),
  };
}

describe('the reference Bridge', () => {
  it('pairs a game, accepts a signal once, delivers it by cursor, takes the acknowledgement', async () => {
    const t = await setup();
    const link = await t.pair();
    expect(link.status).toBe('paired');
    expect(link.playerId).toMatch(/^p-[a-f0-9]{16}$/);
    // The capability is handed over once.
    expect((await t.call(`v1/pairings/${'X'.repeat(8)}`)).status).toBe(404);
    const first = await t.propose(link.playerId, 'mail.answer.correct', 'mail:42');
    expect(first.status).toBe(202);
    const again = await t.propose(link.playerId, 'mail.answer.correct', 'mail:42');
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ sequence: 1, duplicate: true });
    const got = (await (await t.call('v1/signals?after=0', { token: link.capability })).json()) as {
      signals: string[];
    };
    expect(got.signals).toHaveLength(1);
    expect(
      (await t.call('v1/ack', { method: 'POST', token: link.capability, body: JSON.stringify({ through: 1 }) })).status,
    ).toBe(204);
    expect(
      (await t.call('v1/ack', { method: 'POST', token: link.capability, body: JSON.stringify({ through: 9 }) })).status,
    ).toBe(400);
    expect((await t.call('v1/signals?after=0', { token: 'not-a-capability' })).status).toBe(401);
  });

  it('refuses what the manifest or the token does not allow', async () => {
    const t = await setup();
    const link = await t.pair();
    expect((await t.propose(link.playerId, 'mail.admin.reset', 'x')).status).toBe(422);
    expect((await t.propose(link.playerId, 'hook.bell', 'x')).status).toBe(403); // the mail token has no hook.bell
    expect((await t.propose('p-0000000000000000', 'mail.answer.correct', 'x')).status).toBe(404);
    expect((await t.propose(link.playerId, 'mail.answer.correct', 'x', 'garbage')).status).toBe(401);
    expect(t.logs.filter((l) => l.event === 'signal.refused').length).toBeGreaterThan(0);
  });

  it('turns a signed webhook into its signal, once per delivery id; a bad signature is refused', async () => {
    const t = await setup();
    const link = await t.pair();
    const body = JSON.stringify({ playerId: link.playerId, event: 'bell', id: 'delivery-1' });
    const hook = (b: string, sig = webhookSignature(t.hookSecret, b)) =>
      t.call('v1/hooks/webhook', { method: 'POST', body: b, headers: { 'X-Web-Scumm-Signature': sig } });
    expect((await hook(body)).status).toBe(202);
    expect((await hook(body)).status).toBe(200);
    expect((await hook(body, webhookSignature('wrong', body))).status).toBe(401);
    expect((await hook(JSON.stringify({ playerId: link.playerId, event: 'shutdown', id: 'd2' }))).status).toBe(422);
  });

  it('a game plays through the Bridge: SSE and poll give the same signals, applied once, acknowledged', async () => {
    const t = await setup();
    const link = await t.pair();
    await t.propose(link.playerId, 'mail.answer.correct', 'mail:1');
    await t.propose(link.playerId, 'mail.answer.wrong', 'mail:2');
    const keys = await Promise.all(
      ((await (await t.call('v1/keys')).json()) as { keys: { kid: string; raw: string }[] }).keys.map((k) =>
        importBridgeKey(k.kid, k.raw),
      ),
    );
    for (const mode of ['sse', 'poll'] as const) {
      const e = new Engine(signals(), signalsLayouts, new FakePresenter(), new MemoryStore());
      await e.newGame();
      const port = httpPort({ url: t.url, capability: link.capability, mode, retryMs: 20 });
      const c = new RealityClient({
        engine: e,
        store: new MemoryStore(),
        port,
        keyring: keys,
        playerId: link.playerId,
      });
      const run = c.run();
      for (let i = 0; i < 100 && (e.state.reality?.cursor ?? 0) < 2; i++) await new Promise((r) => setTimeout(r, 20));
      await c.stop();
      await run;
      expect(e.state.reality?.cursor, mode).toBe(2);
      expect(e.state.flags.vault_open, mode).toBe(true);
    }
    expect(t.bridge.exportPlayer(t.admin, link.playerId).acked).toBe(2);
  });

  it('the operator revokes a player and a token, exports and deletes what the Bridge holds', async () => {
    const t = await setup();
    const link = await t.pair();
    await t.propose(link.playerId, 'mail.answer.correct', 'mail:1');
    const exp = (await (await t.call(`v1/admin/players/${link.playerId}`, { token: t.admin })).json()) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(exp)).not.toMatch(/capabilityHash/);
    expect(JSON.stringify(exp)).not.toContain(link.capability);
    expect((exp.signals as unknown[]).length).toBe(1);
    expect((await t.call(`v1/admin/players/${link.playerId}`, { token: 'nope' })).status).toBe(401);
    const b = await biscuitLib();
    const tok = b.Biscuit.fromBase64(
      t.mail,
      b.PublicKey.fromString(t.rootPub.replace(/^ed25519\//, ''), b.SignatureAlgorithm.Ed25519),
    );
    const tokenId = (tok.getRevocationIdentifiers() as string[])[0]!;
    expect(
      (await t.call('v1/admin/revoke', { method: 'POST', token: t.admin, body: JSON.stringify({ tokenId }) })).status,
    ).toBe(204);
    expect((await t.propose(link.playerId, 'mail.answer.wrong', 'mail:2')).status).toBe(401);
    expect(
      (
        await t.call('v1/admin/revoke', {
          method: 'POST',
          token: t.admin,
          body: JSON.stringify({ playerId: link.playerId }),
        })
      ).status,
    ).toBe(204);
    expect((await t.call('v1/signals?after=0', { token: link.capability })).status).toBe(401);
    expect((await t.call(`v1/admin/players/${link.playerId}`, { method: 'DELETE', token: t.admin })).status).toBe(204);
    expect((await t.call(`v1/admin/players/${link.playerId}`, { token: t.admin })).status).toBe(404);
  });

  it('holds its limits: body size, a quota per connector, signals waiting per player', async () => {
    const t = await setup({ limits: { perMinutePerConnector: 3, pendingPerPlayer: 2 } });
    const link = await t.pair();
    expect((await t.call('v1/signals', { method: 'POST', token: t.mail, body: 'x'.repeat(9000) })).status).toBe(413);
    expect((await t.propose(link.playerId, 'mail.answer.correct', 'a')).status).toBe(202);
    expect((await t.propose(link.playerId, 'mail.answer.wrong', 'b')).status).toBe(202);
    expect((await t.propose(link.playerId, 'mail.answer.wrong', 'c')).status).toBe(429); // two waiting
    await t.call('v1/ack', { method: 'POST', token: link.capability, body: JSON.stringify({ through: 2 }) });
    expect((await t.propose(link.playerId, 'mail.answer.wrong', 'd')).status).toBe(202);
    expect((await t.propose(link.playerId, 'mail.answer.wrong', 'e')).status).toBe(429); // three this minute
  });

  it('sequences concurrent proposals one by one: no shared sequence, one acceptance per dedupeKey', async () => {
    // 4.1.1 awaited the Biscuit check and the signature between reading the last sequence and writing the journal:
    // concurrent proposals all took sequence 1, and the player's client then skipped them as already seen.
    const t = await setup();
    const link = await t.pair();
    const body = (dedupeKey: string) => ({
      playerId: link.playerId,
      signal: 'mail.answer.wrong',
      source: 'mail',
      dedupeKey,
    });
    const distinct = await Promise.all(Array.from({ length: 100 }, (_, i) => t.bridge.propose(t.mail, body(`m:${i}`))));
    expect(distinct.every((r) => !r.duplicate)).toBe(true);
    expect(new Set(distinct.map((r) => r.sequence)).size).toBe(100);
    expect(t.bridge.signals(link.capability, 0).map((s) => s.sequence)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    const same = await Promise.all(Array.from({ length: 50 }, () => t.bridge.propose(t.mail, body('once'))));
    expect(same.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(same.map((r) => r.id)).size).toBe(1);
    expect(t.bridge.signals(link.capability, 100)).toHaveLength(1);
  });

  it('a proposal that overlaps a revocation is refused; a code confirmed twice at once is confirmed once', async () => {
    const t = await setup();
    const link = await t.pair();
    const inFlight = t.bridge.propose(t.mail, {
      playerId: link.playerId,
      signal: 'mail.answer.correct',
      source: 'mail',
      dedupeKey: 'late',
    });
    t.bridge.revoke(t.admin, { playerId: link.playerId }); // lands while the proposal awaits its Biscuit check
    await expect(inFlight).rejects.toMatchObject({ status: 404 });
    expect(t.bridge.exportPlayer(t.admin, link.playerId).signals).toHaveLength(0);
    const { code } = t.bridge.startPairing('signals');
    const both = await Promise.allSettled([
      t.bridge.confirmPairing(t.mail, code),
      t.bridge.confirmPairing(t.mail, code),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = both.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    const claimed = t.bridge.claimPairing(code);
    expect(claimed.status).toBe('paired');
    const confirmed = both.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ playerId: string }>;
    expect(claimed.status === 'paired' && claimed.playerId).toBe(confirmed.value.playerId);
  });

  it('answers CORS for the game only, and logs no secret', async () => {
    const t = await setup();
    const ok = await t.call('v1/keys', { headers: { Origin: 'http://game.test' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://game.test');
    const other = await t.call('v1/keys', { headers: { Origin: 'http://evil.test' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const link = await t.pair();
    await t.propose(link.playerId, 'mail.answer.correct', 'secret-dedupe-key');
    const all = JSON.stringify(t.logs);
    expect(all).not.toContain(link.capability);
    expect(all).not.toContain(t.mail);
    expect(all).not.toContain('secret-dedupe-key');
    expect(all).not.toContain(t.admin);
  });

  it('starts only on the manifest it was configured with', async () => {
    const t = await setup();
    const g = signals();
    g.reality!.signals[0]!.id = 'mail.answer.right';
    await expect(
      Bridge.start({ ...t.bridge.config, manifest: realityManifest(g)! }, new MemoryBridgeStore()),
    ).rejects.toThrow(/not the one configured/);
  });

  it('a restart replays its journal; forgetting a player removes it from the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-'));
    temps.push(dir);
    const file = join(dir, 'journal.jsonl');
    const t = await setup({ store: new JsonlBridgeStore(file) });
    const link = await t.pair();
    await t.propose(link.playerId, 'mail.answer.correct', 'mail:1');
    const again = await Bridge.start(t.bridge.config, new JsonlBridgeStore(file), { log: () => {} });
    expect(again.signals(link.capability, 0)).toHaveLength(1);
    expect(readFileSync(file, 'utf8')).not.toContain(link.capability);
    again.forgetPlayer(t.admin, link.playerId);
    expect(readFileSync(file, 'utf8')).not.toContain(link.playerId);
    expect(() => new JsonlBridgeStore(file).player(link.playerId)).not.toThrow();
    expect(new JsonlBridgeStore(file).player(link.playerId)).toBeUndefined();
  });
});

describe('web-scumm bridge init', () => {
  it('writes a configuration only its owner reads, from which a Bridge starts', async () => {
    const { main, loadBridge } = await import('../bridge/src/cli');
    const { statSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'bridge-init-'));
    temps.push(dir);
    const log = console.log;
    console.log = () => {};
    try {
      expect(await main(['init', `--dir=${dir}`], { manifest: realityManifest(signals()) })).toBe(0);
      expect(await main(['init', `--dir=${dir}`], { manifest: realityManifest(signals()) })).toBe(1); // no silent overwrite
    } finally {
      console.log = log;
    }
    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'admin-token')).mode & 0o777).toBe(0o600);
    const file = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(Object.keys(file.webhooks).sort()).toEqual(['mail', 'webhook']);
    const bridge = await loadBridge(file, dir);
    expect(bridge.keys()[0]!.kid).toBe(file.eventKey.kid);
    console.log = () => {};
    try {
      expect(await main(['rotate', `--dir=${dir}`, '--keep-days=2'])).toBe(0);
    } finally {
      console.log = log;
    }
    const rotated = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(rotated.eventKey.kid).not.toBe(file.eventKey.kid);
    expect(rotated.previousKeys[0].kid).toBe(file.eventKey.kid);
    expect((await loadBridge(rotated, dir)).keys().map((k) => k.kid)).toEqual([
      rotated.eventKey.kid,
      file.eventKey.kid,
    ]);
  });
});
