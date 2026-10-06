// npx tsx tools/reality-fixtures.ts: writes the conformance corpus of the signed signal
// (tests/fixtures/reality/conformance.json, 4.1.1). Each case is a JWS, the keyring and the expectation the player
// has, and the verdict: `ok` or a refusal code (src/engine/reality/protocol.ts). The keys come from fixed seeds that
// are TEST KEYS ONLY, written here in the open: they sign nothing but this corpus. Ed25519 is deterministic, so the
// file is the same at every run. tests/reality-protocol.test.ts checks every case in JavaScript, and
// `npm run reality:xcheck` in Rust (bridge/xcheck).
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  b64url,
  CLOCK_SKEW_MS,
  MAX_SIGNAL_CHARS,
  signSignal,
  type RefusalCode,
  type WorldSignalV1,
} from '../src/engine/reality/protocol';
import { ROOT } from './game';
import { attenuate, authorize, grantToken } from '../bridge/src/policy';
import { biscuitLib } from '../bridge/src/biscuit';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const PKCS8 = '302e020100300506032b657004220420';
/** Test seeds, public on purpose. */
const SEEDS = { k1: '11'.repeat(32), k2: '22'.repeat(32), evil: '66'.repeat(32) };

async function keyPair(seed: string) {
  const priv = await crypto.subtle.importKey('pkcs8', hex(PKCS8 + seed) as BufferSource, { name: 'Ed25519' }, true, [
    'sign',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', priv);
  return { priv, raw: jwk.x! };
}
const k1 = await keyPair(SEEDS.k1);
const k2 = await keyPair(SEEDS.k2);
const evil = await keyPair(SEEDS.evil);

const NOW = Date.UTC(2026, 9, 6, 12);
const base: WorldSignalV1 = {
  format: 'web-scumm-world-signal',
  schema: 1,
  id: 'sig-0001',
  sequence: 1,
  gameId: 'signals',
  playerId: 'p-7f3a',
  signal: 'mail.answer.correct',
  source: 'mail',
  receivedAt: NOW - 1000,
  dedupeKey: 'mail:msg-42',
  policyVersion: '1',
};
const expect = {
  gameId: 'signals',
  playerId: 'p-7f3a',
  signals: ['mail.answer.correct', 'mail.answer.wrong'],
  now: NOW,
};
const keys = [
  { kid: 'k1', raw: k1.raw, notAfter: NOW + 3_600_000 },
  { kid: 'k2', raw: k2.raw, notBefore: NOW - 3_600_000 },
];
const enc = (o: unknown) => b64url.encode(new TextEncoder().encode(JSON.stringify(o)));
/** Signs any bytes as a JWS with a header (for the malformed cases a valid signer would never produce). */
async function rawJws(header: unknown, payload: unknown, key: CryptoKey) {
  const h = enc(header);
  const p = enc(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url.encode(sig)}`;
}

type Case = {
  name: string;
  jws: string;
  verdict: 'ok' | RefusalCode;
  keys?: typeof keys;
  expect?: Partial<typeof expect>;
};
const cases: Case[] = [];
const add = (name: string, jws: string, verdict: Case['verdict'], extra: Partial<Case> = {}) =>
  cases.push({ name, jws, verdict, ...extra });

const good = await signSignal(base, k1.priv, 'k1');
add('valid, signed by k1', good, 'ok');
add(
  'valid, signed by the rotated key k2',
  await signSignal({ ...base, id: 'sig-0002', sequence: 2 }, k2.priv, 'k2'),
  'ok',
);
const [h, p, s] = good.split('.') as [string, string, string];
const flipped = p.slice(0, 10) + (p[10] === 'A' ? 'B' : 'A') + p.slice(11);
add('a byte of the payload changed', `${h}.${flipped}.${s}`, 'signature');
add('signed by another key under the name k1', await signSignal(base, evil.priv, 'k1'), 'signature');
add('an unknown key id', await signSignal(base, evil.priv, 'k9'), 'key');
add('algorithm none', `${enc({ alg: 'none', kid: 'k1' })}.${p}.${s}`, 'algorithm');
add('algorithm HS256', await rawJws({ alg: 'HS256', kid: 'k1' }, base, k1.priv), 'algorithm');
add(
  'an unknown header field',
  await rawJws({ alg: 'EdDSA', kid: 'k1', jku: 'https://evil.example' }, base, k1.priv),
  'header',
);
add('two parts', `${h}.${p}`, 'shape');
add('not base64url', `${h}.${p}.${s}+/=`, 'shape');
add(
  'larger than the limit',
  await rawJws({ alg: 'EdDSA', kid: 'k1' }, { ...base, pad: 'x'.repeat(MAX_SIGNAL_CHARS) }, k1.priv),
  'size',
);
add('a future schema', await rawJws({ alg: 'EdDSA', kid: 'k1' }, { ...base, schema: 2 }, k1.priv), 'schema');
add(
  'a field the schema does not know',
  await rawJws({ alg: 'EdDSA', kid: 'k1' }, { ...base, html: '<b>hi</b>' }, k1.priv),
  'payload',
);
add('a payload that is not JSON', `${h}.${b64url.encode(new TextEncoder().encode('{nope'))}.${s}`, 'signature');
add(
  'a payload that is not JSON, signed',
  await (async () => {
    const hh = enc({ alg: 'EdDSA', kid: 'k1' });
    const pp = b64url.encode(new TextEncoder().encode('{nope'));
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: 'Ed25519' }, k1.priv, new TextEncoder().encode(`${hh}.${pp}`)),
    );
    return `${hh}.${pp}.${b64url.encode(sig)}`;
  })(),
  'payload',
);
add('for another game', await signSignal({ ...base, gameId: 'demo' }, k1.priv, 'k1'), 'game');
add('for another player', await signSignal({ ...base, playerId: 'p-0000' }, k1.priv, 'k1'), 'player');
add(
  'a signal the manifest does not declare',
  await signSignal({ ...base, signal: 'mail.admin.reset' }, k1.priv, 'k1'),
  'signal',
);
// Expiry and key windows carry the clock tolerance (CLOCK_SKEW_MS): a minute off is fine, beyond it is not.
add('expired', await signSignal({ ...base, expiresAt: NOW - CLOCK_SKEW_MS - 1 }, k1.priv, 'k1'), 'expired');
add(
  'expired a minute ago (within the clock tolerance)',
  await signSignal({ ...base, expiresAt: NOW - 60_000 }, k1.priv, 'k1'),
  'ok',
);
add('not expired yet', await signSignal({ ...base, expiresAt: NOW + 1 }, k1.priv, 'k1'), 'ok');
add('k1 after its end (rotation done)', good, 'key-window', { expect: { now: NOW + 3_600_000 + CLOCK_SKEW_MS + 1 } });
add('k1 a minute after its end (within the clock tolerance)', good, 'ok', {
  expect: { now: NOW + 3_600_000 + 60_000 },
});
add('k2 before its start', await signSignal(base, k2.priv, 'k2'), 'key-window', {
  expect: { now: NOW - 3_600_000 - CLOCK_SKEW_MS - 1 },
});
add('k2 a minute before its start (within the clock tolerance)', await signSignal(base, k2.priv, 'k2'), 'ok', {
  expect: { now: NOW - 3_600_000 - 60_000 },
});
// The exact edges of the tolerance: on the line is still fine, one millisecond past it is not.
add('k1 exactly at the end of its tolerance', good, 'ok', { expect: { now: NOW + 3_600_000 + CLOCK_SKEW_MS } });
add('k2 exactly at the start of its tolerance', await signSignal(base, k2.priv, 'k2'), 'ok', {
  expect: { now: NOW - 3_600_000 - CLOCK_SKEW_MS },
});
add(
  'expired exactly at the tolerance',
  await signSignal({ ...base, expiresAt: NOW - CLOCK_SKEW_MS }, k1.priv, 'k1'),
  'ok',
);
add('a header that is not an object', `${enc(null)}.${p}.${s}`, 'header');
add('a header that is a list', `${enc(['EdDSA'])}.${p}.${s}`, 'header');
add(
  'a payload that is JSON but not an object, signed',
  await rawJws({ alg: 'EdDSA', kid: 'k1' }, 'hello', k1.priv),
  'payload',
);
add('a payload that is JSON null, signed', await rawJws({ alg: 'EdDSA', kid: 'k1' }, null, k1.priv), 'payload');

const out = resolve(ROOT, 'tests/fixtures/reality');
mkdirSync(out, { recursive: true });
writeFileSync(
  resolve(out, 'conformance.json'),
  JSON.stringify(
    { note: 'Generated by tools/reality-fixtures.ts; the keys are test keys only.', keys, expect, cases },
    null,
    1,
  ) + '\n',
);
console.log(`tests/fixtures/reality/conformance.json: ${cases.length} cases`);

// The Bridge's policy (bridge/policy/propose.datalog): tokens and requests with their verdict, for the Rust
// cross-check. The root key is a test key from a fixed seed; Biscuit's blocks carry fresh keys, so the tokens differ
// at every run, never the verdicts.
const b = await biscuitLib();
const rootPriv = `ed25519-private/${'33'.repeat(32)}`;
const kp = b.KeyPair.fromPrivateKey(b.PrivateKey.fromString(rootPriv));
const pub = kp.getPublicKey().toString();
const grant = {
  connector: 'mail-1',
  gameId: 'signals',
  sources: ['mail'],
  signals: ['mail.answer.correct'],
  players: ['p-1', 'p-2'],
  audience: 'bridge.local',
  expiresAt: NOW + 3_600_000,
};
const ask = {
  gameId: 'signals',
  playerId: 'p-1',
  source: 'mail',
  signal: 'mail.answer.correct',
  audience: 'bridge.local',
};
const token = await grantToken(rootPriv, grant);
const narrowed = await attenuate(token, pub, { players: ['p-2'] });
const policyCases: { name: string; token: string; request: typeof ask; now: number }[] = [
  { name: 'granted', token, request: ask, now: NOW },
  { name: 'another game', token, request: { ...ask, gameId: 'demo' }, now: NOW },
  { name: 'another player', token, request: { ...ask, playerId: 'p-9' }, now: NOW },
  { name: 'a signal not granted', token, request: { ...ask, signal: 'mail.admin.reset' }, now: NOW },
  { name: 'another audience', token, request: { ...ask, audience: 'bridge.prod' }, now: NOW },
  { name: 'at expiry', token, request: ask, now: NOW + 3_600_000 },
  { name: 'narrowed: the player kept', token: narrowed, request: { ...ask, playerId: 'p-2' }, now: NOW },
  { name: 'narrowed: the player dropped', token: narrowed, request: ask, now: NOW },
  {
    name: 'tampered',
    token: token.slice(0, 40) + (token[40] === 'A' ? 'B' : 'A') + token.slice(41),
    request: ask,
    now: NOW,
  },
];
const verdicts = [];
for (const c of policyCases) {
  const r = await authorize(c.token, pub, c.request, c.now);
  verdicts.push({ ...c, verdict: r.ok ? 'ok' : r.code });
}
writeFileSync(
  resolve(out, 'policy.json'),
  JSON.stringify(
    {
      note: 'Generated by tools/reality-fixtures.ts; the root key is a test key only.',
      rootPublicKey: pub,
      cases: verdicts,
    },
    null,
    1,
  ) + '\n',
);
console.log(
  `tests/fixtures/reality/policy.json: ${verdicts.length} cases (${verdicts.map((v) => v.verdict).join(' ')})`,
);
