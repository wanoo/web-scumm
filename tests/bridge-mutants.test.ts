// The edges of the reference Bridge (bridge/src/bridge.ts, bridge/src/policy.ts), each test written for a mutant of
// the reality set that the other Bridge tests let live (tools/mutate.ts; docs/dev/MUTANTS.md): the exact instant a
// code, a link or a quota's window expires, a body that is not an object, the window between a proposal's two
// checks, the streams of one player among others, the operator's refusals, a grant without `pair`, an attenuation
// with one of its two checks. The Bridge is driven directly (no HTTP): what is tested is its methods' behaviour.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { manifestHash, realityManifest } from '@engine/reality/manifest';
import { biscuitLib } from '../bridge/src/biscuit';
import { Bridge, type BridgeConfig, BridgeError, type BridgeLog } from '../bridge/src/bridge';
import { attenuate, authorize, type Grant, grantToken } from '../bridge/src/policy';
import { type BridgeStore, MemoryBridgeStore } from '../bridge/src/store';
import { signals } from './fixtures/signals';

const SIGNAL_BODY = (playerId: string, dedupeKey: string, extra: Record<string, unknown> = {}) => ({
  playerId,
  signal: 'mail.answer.correct',
  source: 'mail',
  dedupeKey,
  ...extra,
});

/** The payload of a signed signal (the JWS's second part). */
const payloadOf = (jws: string) =>
  JSON.parse(Buffer.from(jws.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;

/**
 * A store on which something lands at a chosen read: the window between a proposal's check before the lock and
 * the one inside it, or the section after both. `arm` runs `then` once, before the `skip`-th next call of `at`.
 */
class WindowStore extends MemoryBridgeStore {
  private hooks: { at: 'player' | 'lastSequence'; skip: number; then: () => void }[] = [];
  arm(at: 'player' | 'lastSequence', skip: number, then: () => void): void {
    this.hooks.push({ at, skip, then });
  }
  private fire(at: 'player' | 'lastSequence'): void {
    for (const h of [...this.hooks]) {
      if (h.at !== at) continue;
      if (h.skip > 0) {
        h.skip -= 1;
        continue;
      }
      this.hooks.splice(this.hooks.indexOf(h), 1);
      h.then();
    }
  }
  override player(playerId: string) {
    this.fire('player');
    return super.player(playerId);
  }
  override lastSequence(playerId: string) {
    this.fire('lastSequence');
    return super.lastSequence(playerId);
  }
}

async function setup(o: { store?: BridgeStore; limits?: BridgeConfig['limits']; now?: () => number } = {}) {
  const b = await biscuitLib();
  const root = new b.KeyPair(b.SignatureAlgorithm.Ed25519);
  const rootPriv = root.getPrivateKey().toString();
  const rootPub = root.getPublicKey().toString();
  const ev = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', ev.publicKey)).toString('base64url');
  const manifest = realityManifest(signals());
  if (!manifest) throw new Error('the signals fixture has a manifest');
  const admin = 'operator-secret-token';
  const logs: BridgeLog[] = [];
  const config: BridgeConfig = {
    gameId: 'signals',
    manifest,
    manifestHash: await manifestHash(manifest),
    audience: 'bridge.test',
    biscuitRootPublicKey: rootPub,
    eventKey: { kid: 'k1', privateKey: ev.privateKey, raw },
    adminTokenHash: createHash('sha256').update(admin).digest('hex'),
    policyVersion: '1',
    ...(o.limits ? { limits: o.limits } : {}),
  };
  const store = o.store ?? new MemoryBridgeStore();
  const bridge = await Bridge.start(config, store, { log: (l) => logs.push(l), ...(o.now ? { now: o.now } : {}) });
  const grant = (g: Partial<Grant> = {}) =>
    grantToken(rootPriv, {
      connector: 'mail-1',
      gameId: 'signals',
      sources: ['mail'],
      signals: ['mail.answer.correct', 'mail.answer.wrong'],
      players: 'any',
      audience: 'bridge.test',
      pair: true,
      expiresAt: Date.now() + 3_600_000,
      ...g,
    });
  const mail = await grant();
  /** The connector's revocation id, the one `recent` and `revoke` know it by. */
  const revocationId = async (token: string) => {
    const tok = b.Biscuit.fromBase64(
      token,
      b.PublicKey.fromString(rootPub.replace(/^ed25519\//, ''), b.SignatureAlgorithm.Ed25519),
    );
    return (tok.getRevocationIdentifiers() as string[])[0] ?? '';
  };
  const pair = async () => {
    const { code } = await bridge.startPairing('signals');
    await bridge.confirmPairing(mail, code);
    const claimed = await bridge.claimPairing(code);
    if (claimed.status !== 'paired') throw new Error('not paired');
    return claimed;
  };
  const propose = (playerId: string, dedupeKey: string, extra: Record<string, unknown> = {}, token = mail) =>
    bridge.propose(token, SIGNAL_BODY(playerId, dedupeKey, extra));
  return { bridge, store, mail, admin, logs, grant, pair, propose, revocationId, rootPub };
}

describe('the Bridge at its edges (mutants of bridge.ts)', () => {
  it('a pairing code lives until the instant it expires, included; expired codes make room for new ones', async () => {
    let t0 = Date.now();
    const t = await setup({ now: () => t0, limits: { pendingPairings: 1, pairingMs: 1_000 } });
    const { code, expiresAt } = await t.bridge.startPairing('signals');
    expect(expiresAt).toBe(t0 + 1_000);
    // kills bridge.ts:161 < → <=  and bridge.ts:157 < → <= : at the instant itself the code is still there and still
    // counts among the codes waiting (one allowed: the second ask is refused).
    t0 = expiresAt;
    expect(await t.bridge.claimPairing(code)).toEqual({ status: 'pending' });
    await expect(t.bridge.startPairing('signals')).rejects.toMatchObject({ status: 429 });
    // kills bridge.ts:157 condition false: one millisecond later the code is swept and a new one may be asked.
    t0 = expiresAt + 1;
    await expect(t.bridge.claimPairing(code)).rejects.toMatchObject({ status: 404 });
    expect((await t.bridge.startPairing('signals')).code).not.toBe(code);
  });

  it('a body that is not an object is a malformed proposal (400), not a crash', async () => {
    const t = await setup();
    // kills bridge.ts:229 condition true and && → || : with `null` taken as the record, reading `playerId` throws
    // a TypeError instead of the Bridge's refusal.
    for (const body of [null, undefined, 'a string', 42]) {
      const refused = t.bridge.propose(t.mail, body);
      await expect(refused).rejects.toBeInstanceOf(BridgeError);
      await expect(refused).rejects.toMatchObject({ status: 400, code: 'shape' });
    }
  });

  it('`occurredAt: 0` is kept; a proposal without the optional fields signs and stores a payload without them', async () => {
    const t = await setup();
    const link = await t.pair();
    // kills bridge.ts:240 >= → > : the epoch is a valid instant.
    await t.propose(link.playerId, 'at-zero', { occurredAt: 0 });
    await t.propose(link.playerId, 'bare');
    const delivered = await t.bridge.signals(link.capability, 0);
    expect(payloadOf(delivered[0]?.jws ?? '')).toMatchObject({ occurredAt: 0 });
    // kills bridge.ts:293 condition true and bridge.ts:297 condition true: the journal keeps the payload as accepted,
    // with no key the proposal did not have (not even one holding `undefined`).
    const kept = (await t.bridge.exportPlayer(t.admin, link.playerId)).signals;
    expect(Object.keys(payloadOf(delivered[1]?.jws ?? ''))).not.toContain('occurredAt');
    expect(Object.keys(kept[1]?.payload ?? {})).not.toContain('occurredAt');
    expect(Object.keys(kept[1]?.payload ?? {})).not.toContain('evidenceHash');
    expect(Object.keys(kept[0]?.payload ?? {})).toContain('occurredAt');
  });

  it("a player of another game in the store is unknown to this Bridge; so is a player id the store doesn't hold", async () => {
    const t = await setup();
    // A journal shared with another game's Bridge: its players are not this game's.
    t.store.write({
      t: 'player',
      p: {
        playerId: 'p-0123456789abcdef',
        gameId: 'demo',
        capabilityHash: 'a'.repeat(64),
        capabilityExpiresAt: Date.now() + 3_600_000,
      },
    });
    // kills bridge.ts:263 || → && : with `&&` a player that exists but belongs to another game is accepted.
    await expect(t.propose('p-0123456789abcdef', 'x')).rejects.toMatchObject({ status: 404, code: 'player' });
    expect((await t.bridge.exportPlayer(t.admin, 'p-0123456789abcdef')).signals).toHaveLength(0);
    await expect(t.propose('p-0000000000000000', 'x')).rejects.toMatchObject({ status: 404, code: 'player' });
  });

  it('a revocation of the player or of the token that lands while the proposal waits for the lock refuses it', async () => {
    const store = new WindowStore();
    const t = await setup({ store });
    const link = await t.pair();
    // The proposal reads the player once before the lock and once inside it; the revocation lands between the two.
    // kills bridge.ts:270 || → && : with `&&` a player revoked meanwhile (still there, so `!current` is false) passes.
    store.arm('player', 1, () => {
      const p = store.player(link.playerId);
      if (p) store.write({ t: 'player', p: { ...p, revoked: true } });
    });
    await expect(t.propose(link.playerId, 'late-player')).rejects.toMatchObject({ status: 404, code: 'player' });
    expect((await t.bridge.exportPlayer(t.admin, link.playerId)).signals).toHaveLength(0);

    // kills bridge.ts:271 condition false: the token's revocation checked again inside the lock.
    const other = await t.pair();
    const id = await t.revocationId(t.mail);
    store.arm('player', 1, () => store.write({ t: 'revoke-token', id }));
    await expect(t.propose(other.playerId, 'late-token')).rejects.toMatchObject({ status: 401, code: 'revoked' });
    expect((await t.bridge.exportPlayer(t.admin, other.playerId)).signals).toHaveLength(0);
  });

  it("a connector's minute is a sliding window of sixty seconds, the signal at its far edge excluded", async () => {
    let t0 = Date.now();
    const t = await setup({ now: () => t0, limits: { perMinutePerConnector: 1 } });
    const link = await t.pair();
    await expect(t.propose(link.playerId, 'a')).resolves.toMatchObject({ sequence: 1 });
    await expect(t.propose(link.playerId, 'b')).rejects.toMatchObject({ status: 429, code: 'quota' });
    t0 += 59_999;
    await expect(t.propose(link.playerId, 'b')).rejects.toMatchObject({ status: 429, code: 'quota' });
    // kills bridge.ts:276 > → >= : sixty seconds after the first signal, it has left the window.
    t0 += 1;
    await expect(t.propose(link.playerId, 'b')).resolves.toMatchObject({ sequence: 2 });
  });

  it("a signal reaches its player's streams only; a revocation closes that player's streams only", async () => {
    const t = await setup();
    const a = await t.pair();
    const b = await t.pair();
    const gotA: number[] = [];
    const gotB: number[] = [];
    const closedB: string[] = [];
    await t.bridge.subscribe(a.capability, (seq) => gotA.push(seq));
    await t.bridge.subscribe(
      b.capability,
      (seq) => gotB.push(seq),
      (why) => closedB.push(why),
    );
    // kills bridge.ts:312 condition false: every stream would receive every player's signals.
    await t.propose(a.playerId, 'a1');
    expect(gotA).toEqual([1]);
    expect(gotB).toEqual([]);
    // kills bridge.ts:413 condition true: revoking a player would end every stream.
    await t.bridge.revoke(t.admin, { playerId: a.playerId });
    expect(closedB).toEqual([]);
    await t.propose(b.playerId, 'b1');
    expect(gotB).toEqual([1]);
  });

  it('a stream whose player is revoked inside the section that accepts a signal ends instead of receiving it', async () => {
    const store = new WindowStore();
    const t = await setup({ store });
    const link = await t.pair();
    const got: number[] = [];
    const closed: string[] = [];
    await t.bridge.subscribe(
      link.capability,
      (seq) => got.push(seq),
      (why) => closed.push(why),
    );
    // After both checks, before the journal line: the player's link is revoked in the store (another writer of the
    // journal, as the stream's own check is there for).
    // kills bridge.ts:320 condition false and || → && : the stream is checked again at delivery and found revoked.
    store.arm('lastSequence', 0, () => {
      const p = store.player(link.playerId);
      if (p) store.write({ t: 'player', p: { ...p, revoked: true } });
    });
    await expect(t.propose(link.playerId, 'x')).resolves.toMatchObject({ sequence: 1 });
    expect(got).toEqual([]);
    expect(closed).toEqual(['revoked']);
  });

  it('a link lives until the instant it expires, included, and until the instant of its longest life, included', async () => {
    let t0 = Date.now();
    const t = await setup({ now: () => t0, limits: { capabilityMs: 1_000 } });
    const link = await t.pair();
    const got: number[] = [];
    const closed: string[] = [];
    await t.bridge.subscribe(
      link.capability,
      (seq) => got.push(seq),
      (why) => closed.push(why),
    );
    // kills bridge.ts:359 < → <= and bridge.ts:321 < → <= : at the instant itself the link reads, and its stream
    // still receives.
    t0 += 1_000;
    await expect(t.bridge.signals(link.capability, 0)).resolves.toEqual([]);
    await t.propose(link.playerId, 'at-expiry');
    expect(got).toEqual([1]);
    expect(closed).toEqual([]);
    t0 += 1;
    await expect(t.bridge.signals(link.capability, 0)).rejects.toMatchObject({ status: 401, code: 'capability' });
    // Renewed by an acknowledgement at that instant? No: the link is gone; it had to acknowledge before.
    await expect(t.bridge.ack(link.capability, 1)).rejects.toMatchObject({ status: 401 });

    // kills bridge.ts:360 > → >= : the longest life ends after its last instant, not at it (a Bridge whose links
    // live long enough to reach it).
    let t1 = Date.now();
    const u = await setup({ now: () => t1, limits: { capabilityMaxMs: 5_000 } });
    const old = await u.pair();
    t1 += 5_000;
    await expect(u.bridge.signals(old.capability, 0)).resolves.toEqual([]);
    t1 += 1;
    await expect(u.bridge.signals(old.capability, 0)).rejects.toMatchObject({
      status: 401,
      message: expect.stringMatching(/too old/),
    });
  });

  it('no capability at all is an unknown link (401), not a crash', async () => {
    const t = await setup();
    // kills bridge.ts:357 condition true: hashing `undefined` throws a TypeError instead of the refusal.
    await expect(t.bridge.playerOf(undefined)).rejects.toBeInstanceOf(BridgeError);
    await expect(t.bridge.playerOf(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(t.bridge.playerOf('')).rejects.toMatchObject({ status: 401 });
    expect(await t.bridge.streamAlive(undefined)).toBe(false);
  });

  it('a delivery without a rotation signs nothing again; the heartbeat tells a live link from a dead one', async () => {
    const t = await setup();
    const link = await t.pair();
    await t.propose(link.playerId, 'x');
    // kills bridge.ts:335 condition false and || → && : an entry signed by the current key goes out as it is.
    const delivered = await t.bridge.signals(link.capability, 0);
    expect(delivered).toHaveLength(1);
    expect(t.bridge.resignedCount()).toBe(0);
    // kills bridge.ts:406 true → false and bridge.ts:408 false → true.
    expect(await t.bridge.streamAlive(link.capability)).toBe(true);
    expect(await t.bridge.streamAlive('not-a-capability')).toBe(false);
    await t.bridge.unlink(link.capability);
    expect(await t.bridge.streamAlive(link.capability)).toBe(false);
  });

  it('streams are counted per player: another player may open its own', async () => {
    const t = await setup({ limits: { streamsPerPlayer: 1 } });
    const a = await t.pair();
    const b = await t.pair();
    await t.bridge.subscribe(a.capability, () => {});
    // kills bridge.ts:394 condition true: every stream would count against every player.
    await expect(t.bridge.subscribe(b.capability, () => {})).resolves.toBeTypeOf('function');
    await expect(t.bridge.subscribe(a.capability, () => {})).rejects.toMatchObject({ status: 429 });
  });

  it('`through` is a whole number from 0 to the last sequence sent: 0 acknowledges nothing, 1.5 is not a sequence', async () => {
    const t = await setup();
    const link = await t.pair();
    await t.propose(link.playerId, 'one');
    await t.propose(link.playerId, 'two');
    // kills bridge.ts:422 < → <= : zero is allowed (nothing applied yet, the link renewed).
    await expect(t.bridge.ack(link.capability, 0)).resolves.toBeUndefined();
    expect((await t.bridge.exportPlayer(t.admin, link.playerId)).acked).toBe(0);
    // kills bridge.ts:420 || → && and bridge.ts:421 || → && : a fraction is a number but not an integer, a string is
    // neither; with `&&` one of the two slips through (1.5 is within 0 and the last sequence).
    for (const bad of [1.5, Number.NaN, 'two', -1, 3, undefined])
      await expect(t.bridge.ack(link.capability, bad), String(bad)).rejects.toMatchObject({ status: 400 });
    expect((await t.bridge.exportPlayer(t.admin, link.playerId)).acked).toBe(0);
    await expect(t.bridge.ack(link.capability, 2)).resolves.toBeUndefined();
    expect((await t.bridge.exportPlayer(t.admin, link.playerId)).acked).toBe(2);
  });

  it('the operator without a token is not the operator; an unknown player or a malformed id is refused', async () => {
    const t = await setup();
    const link = await t.pair();
    // kills bridge.ts:433 condition true: hashing `undefined` throws a TypeError instead of the refusal.
    expect(() => t.bridge.admin(undefined)).toThrow(BridgeError);
    await expect(t.bridge.revoke(undefined, { playerId: link.playerId })).rejects.toMatchObject({ status: 401 });
    await expect(t.bridge.exportPlayer('', link.playerId)).rejects.toMatchObject({ status: 401 });
    // kills bridge.ts:444 condition false: revoking a player the store does not hold.
    await expect(t.bridge.revoke(t.admin, { playerId: 'p-0000000000000000' })).rejects.toMatchObject({ status: 404 });
    expect(t.logs.filter((l) => l.event === 'player.revoked')).toHaveLength(0);
    // kills bridge.ts:450 condition false: a revocation id is hex, 16 to 256 characters.
    for (const tokenId of ['ZZZZZZZZZZZZZZZZ', 'abcdef', 'a'.repeat(257), ''.padEnd(16, 'g')])
      await expect(t.bridge.revoke(t.admin, { tokenId }), tokenId).rejects.toMatchObject({ status: 400 });
    expect(t.logs.filter((l) => l.event === 'token.revoked')).toHaveLength(0);
    await expect(t.bridge.revoke(t.admin, { tokenId: 'a'.repeat(16) })).resolves.toBeUndefined();
    // kills bridge.ts:459 condition false: forgetting a player the store does not hold, or twice.
    await expect(t.bridge.forgetPlayer(t.admin, 'p-0000000000000000')).rejects.toMatchObject({ status: 404 });
    await t.bridge.forgetPlayer(t.admin, link.playerId);
    await expect(t.bridge.forgetPlayer(t.admin, link.playerId)).rejects.toMatchObject({ status: 404 });
    expect(t.logs.filter((l) => l.event === 'player.forgotten')).toHaveLength(1);
  });
});

describe("the Bridge's grants at their edges (mutants of policy.ts)", () => {
  it('a grant without `pair` may propose but not confirm a pairing code', async () => {
    const t = await setup();
    const noPair = await t.grant({ pair: undefined });
    const { code } = await t.bridge.startPairing('signals');
    // kills policy.ts:60 condition true: `pair(true)` would be in every token.
    await expect(t.bridge.confirmPairing(noPair, code)).rejects.toMatchObject({ status: 403, code: 'denied' });
    expect(await t.bridge.claimPairing(code)).toEqual({ status: 'pending' });
    await expect(t.bridge.confirmPairing(t.mail, code)).resolves.toMatchObject({ playerId: expect.any(String) });
  });

  it('an attenuation with only an expiry, or only players, is a valid token that holds that one check', async () => {
    const t = await setup();
    const link = await t.pair();
    const now = Date.now();
    const ask = { gameId: 'signals', playerId: link.playerId, source: 'mail', signal: 'mail.answer.correct' };
    // kills policy.ts:80 condition true: `undefined.contains($p)` is not Datalog.
    const sooner = await attenuate(t.mail, t.rootPub, { expiresAt: now + 60_000 });
    expect(await authorize(sooner, t.rootPub, { ...ask, audience: 'bridge.test' }, now)).toMatchObject({ ok: true });
    expect(await authorize(sooner, t.rootPub, { ...ask, audience: 'bridge.test' }, now + 60_000)).toMatchObject({
      ok: false,
      code: 'denied',
    });
    await expect(t.propose(link.playerId, 'sooner', {}, sooner)).resolves.toMatchObject({ sequence: 1 });
    // kills policy.ts:81 condition true: `new Date(undefined)` has no ISO string.
    const fewer = await attenuate(t.mail, t.rootPub, { players: [link.playerId] });
    expect(await authorize(fewer, t.rootPub, { ...ask, audience: 'bridge.test' }, now)).toMatchObject({ ok: true });
    expect(
      await authorize(fewer, t.rootPub, { ...ask, playerId: 'p-0000000000000000', audience: 'bridge.test' }, now),
    ).toMatchObject({ ok: false, code: 'denied' });
    await expect(t.propose(link.playerId, 'fewer', {}, fewer)).resolves.toMatchObject({ sequence: 2 });
  });
});
