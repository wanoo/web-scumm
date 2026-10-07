// The cryptography of badge verification (4.1.9): compact JWS (EdDSA, ES256, RS256) verified with node:crypto,
// base58btc and multikey for `did:key` (Ed25519 only), JCS (RFC 8785) for the `eddsa-jcs-2022` Data Integrity suite.
// No library: each piece is a few lines and tested against fixtures signed with fixed test seeds.
import { createHash, createPublicKey, type KeyObject, verify } from 'node:crypto';
import { canonicalJson } from '../sdk';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Uint8Array | null {
  if (s.length > 512) return null;
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = `1${s}`;
  }
  return s;
}

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

/** An Ed25519 public key from its 32 raw bytes. */
function ed25519Key(raw: Uint8Array): KeyObject | null {
  if (raw.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI, raw]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/** `did:key:z6Mk…` (an Ed25519 multikey, multicodec 0xed01) → its key; any other method or key type: null. */
export function didKey(did: string): KeyObject | null {
  const m = /^did:key:(z[1-9A-HJ-NP-Za-km-z]{40,60})(?:#\1)?$/.exec(did);
  if (!m) return null;
  return multikey(m[1]!);
}

/** A `publicKeyMultibase` (`z` + base58btc of 0xed 0x01 + 32 bytes) → an Ed25519 key. */
export function multikey(mb: string): KeyObject | null {
  if (!mb.startsWith('z')) return null;
  const b = base58Decode(mb.slice(1));
  if (!b || b.length !== 34 || b[0] !== 0xed || b[1] !== 0x01) return null;
  return ed25519Key(b.subarray(2));
}

export function jwkKey(jwk: unknown): KeyObject | null {
  if (!jwk || typeof jwk !== 'object' || 'd' in jwk) return null; // never a private key
  try {
    return createPublicKey({ key: jwk as import('node:crypto').JsonWebKey, format: 'jwk' });
  } catch {
    return null;
  }
}

export function pemKey(pem: unknown): KeyObject | null {
  if (typeof pem !== 'string' || pem.length > 8192 || !pem.includes('PUBLIC KEY')) return null;
  try {
    return createPublicKey(pem);
  } catch {
    return null;
  }
}

const b64urlJson = (s: string): unknown => {
  try {
    return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};

export interface Jws {
  header: Record<string, unknown>;
  payload: unknown;
  signingInput: string;
  signature: Buffer;
}

/** A compact JWS split and decoded (nothing verified yet), or null. */
export function parseJws(s: string): Jws | null {
  const m = /^([A-Za-z0-9_-]{2,4096})\.([A-Za-z0-9_-]{2,90000})\.([A-Za-z0-9_-]{2,1024})$/.exec(s.trim());
  if (!m) return null;
  const header = b64urlJson(m[1]!);
  const payload = b64urlJson(m[2]!);
  if (!header || typeof header !== 'object' || payload === undefined) return null;
  return {
    header: header as Record<string, unknown>,
    payload,
    signingInput: `${m[1]}.${m[2]}`,
    signature: Buffer.from(m[3]!, 'base64url'),
  };
}

/** The JWS's signature with this key, for EdDSA, ES256 and RS256 only (`none` and the HMAC family never). */
export function verifyJws(jws: Jws, key: KeyObject): boolean {
  const alg = jws.header.alg;
  const data = Buffer.from(jws.signingInput);
  try {
    if (alg === 'EdDSA' && key.asymmetricKeyType === 'ed25519') return verify(null, data, key, jws.signature);
    if (alg === 'ES256' && key.asymmetricKeyType === 'ec')
      return verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, jws.signature);
    if (alg === 'RS256' && key.asymmetricKeyType === 'rsa') return verify('sha256', data, key, jws.signature);
  } catch {
    return false;
  }
  return false;
}

/**
 * `eddsa-jcs-2022` (W3C Data Integrity EdDSA Cryptosuites): SHA-256 of the JCS of the proof's configuration (the proof
 * without `proofValue`, with the document's `@context`), then SHA-256 of the JCS of the document without its proof;
 * the Ed25519 signature is over the two hashes joined.
 */
export function verifyEddsaJcs(doc: Record<string, unknown>, proof: Record<string, unknown>, key: KeyObject): boolean {
  if (typeof proof.proofValue !== 'string' || !proof.proofValue.startsWith('z')) return false;
  const sig = base58Decode(proof.proofValue.slice(1));
  if (!sig || sig.length !== 64) return false;
  const { proofValue: _, ...config } = proof;
  if (doc['@context'] !== undefined) config['@context'] = doc['@context'];
  const { proof: __, ...unsecured } = doc;
  const h = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest();
  try {
    return verify(null, Buffer.concat([h(config), h(unsecured)]), key, sig);
  } catch {
    return false;
  }
}
