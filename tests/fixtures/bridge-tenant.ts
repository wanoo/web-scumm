// One tenant's Bridge over a given store, for the tests of 4.1.10 (tenancy, fan-out, operations): its own Biscuit
// root, event key (or one passed in, to share a key between tenants on purpose), operator token and connector token.
import { createHash } from 'node:crypto';
import { manifestHash, realityManifest } from '@engine/reality/manifest';
import { biscuitLib } from '../../bridge/src/biscuit';
import { Bridge, type BridgeConfig, type BridgeLog } from '../../bridge/src/bridge';
import { grantToken } from '../../bridge/src/policy';
import type { RealityStore } from '../../bridge/src/store-async';
import type { Telemetry } from '../../bridge/src/telemetry';
import { signals } from './signals';

export type EventKey = { kid: string; privateKey: CryptoKey; raw: string };

export async function eventKey(kid = 'k1'): Promise<EventKey> {
  const ev = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', ev.publicKey)).toString('base64url');
  return { kid, privateKey: ev.privateKey, raw };
}

export async function tenantBridge(
  store: RealityStore,
  o: {
    tenantId?: string;
    key?: EventKey;
    rootPrivate?: string;
    limits?: BridgeConfig['limits'];
    signalVersion?: 1 | 2;
    origins?: string[];
    hosts?: string[];
    telemetry?: Telemetry;
    pollMs?: number;
    /** Bind the connector's token to this tenant (a check in its authority block). */
    bindToken?: boolean;
  } = {},
) {
  const b = await biscuitLib();
  const root = o.rootPrivate
    ? b.KeyPair.fromPrivateKey(b.PrivateKey.fromString(o.rootPrivate))
    : new b.KeyPair(b.SignatureAlgorithm.Ed25519);
  const rootPrivate = root.getPrivateKey().toString();
  const manifest = realityManifest(signals())!;
  const tenantId = o.tenantId ?? 'default';
  const admin = `operator-of-${tenantId}`;
  const logs: BridgeLog[] = [];
  const config: BridgeConfig = {
    tenantId,
    signalVersion: o.signalVersion ?? (tenantId === 'default' ? 1 : 2),
    environment: 'prod',
    ...(o.origins ? { origins: o.origins } : {}),
    ...(o.hosts ? { hosts: o.hosts } : {}),
    gameId: 'signals',
    manifest,
    manifestHash: await manifestHash(manifest),
    audience: 'bridge.test',
    biscuitRootPublicKey: root.getPublicKey().toString(),
    eventKey: o.key ?? (await eventKey()),
    adminTokenHash: createHash('sha256').update(admin).digest('hex'),
    policyVersion: '1',
    ...(o.limits ? { limits: o.limits } : {}),
  };
  const bridge = await Bridge.start(config, store, {
    log: (l) => logs.push(l),
    ...(o.telemetry ? { telemetry: o.telemetry } : {}),
    pollMs: o.pollMs ?? 0,
  });
  const mail = await grantToken(rootPrivate, {
    connector: `mail-${tenantId}`,
    gameId: 'signals',
    sources: ['mail'],
    signals: ['mail.answer.correct', 'mail.answer.wrong'],
    players: 'any',
    audience: 'bridge.test',
    pair: true,
    expiresAt: Date.now() + 3_600_000,
    ...(o.bindToken ? { tenantId } : {}),
  });
  const pair = async (origin?: string) => {
    const { code } = await bridge.startPairing('signals', origin);
    await bridge.confirmPairing(mail, code);
    const claimed = await bridge.claimPairing(code);
    if (claimed.status !== 'paired') throw new Error('not paired');
    return claimed;
  };
  const propose = (playerId: string, dedupeKey: string, token = mail) =>
    bridge.propose(token, { playerId, signal: 'mail.answer.correct', source: 'mail', dedupeKey });
  return { bridge, config, admin, mail, rootPrivate, logs, pair, propose, tenantId };
}
