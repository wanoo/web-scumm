// The twelve Open Badges fixtures (4.1.9, connectors/test-vectors/open-badge/fixtures.json): two valid badges per format
// (OB2 hosted and signed, OB3 VC-JWT and Data Integrity `eddsa-jcs-2022`), expired, revoked twice, an unknown issuer,
// a broken signature, a recursive JSON-LD, a redirect to 127.0.0.1, someone else's badge. Signed with keys derived
// from fixed TEST seeds (never a real key), so the file is reproducible: `npx tsx tests/fixtures/connectors/badges.ts`
// writes it again, and tests/connectors-badges.test.ts checks it did not drift.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { base58Encode } from '../../../connectors/src/badges/crypto';
import { canonicalJson } from '../../../connectors/src/sdk';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyOf = (seedByte: number) => {
  const priv = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, Buffer.alloc(32, seedByte)]),
    format: 'der',
    type: 'pkcs8',
  });
  const pub = createPublicKey(priv);
  const raw = pub.export({ format: 'der', type: 'spki' }).subarray(12);
  return { priv, pem: pub.export({ format: 'pem', type: 'spki' }).toString(), raw };
};
const b64u = (x: unknown) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const jws = (header: object, payload: object, priv: ReturnType<typeof keyOf>['priv']) => {
  const input = `${b64u(header)}.${b64u(payload)}`;
  return `${input}.${sign(null, Buffer.from(input), priv).toString('base64url')}`;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const ISSUER = 'https://badges.example.org/issuer';
export const EMAIL = 'robin@player.example';
const SALT = 'pepper';
const recipient = { type: 'email', hashed: true, salt: SALT, identity: `sha256$${sha(EMAIL + SALT)}` };

const ob2Key = keyOf(1);
const ob3Key = keyOf(2);
export const DID = `did:key:z${base58Encode(new Uint8Array([0xed, 0x01, ...ob3Key.raw]))}`;
const VM = `${DID}#${DID.slice(8)}`;
const NOW = '2026-10-07T00:00:00Z';

/** A Data Integrity proof `eddsa-jcs-2022` over a credential (the W3C suite, as `verifyEddsaJcs` checks it). */
function signDi(doc: Record<string, unknown>, priv = ob3Key.priv) {
  const proof = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: NOW,
    verificationMethod: VM,
    proofPurpose: 'assertionMethod',
  };
  const h = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest();
  const sig = sign(null, Buffer.concat([h({ ...proof, '@context': doc['@context'] }), h(doc)]), priv);
  return { ...doc, proof: { ...proof, proofValue: `z${base58Encode(new Uint8Array(sig))}` } };
}

const credential = (id: string, extra: Record<string, unknown> = {}, subject: Record<string, unknown> = {}) => ({
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json'],
  id,
  type: ['VerifiableCredential', 'OpenBadgeCredential'],
  issuer: { id: DID, type: ['Profile'], name: 'The Garden Guild' },
  validFrom: '2026-01-01T00:00:00Z',
  name: 'Shed opener',
  credentialSubject: {
    type: ['AchievementSubject'],
    identifier: [
      {
        type: 'IdentityObject',
        identityHash: `sha256$${sha(EMAIL + SALT)}`,
        identityType: 'emailAddress',
        hashed: true,
        salt: SALT,
      },
    ],
    achievement: { id: 'urn:uuid:achievement-1', type: ['Achievement'], name: 'Shed opener' },
    ...subject,
  },
  ...extra,
});

type Doc = unknown | { status: number } | { redirect: string };
export interface BadgeCase {
  submission: { badge: unknown; email?: string };
  expect: 'valid' | 'invalid' | 'expired' | 'revoked' | 'indeterminate';
  /** Fetched through the real SSRF-safe fetcher, not the documents map. */
  network?: true;
}

export function badgeFixtures(): { documents: Record<string, Doc>; cases: Record<string, BadgeCase> } {
  const A = 'https://badges.example.org/assertions';
  const assertion = (n: string, extra: Record<string, unknown> = {}) => ({
    '@context': 'https://w3id.org/openbadges/v2',
    type: 'Assertion',
    id: `${A}/${n}`,
    recipient,
    badge: 'https://badges.example.org/badges/shed',
    verification: { type: 'hosted' },
    issuedOn: '2026-01-01T00:00:00Z',
    ...extra,
  });
  const signedAssertion = (n: string) => ({
    ...assertion(n),
    id: `urn:uuid:${n}`,
    verification: { type: 'signed', creator: 'https://badges.example.org/keys/1' },
  });
  const bits = Buffer.alloc(16 * 1024);
  bits[0] = 0b00000100; // index 5 revoked
  const statusList = signDi({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'https://badges.example.org/status/1',
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: DID,
    validFrom: '2026-01-01T00:00:00Z',
    credentialSubject: {
      id: 'https://badges.example.org/status/1#list',
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList: `u${gzipSync(bits).toString('base64url')}`,
    },
  });
  const status = (index: number) => ({
    credentialStatus: {
      id: `https://badges.example.org/status/1#${index}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: String(index),
      statusListCredential: 'https://badges.example.org/status/1',
    },
  });
  let deep: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 20; i++) deep = { nested: deep };
  const broken = signDi(credential('urn:uuid:broken'));
  broken.proof.proofValue = `z${base58Encode(new Uint8Array(64).fill(7))}`;
  const documents: Record<string, Doc> = {
    'https://badges.example.org/badges/shed': {
      '@context': 'https://w3id.org/openbadges/v2',
      type: 'BadgeClass',
      id: 'https://badges.example.org/badges/shed',
      name: 'Shed opener',
      issuer: ISSUER,
    },
    'https://badges.example.org/badges/stranger': {
      type: 'BadgeClass',
      id: 'https://badges.example.org/badges/stranger',
      name: 'Elsewhere',
      issuer: 'https://elsewhere.example/issuer',
    },
    [ISSUER]: {
      '@context': 'https://w3id.org/openbadges/v2',
      type: 'Issuer',
      id: ISSUER,
      name: 'The Garden Guild',
      revocationList: 'https://badges.example.org/revocations',
    },
    'https://badges.example.org/revocations': {
      type: 'RevocationList',
      id: 'https://badges.example.org/revocations',
      issuer: ISSUER,
      revokedAssertions: ['urn:uuid:ob2-revoked'],
    },
    'https://badges.example.org/keys/1': {
      type: 'CryptographicKey',
      id: 'https://badges.example.org/keys/1',
      owner: ISSUER,
      publicKeyPem: ob2Key.pem,
    },
    [`${A}/ob2-hosted-valid`]: assertion('ob2-hosted-valid'),
    [`${A}/ob2-expired`]: assertion('ob2-expired', { expires: '2026-02-01T00:00:00Z' }),
    [`${A}/ob2-unknown-issuer`]: assertion('ob2-unknown-issuer', {
      badge: 'https://badges.example.org/badges/stranger',
    }),
    'https://badges.example.org/status/1': statusList,
  };
  const cases: Record<string, BadgeCase> = {
    'ob2-hosted-valid': { submission: { badge: `${A}/ob2-hosted-valid`, email: EMAIL }, expect: 'valid' },
    'ob2-signed-valid': {
      submission: { badge: jws({ alg: 'EdDSA' }, signedAssertion('ob2-signed-valid'), ob2Key.priv), email: EMAIL },
      expect: 'valid',
    },
    'ob3-jwt-valid': {
      submission: {
        badge: jws({ alg: 'EdDSA', typ: 'vc+jwt', kid: VM }, credential('urn:uuid:ob3-jwt-valid'), ob3Key.priv),
        email: EMAIL,
      },
      expect: 'valid',
    },
    'ob3-di-valid': {
      submission: { badge: signDi(credential('urn:uuid:ob3-di-valid', status(4))), email: EMAIL },
      expect: 'valid',
    },
    'ob2-expired': { submission: { badge: `${A}/ob2-expired`, email: EMAIL }, expect: 'expired' },
    'ob2-revoked': {
      submission: { badge: jws({ alg: 'EdDSA' }, signedAssertion('ob2-revoked'), ob2Key.priv), email: EMAIL },
      expect: 'revoked',
    },
    'ob3-revoked': {
      submission: { badge: signDi(credential('urn:uuid:ob3-revoked', status(5))), email: EMAIL },
      expect: 'revoked',
    },
    'ob2-unknown-issuer': { submission: { badge: `${A}/ob2-unknown-issuer`, email: EMAIL }, expect: 'invalid' },
    'ob3-broken-signature': { submission: { badge: broken, email: EMAIL }, expect: 'invalid' },
    'ob3-recursive-jsonld': {
      submission: { badge: signDi(credential('urn:uuid:deep', {}, { evidence: deep })), email: EMAIL },
      expect: 'invalid',
    },
    'ob2-redirect-loopback': {
      submission: { badge: 'https://badges.example.org/assertions/redirected', email: EMAIL },
      expect: 'indeterminate',
      network: true,
    },
    'ob3-wrong-recipient': {
      submission: { badge: signDi(credential('urn:uuid:ob3-wrong-recipient')), email: 'someone@else.example' },
      expect: 'invalid',
    },
  };
  return { documents, cases };
}

if (process.argv[1]?.endsWith('badges.ts'))
  writeFileSync('connectors/test-vectors/open-badge/fixtures.json', `${JSON.stringify(badgeFixtures(), null, 1)}\n`);
