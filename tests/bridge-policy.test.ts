// The Bridge's Biscuit policy (4.1.1, bridge/policy/propose.datalog): a connector proposes only what its token grants,
// for the game, sources, signals, players and audience it names, before its expiry, unless revoked; an attenuated
// token can only narrow it.
import { describe, expect, it } from 'vitest';
import { biscuitLib } from '../bridge/src/biscuit';
import { attenuate, authorize, grantToken, type Grant, type Proposal } from '../bridge/src/policy';

const NOW = Date.UTC(2026, 9, 6, 12);
const keys = async () => {
  const b = await biscuitLib();
  const kp = new b.KeyPair(b.SignatureAlgorithm.Ed25519);
  return { priv: kp.getPrivateKey().toString(), pub: kp.getPublicKey().toString() };
};
const grant: Grant = {
  connector: 'mail-1',
  gameId: 'signals',
  sources: ['mail'],
  signals: ['mail.answer.correct', 'mail.answer.wrong'],
  players: ['p-1', 'p-2'],
  audience: 'bridge.local',
  expiresAt: NOW + 3_600_000,
};
const ask: Proposal = {
  gameId: 'signals',
  playerId: 'p-1',
  source: 'mail',
  signal: 'mail.answer.correct',
  audience: 'bridge.local',
};

describe("the Bridge's policy", () => {
  it('allows what the token grants, and nothing beside it', async () => {
    const k = await keys();
    const t = await grantToken(k.priv, grant);
    expect(await authorize(t, k.pub, ask, NOW)).toMatchObject({ ok: true });
    const denied: [string, Partial<Proposal>][] = [
      ['another game', { gameId: 'demo' }],
      ['another player', { playerId: 'p-9' }],
      ['another source', { source: 'webhook' }],
      ['a signal not granted', { signal: 'mail.admin.reset' }],
      ['another audience', { audience: 'bridge.prod' }],
    ];
    for (const [name, change] of denied)
      expect(await authorize(t, k.pub, { ...ask, ...change }, NOW), name).toMatchObject({ ok: false, code: 'denied' });
    // Expiry is to the second, strict: the last millisecond before it holds, the second itself does not.
    expect(await authorize(t, k.pub, ask, NOW + 3_599_999), 'just before').toMatchObject({ ok: true });
    expect(await authorize(t, k.pub, ask, NOW + 3_600_000), 'at expiry').toMatchObject({ ok: false, code: 'denied' });
    expect(await authorize(t, k.pub, ask, NOW + 3_600_001), 'expired').toMatchObject({ ok: false, code: 'denied' });
  });

  it('a token for every player of a game still holds the game', async () => {
    const k = await keys();
    const t = await grantToken(k.priv, { ...grant, players: 'any' });
    expect(await authorize(t, k.pub, { ...ask, playerId: 'p-77' }, NOW)).toMatchObject({ ok: true });
    expect(await authorize(t, k.pub, { ...ask, gameId: 'demo' }, NOW)).toMatchObject({ ok: false });
  });

  it('attenuation narrows: fewer players, an earlier expiry; it never widens', async () => {
    const k = await keys();
    const t = await attenuate(await grantToken(k.priv, grant), k.pub, { players: ['p-2'], expiresAt: NOW + 60_000 });
    expect(await authorize(t, k.pub, { ...ask, playerId: 'p-2' }, NOW)).toMatchObject({ ok: true });
    expect(await authorize(t, k.pub, ask, NOW)).toMatchObject({ ok: false, code: 'denied' });
    expect(await authorize(t, k.pub, { ...ask, playerId: 'p-2' }, NOW + 60_000)).toMatchObject({ ok: false });
    // A block that tries to add a right is not trusted by the policy (facts of attenuation blocks are scoped).
    const b = await biscuitLib();
    const tok = b.Biscuit.fromBase64(
      await grantToken(k.priv, grant),
      b.PublicKey.fromString(k.pub.replace(/^ed25519\//, ''), b.SignatureAlgorithm.Ed25519),
    );
    const block = b.Biscuit.block_builder();
    block.addCode('signal("mail.admin.reset"); player("p-9");');
    const widened = tok.appendBlock(block).toBase64();
    expect(await authorize(widened, k.pub, { ...ask, signal: 'mail.admin.reset' }, NOW)).toMatchObject({
      ok: false,
      code: 'denied',
    });
    expect(await authorize(widened, k.pub, { ...ask, playerId: 'p-9' }, NOW)).toMatchObject({
      ok: false,
      code: 'denied',
    });
  });

  it('refuses a revoked token, a tampered one and one from another root', async () => {
    const k = await keys();
    const t = await grantToken(k.priv, grant);
    const ok = await authorize(t, k.pub, ask, NOW);
    if (!ok.ok) throw new Error('setup');
    expect(await authorize(t, k.pub, ask, NOW, new Set([ok.revocationIds[0]!]))).toMatchObject({
      ok: false,
      code: 'revoked',
    });
    const tampered = t.slice(0, 40) + (t[40] === 'A' ? 'B' : 'A') + t.slice(41);
    expect(await authorize(tampered, k.pub, ask, NOW)).toMatchObject({ ok: false, code: 'format' });
    const other = await keys();
    expect(await authorize(t, other.pub, ask, NOW)).toMatchObject({ ok: false, code: 'format' });
  });
});
