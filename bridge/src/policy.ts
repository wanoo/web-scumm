// Biscuit capabilities of the Bridge (4.1.1, D16): a connector's token, attenuated, and the check of a proposed signal
// against bridge/policy/propose.datalog. Biscuit says who may propose what; the event's signature (protocol.ts) says
// what the Bridge accepted. Server-side only (tests/boundaries.test.ts).
import { readFileSync } from 'node:fs';
import { biscuitLib, errorClass } from './biscuit';

/**
 * Biscuit's run limits for one authorisation: 200 ms (its default is one millisecond, which a loaded server or a slow
 * CI runner can pass on a legitimate token and refuse it as a timeout); the facts and iterations keep their defaults.
 */
export const LIMITS = { max_time_micro: 200_000 };

export const POLICY = readFileSync(new URL('../policy/propose.datalog', import.meta.url), 'utf8');

/** What a connector may do, as the operator grants it (`web-scumm bridge grant`). */
export interface Grant {
  connector: string;
  gameId: string;
  sources: string[];
  signals: string[];
  /** Pseudonymous player ids, or every player of the game. */
  players: string[] | 'any';
  audience: string;
  /**
   * Epoch ms from which the token is refused. Biscuit's dates are whole seconds: the token holds strictly before
   * that second (an expiry at 13:00:00.500 refuses from 13:00:00).
   */
  expiresAt: number;
}

/** A proposed signal, as the connector sends it. */
export interface Proposal {
  gameId: string;
  playerId: string;
  source: string;
  signal: string;
  audience: string;
}

export type Authorization =
  | { ok: true; revocationIds: string[] }
  | { ok: false; code: 'format' | 'denied' | 'revoked'; reason: string };

/** Datalog's string literal (identifiers are checked by the protocol's schema; quotes and backslashes escaped anyway). */
const lit = (s: string) => JSON.stringify(s);

/** Mints a connector's token from the root private key (`ed25519-private/<hex>`), with its expiry as a check. */
export async function grantToken(rootPrivateKey: string, g: Grant): Promise<string> {
  const b = await biscuitLib();
  const root = b.PrivateKey.fromString(rootPrivateKey);
  const facts = [
    `connector(${lit(g.connector)});`,
    `game(${lit(g.gameId)});`,
    `audience(${lit(g.audience)});`,
    ...g.sources.map((s) => `source(${lit(s)});`),
    ...g.signals.map((s) => `signal(${lit(s)});`),
    ...(g.players === 'any' ? ['any_player(true);'] : g.players.map((p) => `player(${lit(p)});`)),
    `check if time($t), $t < ${new Date(g.expiresAt).toISOString()};`,
  ];
  const builder = b.Biscuit.builder();
  builder.addCode(facts.join('\n'));
  return builder.build(root).toBase64();
}

/** Attenuates a token: fewer players, an earlier expiry (a block of checks; it cannot add a right). */
export async function attenuate(
  token: string,
  rootPublicKey: string,
  o: { players?: string[]; expiresAt?: number },
): Promise<string> {
  const b = await biscuitLib();
  const t = b.Biscuit.fromBase64(
    token,
    b.PublicKey.fromString(rootPublicKey.replace(/^ed25519\//, ''), b.SignatureAlgorithm.Ed25519),
  );
  const checks = [
    ...(o.players ? [`check if request_player($p), ${JSON.stringify(o.players)}.contains($p);`] : []),
    ...(o.expiresAt !== undefined ? [`check if time($t), $t < ${new Date(o.expiresAt).toISOString()};`] : []),
  ];
  const block = b.Biscuit.block_builder();
  block.addCode(checks.join('\n'));
  return t.appendBlock(block).toBase64();
}

/** Checks a proposed signal: the token's signature and revocation, then the policy with the request and the time. */
export async function authorize(
  token: string,
  rootPublicKey: string,
  p: Proposal,
  now: number,
  revoked: ReadonlySet<string> = new Set(),
): Promise<Authorization> {
  const b = await biscuitLib();
  let t: ReturnType<typeof b.Biscuit.fromBase64>;
  try {
    t = b.Biscuit.fromBase64(
      token,
      b.PublicKey.fromString(rootPublicKey.replace(/^ed25519\//, ''), b.SignatureAlgorithm.Ed25519),
    );
  } catch (e) {
    return { ok: false, code: 'format', reason: `unreadable token (${errorClass(e)})` };
  }
  const revocationIds = t.getRevocationIdentifiers() as string[];
  if (revocationIds.some((id) => revoked.has(id))) return { ok: false, code: 'revoked', reason: 'token revoked' };
  const a = new b.AuthorizerBuilder();
  a.addCodeWithParameters(
    POLICY,
    {
      now: { date: new Date(now).toISOString() }, // a date term, as biscuit-wasm's prepareTerm writes it
      game: p.gameId,
      player: p.playerId,
      source: p.source,
      signal: p.signal,
      audience: p.audience,
    },
    {},
  );
  try {
    a.buildAuthenticated(t).authorizeWithLimits(LIMITS);
  } catch (e) {
    return { ok: false, code: 'denied', reason: `not allowed (${errorClass(e)})` };
  }
  return { ok: true, revocationIds };
}
