// The Bridge's signature, synchronous (4.1.10): `appendSignal` signs inside its transaction, where an `await` would
// hold a database lock across the event loop. Node's Ed25519 is deterministic, and the bytes are those of
// `signSignal` (src/engine/reality/protocol.ts): the same header, the same `JSON.stringify` of the payload; the
// tests compare the two.
import { KeyObject, sign } from 'node:crypto';
import type { SignedWorldSignalV1, WorldSignal } from '../../src/engine/reality/protocol';

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A WebCrypto private key as the `KeyObject` Node signs with synchronously (works for a non-extractable key). */
export const keyObject = (key: CryptoKey): KeyObject => KeyObject.from(key);

/** Signs a payload as `signSignal` does, without a promise. */
export function signSignalSync(payload: WorldSignal, key: KeyObject, kid: string): SignedWorldSignalV1 {
  const h = enc({ alg: 'EdDSA', kid });
  const p = enc(payload);
  return `${h}.${p}.${sign(null, Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
