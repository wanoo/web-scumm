// Reality policies of a speedrun category (4.1.14 "Time Attack", ADR 0017): `forbidden` (no signal from outside: a
// deterministic category), `recorded` (each signal's signed JWS kept in the run and checked against the Bridge's keys),
// `live` (the same proof, in a category of its own since latency is not reproducible). A missing, altered or unsigned
// proof is `missing-reality-proof`; without the Bridge's keys the verifier cannot conclude.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { fingerprintGame } from '@engine/core/fingerprint';
import { MemoryChunkStore } from '@engine/core/journal-chunks';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { ExternalEntry, GameDef, SpeedrunCategory } from '@engine/core/types';
import { importBridgeKey, signSignal, verifySignal, b64url } from '@engine/reality/protocol';
import { exportEnvelope, type SpeedrunEnvelope } from '@engine/tools/speedrun/envelope';
import { SpeedrunRecorder } from '@engine/tools/speedrun/recorder';
import { verifyRun, type VerifyContext } from '@engine/tools/speedrun/verify';
import { signals, signalsLayouts } from './fixtures/signals';

const PLAYER = 'p-runner';
const NOW = Date.UTC(2026, 9, 7, 12);
const base: Omit<SpeedrunCategory, 'id' | 'name' | 'realityPolicy'> = {
  timing: 'igt',
  start: { event: 'sessionStarted', session: 'new' },
  finish: { event: 'endingReached' },
  allowSaves: true,
  allowPauses: true,
  allowHints: true,
  reload: 'allowed',
  fingerprint: ['logic'],
  inputs: { mouse: true, touch: true, keyboard: true, gamepad: true, macros: 'forbidden' },
};
function game(): GameDef {
  return {
    ...signals(),
    speedrun: {
      rulesVersion: 1,
      categories: [
        { ...base, id: 'closed', name: 'Closed world', realityPolicy: 'forbidden' },
        { ...base, id: 'recorded', name: 'Recorded', realityPolicy: 'recorded' },
        { ...base, id: 'live', name: 'Live', realityPolicy: 'live' },
      ],
      splits: [{ id: 'vault', name: 'Vault', at: { event: 'flagChanged', flag: 'vault_open', value: true } }],
    },
  };
}

async function setup() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = b64url.encode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const keyring = [await importBridgeKey('k1', raw)];
  return { kp, keyring };
}

/** A run of `category`: by the radio (no signal), or by the mail (a signed signal applied, recorded with its JWS). */
async function play(category: string, byMail: boolean, sign: CryptoKey) {
  const g = game();
  const fingerprint = await fingerprintGame(g, { extensions: { trusted: '' }, engine: 'test' });
  const engine = new Engine(g, signalsLayouts, new FakePresenter(), new MemoryStore());
  const rec = new SpeedrunRecorder({
    engine,
    gameId: g.id,
    manifest: g.speedrun!,
    category: g.speedrun!.categories.find((c) => c.id === category)!,
    store: new MemoryChunkStore(),
    fingerprint,
    engineVersion: 'test',
    now: () => 0,
  });
  await rec.start();
  if (byMail) {
    const payload = {
      format: 'web-scumm-world-signal' as const,
      schema: 1 as const,
      id: 'sig-1',
      sequence: 1,
      gameId: g.id,
      playerId: PLAYER,
      signal: 'mail.answer.correct',
      source: 'mail',
      receivedAt: NOW,
      dedupeKey: 'answer-1',
      policyVersion: '1',
    };
    const jws = await signSignal(payload, sign, 'k1');
    const entry: ExternalEntry = { id: 'sig-1', sequence: 1, signal: payload.signal, source: 'mail', receivedAt: NOW, playerId: PLAYER };
    rec.realitySignal(jws, entry);
    expect(await engine.receive(entry)).toBe('applied');
  } else await engine.act({ verb: 'use', a: 'radio' });
  await engine.act({ verb: 'use', a: 'vault' });
  return { envelope: await rec.seal(), fingerprint, g };
}

const ctx = (g: GameDef, fingerprint: VerifyContext['fingerprint'], keyring?: VerifyContext['keyring']): VerifyContext => ({
  game: g,
  layouts: signalsLayouts,
  fingerprint,
  engineVersion: 'test',
  ...(keyring
    ? {
        keyring,
        signals: { gameId: g.id, playerId: PLAYER, signals: new Set(g.reality!.signals.map((s) => s.id)) },
        verifySignal: async (jws, k, e) => {
          const v = await verifySignal(jws, k, e);
          return v.ok ? { ok: true } : { ok: false, code: v.code };
        },
      }
    : {}),
});
const clone = (e: SpeedrunEnvelope) => JSON.parse(exportEnvelope(e)) as SpeedrunEnvelope;

describe('Reality policies', () => {
  it('forbidden: a closed-world run is valid; a signal in it is a broken rule', async () => {
    const { kp, keyring } = await setup();
    const closed = await play('closed', false, kp.privateKey);
    expect((await verifyRun(closed.envelope, ctx(closed.g, closed.fingerprint))).verdict).toBe('valid');
    const mail = await play('closed', true, kp.privateKey);
    const r = await verifyRun(mail.envelope, ctx(mail.g, mail.fingerprint, keyring));
    expect([r.verdict, r.code]).toEqual(['invalid-category-rule', 'reality-forbidden']);
  });

  it('recorded and live: the signed signal is in the run and verifies with the Bridge’s keys', async () => {
    const { kp, keyring } = await setup();
    for (const cat of ['recorded', 'live']) {
      const { envelope, fingerprint, g } = await play(cat, true, kp.privateKey);
      expect(envelope.realitySignals).toHaveLength(1);
      expect(envelope.realitySignals![0]).toMatchObject({ id: 'sig-1', sequence: 1, kid: 'k1', verdict: 'ok' });
      const r = await verifyRun(envelope, ctx(g, fingerprint, keyring));
      expect([r.verdict, r.code], cat).toEqual(['valid', 'ok']);
    }
  });

  it('a missing, altered or foreign-signed proof is missing-reality-proof; no keyring is inconclusive', async () => {
    const { kp, keyring } = await setup();
    const { envelope, fingerprint, g } = await play('recorded', true, kp.privateKey);
    const none = clone(envelope);
    delete (none as { realitySignals?: unknown }).realitySignals;
    expect((await verifyRun(none, ctx(g, fingerprint, keyring))).code).toBe('signal-missing');
    const altered = clone(envelope);
    (altered.realitySignals![0] as { jws: string }).jws = `${altered.realitySignals![0]!.jws.slice(0, -4)}AAAA`;
    expect((await verifyRun(altered, ctx(g, fingerprint, keyring))).code).toBe('signal-signature');
    const other = clone(envelope);
    (other.realitySignals![0] as { signal: string }).signal = 'hook.bell';
    expect((await verifyRun(other, ctx(g, fingerprint, keyring))).code).toBe('signal-mismatch');
    const stranger = await setup();
    const r = await verifyRun(envelope, ctx(g, fingerprint, stranger.keyring));
    expect([r.verdict, r.code]).toEqual(['missing-reality-proof', 'signal-signature']);
    const blind = await verifyRun(envelope, ctx(g, fingerprint));
    expect([blind.verdict, blind.code]).toEqual(['inconclusive', 'no-keyring']);
    expect(keyring).toHaveLength(1);
  });
});
