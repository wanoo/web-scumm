// The Reality Bridge's signed signal (4.1.1, docs/dev/PLAN-4.1-REALITY-BRIDGE.md §4, D15): what a game receives from
// the world outside is a compact JWS (`header.payload.signature`, base64url) signed by the Bridge with Ed25519. The
// player checks, in this order: the size, the shape, the algorithm and the key, the signature on the exact bytes it
// received, and only then decodes the payload and validates it against the schema, the game, the player and the
// game's manifest. Anything else is refused with a reason; nothing unverified reaches the engine. Pure but for
// WebCrypto (Node, the browsers, workers); no library.
import * as z from 'zod/mini';

/** The largest signed signal accepted, in characters: a signal is an identifier, not a document. @public */
export const MAX_SIGNAL_CHARS = 4096;

/**
 * The clock tolerance between the player's device and the Bridge, in milliseconds (4.1.2): a key's window and a
 * signal's expiry are judged with it, so a phone a few minutes off does not refuse every signal. The Rust
 * cross-check (`bridge/xcheck/src/signal.rs`) holds the same value; the conformance corpus has a case on each side.
 */
export const CLOCK_SKEW_MS = 5 * 60_000;

const ident = z.string().check(z.minLength(1), z.maxLength(128), z.regex(/^[\w.:-]+$/));
const time = z.int().check(z.nonnegative());

/** The fields of a signed signal both versions share (4.1.1; 4.1.10 adds `WorldSignalV2`'s context). */
const SIGNAL_FIELDS = {
  format: z.literal('web-scumm-world-signal'),
  /** Unique per signal on the Bridge: what the engine remembers to apply it at most once. */
  id: ident,
  /** Per player, contiguous from 1: the cursor of delivery. */
  sequence: z.int().check(z.positive()),
  gameId: ident,
  playerId: ident,
  /** A signal the game's manifest declares (`GameDef.reality.signals[].id`). */
  signal: ident,
  source: ident,
  occurredAt: z.optional(time),
  receivedAt: time,
  expiresAt: z.optional(time),
  /** The connector's own key for this fact: two deliveries with the same key are one fact. */
  dedupeKey: z.string().check(z.minLength(1), z.maxLength(256)),
  policyVersion: z.string().check(z.minLength(1), z.maxLength(64)),
  /** A hash of what the connector saw, kept by the Bridge; never the evidence itself. */
  evidenceHash: z.optional(z.string().check(z.regex(/^[a-f0-9]{64}$/))),
};

/** The payload the Bridge signs: one accepted fact from outside, as a finite identifier (§4.1). @public */
export const WorldSignalV1Schema = z.strictObject({ ...SIGNAL_FIELDS, schema: z.literal(1) });
/** The signed payload, as `WorldSignalV1Schema` types it. @public */
export type WorldSignalV1 = z.infer<typeof WorldSignalV1Schema>;

/** Where a Bridge runs, as a signal names it (4.1.10): a signal of one environment is refused by another. @public */
export type SignalEnvironment = 'prod' | 'staging' | 'dev';

/**
 * The payload of 4.1.10 (ADR 0010): V1's fields and the context it was signed for, so a signal of one tenant, one
 * environment, one origin, one link or one key is refused by every other (`audience-mismatch`). @public
 */
export const WorldSignalV2Schema = z.strictObject({
  ...SIGNAL_FIELDS,
  schema: z.literal(2),
  /** The tenant of the Bridge that signed it (one operator's game in one environment). */
  tenantId: ident,
  environment: z.enum(['prod', 'staging', 'dev']),
  /** The origin the player paired from (`https://game.example`), or the Bridge's audience without one. */
  audience: z.string().check(z.minLength(1), z.maxLength(256)),
  /** The player's link (one pairing): a signal of an earlier link is not this one's. */
  sessionId: ident,
  /** The key that signed it: equal to the JWS header's `kid`. */
  keyId: ident,
});
/** The signed payload of 4.1.10, as `WorldSignalV2Schema` types it. @public */
export type WorldSignalV2 = z.infer<typeof WorldSignalV2Schema>;
/** Either version of the signed payload. @public */
export type WorldSignal = WorldSignalV1 | WorldSignalV2;

/** A signed signal as it travels: the compact JWS string. @public */
export type SignedWorldSignalV1 = string;

/** One verification key of the Bridge: its id, the key, and when it may sign (epoch ms; rotation overlaps). @public */
export interface BridgeKey {
  kid: string;
  key: CryptoKey;
  notBefore?: number;
  notAfter?: number;
  /** The tenant this key signs for (4.1.10, `GET /v1/keys`): a V2 signal of another tenant is refused. */
  tenantId?: string;
  /** The environment this key signs for (4.1.10): a V2 signal of another environment is refused. */
  environment?: SignalEnvironment;
}
/** The Bridge's verification keys the player trusts (several during a rotation). @public */
export type Keyring = BridgeKey[];

/** What a signal must match besides its signature. @public */
export interface SignalExpectation {
  gameId: string;
  playerId: string;
  /** The signals the game declares (its manifest). */
  signals: ReadonlySet<string>;
  /** Now, epoch ms (the engine's clock in a replay never reaches here: a replay applies recorded entries). */
  now: number;
  /**
   * The versions accepted (4.1.10): both by default; `[2]` for a player that talks to a multi-tenant Bridge, and for
   * every player from 4.1.12 (ADR 0010).
   */
  versions?: readonly (1 | 2)[];
  /** The tenant, environment, origin and link the player expects a V2 signal to name; each checked when given. */
  tenantId?: string;
  environment?: SignalEnvironment;
  audience?: string;
  sessionId?: string;
}

/**
 * Why a signal was refused, as a code (the conformance corpus and the Rust cross-check compare codes) and a sentence.
 * @public
 */
export type RefusalCode =
  | 'size'
  | 'shape'
  | 'header'
  | 'algorithm'
  | 'key'
  | 'key-window'
  | 'signature'
  | 'payload'
  | 'schema'
  | 'game'
  | 'player'
  | 'signal'
  | 'expired'
  | 'audience-mismatch';
/** The outcome of `verifySignal`: the signal it accepted, or the refusal's code and reason. @public */
export type VerifyResult = { ok: true; signal: WorldSignal } | { ok: false; code: RefusalCode; reason: string };

export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array {
    if (!/^[\w-]*$/.test(s)) throw new Error('not base64url');
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

const text = new TextDecoder('utf-8', { fatal: true });
const fail = (code: RefusalCode, reason: string): VerifyResult => ({ ok: false, code, reason });

/** An Ed25519 public key from its 32 raw bytes in base64url (a manifest's or a Bridge's configuration). @public */
export async function importBridgeKey(
  kid: string,
  raw: string,
  window: Omit<BridgeKey, 'kid' | 'key'> = {},
): Promise<BridgeKey> {
  const key = await crypto.subtle.importKey('raw', b64url.decode(raw) as BufferSource, { name: 'Ed25519' }, false, [
    'verify',
  ]);
  return { kid, key, ...window };
}

/**
 * Checks a signed signal, then what it says. The reason of a refusal is a short sentence (logged, never shown raw).
 * @public
 */
export async function verifySignal(jws: unknown, keyring: Keyring, expect: SignalExpectation): Promise<VerifyResult> {
  if (typeof jws !== 'string') return fail('shape', 'not a string');
  if (jws.length > MAX_SIGNAL_CHARS) return fail('size', `larger than ${MAX_SIGNAL_CHARS} characters`);
  const parts = jws.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) return fail('shape', 'not a compact JWS');
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  try {
    header = JSON.parse(text.decode(b64url.decode(h)));
  } catch {
    return fail('header', 'unreadable header');
  }
  // An object, not a list: a list is an object for `typeof`, and the Rust cross-check says `header` for it.
  if (!header || typeof header !== 'object' || Array.isArray(header)) return fail('header', 'unreadable header');
  const { alg, kid, ...rest } = header as Record<string, unknown>;
  if (alg !== 'EdDSA') return fail('algorithm', `unknown algorithm ${JSON.stringify(alg)}`);
  if (Object.keys(rest).some((k) => k !== 'typ')) return fail('header', 'unknown header field');
  const k = keyring.find((x) => x.kid === kid);
  if (!k) return fail('key', `unknown key ${JSON.stringify(kid)}`);
  if (
    (k.notBefore !== undefined && expect.now < k.notBefore - CLOCK_SKEW_MS) ||
    (k.notAfter !== undefined && expect.now > k.notAfter + CLOCK_SKEW_MS)
  )
    return fail('key-window', `key ${k.kid} is not valid now`);
  let sig: Uint8Array;
  try {
    sig = b64url.decode(s);
  } catch {
    return fail('signature', 'unreadable signature');
  }
  const signed = new TextEncoder().encode(`${h}.${p}`);
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, k.key, sig as BufferSource, signed)))
    return fail('signature', 'bad signature');
  // Signed by the Bridge: now the payload may be read.
  let payload: unknown;
  try {
    payload = JSON.parse(text.decode(b64url.decode(p)));
  } catch {
    return fail('payload', 'unreadable payload');
  }
  const versions = expect.versions ?? [1, 2];
  const schema = payload && typeof payload === 'object' ? (payload as { schema?: unknown }).schema : undefined;
  if (payload && typeof payload === 'object' && !versions.includes(schema as 1 | 2))
    return fail('schema', `unknown schema ${JSON.stringify(schema)}`);
  const parsed = (schema === 2 ? WorldSignalV2Schema : WorldSignalV1Schema).safeParse(payload);
  if (!parsed.success)
    return fail('payload', `not a world signal: ${parsed.error.issues[0]?.path.join('.') || 'shape'}`);
  const sgn: WorldSignal = parsed.data;
  if (sgn.schema === 2) {
    // The context the signal was signed for (ADR 0010): its key by name, then the key's tenant and environment, then
    // what the player expects. A V1 signal names none of it, which is why a multi-tenant player accepts V2 only.
    if (sgn.keyId !== k.kid) return fail('key', `signed by ${k.kid}, names ${sgn.keyId}`);
    const mismatch =
      (k.tenantId !== undefined && sgn.tenantId !== k.tenantId) ||
      (k.environment !== undefined && sgn.environment !== k.environment) ||
      (expect.tenantId !== undefined && sgn.tenantId !== expect.tenantId) ||
      (expect.environment !== undefined && sgn.environment !== expect.environment) ||
      (expect.audience !== undefined && sgn.audience !== expect.audience) ||
      (expect.sessionId !== undefined && sgn.sessionId !== expect.sessionId);
    if (mismatch) return fail('audience-mismatch', 'signed for another tenant, environment, origin or link');
  }
  if (sgn.gameId !== expect.gameId) return fail('game', `for game ${sgn.gameId}`);
  if (sgn.playerId !== expect.playerId) return fail('player', 'for another player');
  if (!expect.signals.has(sgn.signal)) return fail('signal', `signal ${sgn.signal} is not in the manifest`);
  if (sgn.expiresAt !== undefined && expect.now > sgn.expiresAt + CLOCK_SKEW_MS) return fail('expired', 'expired');
  return { ok: true, signal: sgn };
}

/** Signs a payload as the Bridge does (the Bridge, the tests, the Studio's simulator). @public */
export async function signSignal(payload: WorldSignal, key: CryptoKey, kid: string): Promise<SignedWorldSignalV1> {
  const enc = (o: unknown) => b64url.encode(new TextEncoder().encode(JSON.stringify(o)));
  const h = enc({ alg: 'EdDSA', kid });
  const p = enc(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url.encode(sig)}`;
}
