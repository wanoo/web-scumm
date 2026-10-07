// The daily challenge and the Mystery seed as a player checks them (4.1.15, D26): a compact JWS signed by the Bridge
// (EdDSA, the key a game's manifest names in `remix.daily`), verified offline with WebCrypto. A day token says the
// game, the day, the seed, the mode and the rules, valid 24 hours; a commitment says a Mystery seed's hash before the
// run starts, and the reveal must match it. The Bridge never chooses a seed after seeing a player's actions: a day's
// seed is fixed before the day, a Mystery seed before its commitment is signed (bridge/src/daily.ts).
import * as z from 'zod/mini';
import { b64url, type BridgeKey } from './protocol';
import { seedCommitment } from '../core/remix/categories';
import { normalizeSeed } from '../core/remix/seed-code';

const DayTokenSchema = z.strictObject({
  format: z.literal('web-scumm-daily'),
  v: z.literal(1),
  gameId: z.string().check(z.minLength(1)),
  date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  seed: z.string(),
  mode: z.string(),
  rules: z.strictObject({ category: z.string(), algorithmVersion: z.int().check(z.positive()) }),
  notBefore: z.number(),
  notAfter: z.number(),
});
/** What a day token says. @public */
export type DayToken = z.infer<typeof DayTokenSchema>;

const CommitSchema = z.strictObject({
  format: z.literal('web-scumm-commit'),
  v: z.literal(1),
  id: z.string().check(z.minLength(1)),
  gameId: z.string().check(z.minLength(1)),
  mode: z.string(),
  commitment: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  issuedAt: z.number(),
});
/** What a Mystery commitment says. @public */
export type CommitToken = z.infer<typeof CommitSchema>;

/** A verified token, or why it is refused. @public */
export type TokenResult<T> = { ok: true; token: T } | { ok: false; reason: string };

async function verifyJws(
  jws: string,
  key: BridgeKey,
): Promise<{ ok: true; payload: unknown } | { ok: false; reason: string }> {
  const parts = typeof jws === 'string' ? jws.split('.') : [];
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) return { ok: false, reason: 'not a compact JWS' };
  const [h, p, s] = parts as [string, string, string];
  const dec = new TextDecoder('utf-8', { fatal: true });
  let header: { alg?: unknown; kid?: unknown };
  let payload: unknown;
  try {
    header = JSON.parse(dec.decode(b64url.decode(h)));
    payload = JSON.parse(dec.decode(b64url.decode(p)));
  } catch {
    return { ok: false, reason: 'unreadable token' };
  }
  if (header.alg !== 'EdDSA' || header.kid !== key.kid) return { ok: false, reason: 'unknown algorithm or key' };
  const ok = await crypto.subtle.verify(
    { name: 'Ed25519' },
    key.key,
    b64url.decode(s) as BufferSource,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return ok ? { ok: true, payload } : { ok: false, reason: 'bad signature' };
}

/**
 * Checks a day token offline: the signature (the game's daily key), the game, the window (24 hours), a well-formed
 * seed. `now` in epoch ms. @public
 */
export async function verifyDayToken(
  jws: string,
  key: BridgeKey,
  gameId: string,
  now: number,
): Promise<TokenResult<DayToken>> {
  const v = await verifyJws(jws, key);
  if (!v.ok) return v;
  const r = DayTokenSchema.safeParse(v.payload);
  if (!r.success) return { ok: false, reason: 'not a day token' };
  const t = r.data;
  if (t.gameId !== gameId) return { ok: false, reason: `a day token of "${t.gameId}"` };
  if (now < t.notBefore || now > t.notAfter) return { ok: false, reason: `the challenge of ${t.date} is not open now` };
  try {
    normalizeSeed(t.seed);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  return { ok: true, token: t };
}

/** Checks a Mystery commitment's signature and game. @public */
export async function verifyCommitment(jws: string, key: BridgeKey, gameId: string): Promise<TokenResult<CommitToken>> {
  const v = await verifyJws(jws, key);
  if (!v.ok) return v;
  const r = CommitSchema.safeParse(v.payload);
  if (!r.success) return { ok: false, reason: 'not a commitment' };
  if (r.data.gameId !== gameId) return { ok: false, reason: `a commitment of "${r.data.gameId}"` };
  return { ok: true, token: r.data };
}

/** Whether a reveal (seed, nonce) is the one a verified commitment hid. @public */
export function revealMatches(c: CommitToken, reveal: { seed: string; nonce: string }): boolean {
  try {
    return seedCommitment(reveal.seed, reveal.nonce) === c.commitment;
  } catch {
    return false;
  }
}
