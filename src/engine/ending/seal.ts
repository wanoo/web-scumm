// Decryption of the sealed ending file (AES-GCM, key derived from the game password).
// The password is nowhere in the bundle: we simply try to decrypt.
/**
 * Encrypted content of the ending. The game decides the texts; the engine displays them.
 * The field names are part of the format of already-sealed files: don't rename them.
 */
export interface RevealPayload {
  /** Text hidden under the scratch area (simple HTML allowed). */
  ticket: string;
  /** Big announcement on the final card. */
  headline: string;
  /** Short note on the card. */
  message?: string;
  /** Photos (data URI) on the card. */
  photos?: string[];
  /** Extra lines on the card. */
  lines?: string[];
  /** Actual outcome, to judge the player's guess. Absent in a test sealed file. */
  outcome?: string;
}
/** Generic name for the sealed content (same format as RevealPayload). */
export type EndingPayload = RevealPayload;

export const MAGIC = 'FIS1';
export const PBKDF2_ITERATIONS = 120000;

export function normalizePassword(p: string): string {
  return p
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function deriveKey(subtle: SubtleCrypto, password: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await subtle.importKey('raw', new TextEncoder().encode(normalizePassword(password)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(
  subtle: SubtleCrypto,
  payload: RevealPayload,
  password: string,
  random: (n: number) => Uint8Array,
): Promise<Uint8Array> {
  const salt = random(16);
  const iv = random(12);
  const key = await deriveKey(subtle, password, salt);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource),
  );
  const out = new Uint8Array(4 + 16 + 12 + ct.length);
  out.set(new TextEncoder().encode(MAGIC), 0);
  out.set(salt, 4);
  out.set(iv, 20);
  out.set(ct, 32);
  return out;
}

export async function unseal(
  subtle: SubtleCrypto,
  bytes: ArrayBuffer | Uint8Array,
  password: string,
): Promise<RevealPayload | null> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < 33) return null;
  if (new TextDecoder().decode(buf.slice(0, 4)) !== MAGIC) return null;
  const salt = buf.slice(4, 20);
  const iv = buf.slice(20, 32);
  const ct = buf.slice(32);
  try {
    const key = await deriveKey(subtle, password, salt);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain)) as RevealPayload;
  } catch {
    return null;
  }
}
