// npm run bridge -- <init|serve|grant|revoke> (web-scumm bridge …, 4.1.1): a reference Reality Bridge for a game, for
// development and self-hosting (docs/en/REALITY-OPS.md).
//   init [--dir=.cache/bridge] [--audience=bridge.local] [--origin=…] [--manifest=dist/reality-manifest.json]   keys, a config
//   serve [--dir=…] [--port=8787] [--host=127.0.0.1]                                         the Bridge over HTTP
//   grant --connector=<id> --source=<s> --signals=a,b [--players=any|p-…,p-…] [--pair] [--days=30]   a connector's token
//   rotate [--keep-days=30]                                                                   a new event-signing key
//   revoke --url=<bridge> (--player=<p-…> | --token=<revocation id>)                         asks the running Bridge
// Every secret `init` makes is written under --dir (not committed: .cache/ is ignored), never printed but the paths.
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { manifestHash, type RealityManifest } from '../../src/engine/reality/manifest';
import { Bridge, type BridgeConfig } from './bridge';
import { biscuitLib } from './biscuit';
import { grantToken } from './policy';
import { bridgeServer, type WebhookConfig } from './server';
import { JsonlBridgeStore } from './store';

/** What `init` writes: everything a Bridge needs, the private halves included (file mode 0600). */
export interface BridgeFile {
  gameId: string;
  manifest: RealityManifest;
  manifestHash: string;
  audience: string;
  origins: string[];
  biscuitRoot: { privateKey: string; publicKey: string };
  eventKey: { kid: string; pkcs8: string; raw: string };
  previousKeys: { kid: string; raw: string; notAfter: number }[];
  adminTokenHash: string;
  webhooks: Record<string, WebhookConfig>;
  journal: string;
}

const arg = (args: string[], k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function loadBridge(file: BridgeFile, dir: string): Promise<Bridge> {
  const privateKey = await webcrypto.subtle.importKey(
    'pkcs8',
    Buffer.from(file.eventKey.pkcs8, 'base64url'),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const config: BridgeConfig = {
    gameId: file.gameId,
    manifest: file.manifest,
    manifestHash: file.manifestHash,
    audience: file.audience,
    biscuitRootPublicKey: file.biscuitRoot.publicKey,
    eventKey: { kid: file.eventKey.kid, privateKey: privateKey as CryptoKey, raw: file.eventKey.raw },
    previousKeys: file.previousKeys,
    adminTokenHash: file.adminTokenHash,
    policyVersion: '1',
  };
  return Bridge.start(config, new JsonlBridgeStore(resolve(dir, file.journal)));
}

export async function main(args: string[], game?: { manifest: RealityManifest | null }): Promise<number> {
  const [cmd] = args;
  const dir = resolve(arg(args, 'dir') ?? '.cache/bridge');
  const cfgFile = resolve(dir, 'config.json');
  const read = (): BridgeFile => JSON.parse(readFileSync(cfgFile, 'utf8')) as BridgeFile;
  if (cmd === 'init') {
    // The game's manifest: from its content (npm run bridge, web-scumm bridge), or a built game's
    // dist/reality-manifest.json (--manifest=…, the standalone web-scumm-bridge package).
    const manifestFile = arg(args, 'manifest');
    const manifest = manifestFile
      ? (JSON.parse(readFileSync(resolve(manifestFile), 'utf8')) as RealityManifest)
      : game?.manifest;
    if (!manifest) {
      console.error('✖  the game declares no reality.signals: nothing to bridge');
      return 1;
    }
    if (existsSync(cfgFile) && !args.includes('--force')) {
      console.error(`✖  ${cfgFile} exists (--force replaces it, and every key and token with it)`);
      return 1;
    }
    mkdirSync(dir, { recursive: true });
    const b = await biscuitLib();
    const root = new b.KeyPair(b.SignatureAlgorithm.Ed25519);
    const ev = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const admin = randomBytes(32).toString('base64url');
    const audience = arg(args, 'audience') ?? 'bridge.local';
    const file: BridgeFile = {
      gameId: manifest.gameId,
      manifest,
      manifestHash: await manifestHash(manifest),
      audience,
      origins: (arg(args, 'origin') ?? 'http://127.0.0.1:5173,http://localhost:5173').split(','),
      biscuitRoot: { privateKey: root.getPrivateKey().toString(), publicKey: root.getPublicKey().toString() },
      eventKey: {
        kid: `k-${randomBytes(4).toString('hex')}`,
        pkcs8: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', ev.privateKey)).toString('base64url'),
        raw: Buffer.from(await webcrypto.subtle.exportKey('raw', ev.publicKey)).toString('base64url'),
      },
      previousKeys: [],
      adminTokenHash: sha256(admin),
      webhooks: {},
      journal: 'journal.jsonl',
    };
    // The demonstration webhook: every signal of the manifest, under a token that may also confirm pairings.
    const bySource = new Map<string, string[]>();
    for (const s of manifest.signals) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s.id]);
    for (const [source, signals] of bySource)
      file.webhooks[source] = {
        secret: randomBytes(32).toString('base64url'),
        source,
        token: await grantToken(file.biscuitRoot.privateKey, {
          connector: `webhook-${source}`,
          gameId: manifest.gameId,
          sources: [source],
          signals,
          players: 'any',
          audience,
          pair: true,
          expiresAt: Date.now() + 365 * 24 * 3_600_000,
        }),
        map: Object.fromEntries(signals.map((s) => [s.slice(source.length + 1) || s, s])),
      };
    writeFileSync(cfgFile, `${JSON.stringify(file, null, 1)}\n`, { mode: 0o600 });
    writeFileSync(resolve(dir, 'admin-token'), `${admin}\n`, { mode: 0o600 });
    chmodSync(cfgFile, 0o600);
    console.log(`✔  ${cfgFile} (keys, webhook secrets and tokens; mode 600) and ${resolve(dir, 'admin-token')}`);
    console.log(
      `   webhooks: ${Object.keys(file.webhooks)
        .map((h) => `/v1/hooks/${h}`)
        .join(', ')}; npm run bridge -- serve`,
    );
    return 0;
  }
  if (cmd === 'serve') {
    const file = read();
    const bridge = await loadBridge(file, dir);
    const port = Number(arg(args, 'port') ?? 8787);
    const host = arg(args, 'host') ?? '127.0.0.1';
    bridgeServer(bridge, { origins: file.origins, webhooks: file.webhooks }).listen(port, host, () =>
      console.log(JSON.stringify({ event: 'bridge.listening', url: `http://${host}:${port}/`, game: file.gameId })),
    );
    return await new Promise<number>(() => {});
  }
  if (cmd === 'grant') {
    const file = read();
    const players = arg(args, 'players') ?? 'any';
    const token = await grantToken(file.biscuitRoot.privateKey, {
      connector: arg(args, 'connector') ?? 'connector',
      gameId: file.gameId,
      sources: [arg(args, 'source') ?? ''],
      signals: (arg(args, 'signals') ?? '').split(',').filter(Boolean),
      players: players === 'any' ? 'any' : players.split(','),
      audience: file.audience,
      pair: args.includes('--pair'),
      expiresAt: Date.now() + Number(arg(args, 'days') ?? 30) * 24 * 3_600_000,
    });
    process.stdout.write(`${token}\n`);
    return 0;
  }
  if (cmd === 'rotate') {
    // A new event key. The Bridge signs again, under its current key, every signal still waiting for a player, and
    // a player whose keyring is older asks for the keys once; the previous key stays listed for --keep-days for a
    // player that received a signal just before the rotation. Restart the Bridge to use it.
    const file = read();
    const ev = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const notAfter = Date.now() + Number(arg(args, 'keep-days') ?? 30) * 24 * 3_600_000;
    file.previousKeys = [...file.previousKeys, { kid: file.eventKey.kid, raw: file.eventKey.raw, notAfter }];
    file.eventKey = {
      kid: `k-${randomBytes(4).toString('hex')}`,
      pkcs8: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', ev.privateKey)).toString('base64url'),
      raw: Buffer.from(await webcrypto.subtle.exportKey('raw', ev.publicKey)).toString('base64url'),
    };
    writeFileSync(cfgFile, `${JSON.stringify(file, null, 1)}\n`, { mode: 0o600 });
    console.log(
      `✔  new event key ${file.eventKey.kid}; the previous one trusted until ${new Date(notAfter).toISOString()} (restart the Bridge)`,
    );
    return 0;
  }
  if (cmd === 'revoke') {
    const url = arg(args, 'url') ?? 'http://127.0.0.1:8787/';
    const admin = readFileSync(resolve(dir, 'admin-token'), 'utf8').trim();
    const r = await fetch(new URL('v1/admin/revoke', url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: arg(args, 'player'), tokenId: arg(args, 'token') }),
    });
    console.log(r.ok ? '✔  revoked' : `✖  ${r.status} ${await r.text()}`);
    return r.ok ? 0 : 1;
  }
  console.error('usage: npm run bridge -- <init|serve|grant|rotate|revoke> (bridge/src/cli.ts)');
  return 2;
}
