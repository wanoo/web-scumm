// The reference Reality Bridge (4.1.1, docs/dev/PLAN-4.1-REALITY-BRIDGE.md §7): pairing, signals proposed by
// connectors under a Biscuit, the journal, Ed25519 signatures, acknowledgements, revocation, quotas, export and
// deletion by player. No HTTP here (`server.ts` maps routes onto these methods), so the tests drive it directly. It
// never touches a game's files, the Studio or the repository: what it knows of a game is its manifest.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { manifestHash, type RealityManifest } from '../../src/engine/reality/manifest';
import { signSignal, type WorldSignalV1 } from '../../src/engine/reality/protocol';
import { biscuitLib, errorClass } from './biscuit';
import { KeyedLock } from './lock';
import { authorize, LIMITS, type Proposal } from './policy';
import type { BridgeStore, JournalEntry, Player } from './store';

const PAIR_POLICY = readFileSync(new URL('../policy/pair.datalog', import.meta.url), 'utf8');

export interface BridgeConfig {
  gameId: string;
  manifest: RealityManifest;
  /** The manifest's hash as deployed: the Bridge refuses to start on another manifest (an old configuration). */
  manifestHash: string;
  /** Who the Bridge is for its connectors' tokens (`audience` in a grant). */
  audience: string;
  /** Biscuit's root public key (`ed25519/<hex>`): the connectors' tokens are minted from its private half. */
  biscuitRootPublicKey: string;
  /** The key that signs events, and the previous ones the players may still hold (rotation). */
  eventKey: { kid: string; privateKey: CryptoKey; raw: string };
  previousKeys?: { kid: string; raw: string; notAfter: number }[];
  /** SHA-256 (hex) of the operator's token. */
  adminTokenHash: string;
  policyVersion: string;
  limits?: Partial<Limits>;
}

export interface Limits {
  /** A request body, in bytes. */
  bodyBytes: number;
  /** Signals one connector may propose per minute. */
  perMinutePerConnector: number;
  /** Signals waiting for a player's acknowledgement: beyond, a proposal is refused (visible, never dropped). */
  pendingPerPlayer: number;
  /** How long a pairing code waits for its confirmation. */
  pairingMs: number;
  /** How long a player's capability lives without an acknowledgement (renewed on each). */
  capabilityMs: number;
}
export const DEFAULT_LIMITS: Limits = {
  bodyBytes: 8192,
  perMinutePerConnector: 120,
  pendingPerPlayer: 1000,
  pairingMs: 10 * 60_000,
  capabilityMs: 30 * 24 * 3_600_000,
};

export class BridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A line of the Bridge's log: what happened, never a token, an email, a payload or a key. */
export type BridgeLog = { event: string; [k: string]: string | number | boolean | undefined };

const IDENT = /^[\w.:-]{1,128}$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Buffer) => b.toString('base64url');
/** A short code a person can type: 8 characters, no 0/O or 1/I/L. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const pairingCode = () => [...randomBytes(8)].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');

export class Bridge {
  readonly limits: Limits;
  private recent = new Map<string, number[]>();
  private listeners = new Set<(e: JournalEntry) => void>();
  /** One section at a time per player (`propose`) and per pairing code (`confirmPairing`): see `lock.ts`. */
  private locks = new KeyedLock();

  private constructor(
    readonly config: BridgeConfig,
    private store: BridgeStore,
    private now: () => number,
    private log: (l: BridgeLog) => void,
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...config.limits };
  }

  /** A Bridge for one game; refuses a manifest that is not the one its configuration names. */
  static async start(
    config: BridgeConfig,
    store: BridgeStore,
    o: { now?: () => number; log?: (l: BridgeLog) => void } = {},
  ): Promise<Bridge> {
    const actual = await manifestHash(config.manifest);
    if (actual !== config.manifestHash)
      throw new Error(
        `the game's manifest (${actual.slice(0, 12)}…) is not the one configured (${config.manifestHash.slice(0, 12)}…)`,
      );
    if (config.manifest.gameId !== config.gameId) throw new Error(`the manifest is for ${config.manifest.gameId}`);
    return new Bridge(config, store, o.now ?? Date.now, o.log ?? ((l) => console.log(JSON.stringify(l))));
  }

  /** The keys a player verifies events with (public halves only). */
  keys(): { kid: string; raw: string; notBefore?: number; notAfter?: number }[] {
    return [{ kid: this.config.eventKey.kid, raw: this.config.eventKey.raw }, ...(this.config.previousKeys ?? [])];
  }

  // ------------------------------------------------------------------ pairing

  /** The player's side asks to be linked: a short code to give to a connector (an email, a webhook form). */
  startPairing(gameId: string): { code: string; expiresAt: number } {
    if (gameId !== this.config.gameId) throw new BridgeError(404, 'game', 'not a game of this Bridge');
    const code = pairingCode();
    const expiresAt = this.now() + this.limits.pairingMs;
    this.store.write({ t: 'pairing', p: { code, gameId, expiresAt } });
    this.log({ event: 'pairing.started' });
    return { code, expiresAt };
  }

  /** A connector, under a Biscuit that may pair (`pair(true)`), confirms a code it received: a pseudonymous player. */
  confirmPairing(token: string, code: string): Promise<{ playerId: string }> {
    // Two connectors confirming one code at once: the second waits for the first and finds it confirmed.
    return this.locks.run(`pairing:${code}`, () => this.confirmPairingLocked(token, code));
  }

  private async confirmPairingLocked(token: string, code: string): Promise<{ playerId: string }> {
    const p = this.store.pairing(code);
    if (!p || p.expiresAt < this.now()) throw new BridgeError(404, 'pairing', 'unknown or expired code');
    if (p.playerId) throw new BridgeError(409, 'pairing', 'already confirmed');
    const b = await biscuitLib();
    let t: ReturnType<typeof b.Biscuit.fromBase64>;
    try {
      t = b.Biscuit.fromBase64(
        token,
        b.PublicKey.fromString(
          this.config.biscuitRootPublicKey.replace(/^ed25519\//, ''),
          b.SignatureAlgorithm.Ed25519,
        ),
      );
    } catch {
      throw new BridgeError(401, 'token', 'unreadable token');
    }
    if ((t.getRevocationIdentifiers() as string[]).some((id) => this.store.tokenRevoked(id)))
      throw new BridgeError(401, 'token', 'token revoked');
    const a = new b.AuthorizerBuilder();
    a.addCodeWithParameters(
      PAIR_POLICY,
      { now: { date: new Date(this.now()).toISOString() }, game: p.gameId, audience: this.config.audience },
      {},
    );
    try {
      a.buildAuthenticated(t).authorizeWithLimits(LIMITS);
    } catch (e) {
      throw new BridgeError(403, 'denied', `this token may not pair (${errorClass(e)})`);
    }
    const playerId = `p-${randomBytes(8).toString('hex')}`;
    const capability = b64url(randomBytes(32));
    const player: Player = {
      playerId,
      gameId: p.gameId,
      capabilityHash: sha256(capability),
      capabilityExpiresAt: this.now() + this.limits.capabilityMs,
    };
    this.store.write({ t: 'player', p: player });
    this.store.write({ t: 'pairing', p: { ...p, playerId, capability } });
    this.log({ event: 'pairing.confirmed', playerId });
    return { playerId };
  }

  /** The player's side collects its link once: its id and its capability (read and acknowledge, nothing else). */
  claimPairing(code: string): { status: 'pending' } | { status: 'paired'; playerId: string; capability: string } {
    const p = this.store.pairing(code);
    if (!p || p.expiresAt < this.now()) throw new BridgeError(404, 'pairing', 'unknown or expired code');
    if (!p.playerId) return { status: 'pending' };
    if (!p.capability) throw new BridgeError(410, 'pairing', 'already claimed');
    this.store.write({ t: 'pairing', p: { ...p, capability: undefined } });
    return { status: 'paired', playerId: p.playerId, capability: p.capability };
  }

  // ------------------------------------------------------------------ signals

  /** A connector proposes a signal: authorised, checked against the manifest, deduplicated, sequenced, signed. */
  async propose(token: string, body: unknown): Promise<{ id: string; sequence: number; duplicate: boolean }> {
    const r = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const str = (k: string, re = IDENT) => {
      const v = r[k];
      if (typeof v !== 'string' || !re.test(v)) throw new BridgeError(400, 'shape', `\`${k}\` is missing or malformed`);
      return v;
    };
    const playerId = str('playerId');
    const signal = str('signal');
    const source = str('source');
    const dedupeKey = str('dedupeKey', /^.{1,256}$/s);
    const occurredAt =
      typeof r.occurredAt === 'number' && Number.isInteger(r.occurredAt) && r.occurredAt >= 0
        ? r.occurredAt
        : undefined;
    const evidenceHash = r.evidenceHash === undefined ? undefined : str('evidenceHash', /^[a-f0-9]{64}$/);
    const declared = this.config.manifest.signals.find((s) => s.id === signal);
    if (!declared) throw new BridgeError(422, 'signal', `signal ${signal} is not in the game's manifest`);
    if (declared.source !== source)
      throw new BridgeError(422, 'source', `signal ${signal} comes from ${declared.source}`);
    const player = this.store.player(playerId);
    if (!player || player.gameId !== this.config.gameId || player.revoked)
      throw new BridgeError(404, 'player', 'unknown or revoked player');
    const proposal: Proposal = { gameId: this.config.gameId, playerId, source, signal, audience: this.config.audience };
    const auth = await authorize(
      token,
      this.config.biscuitRootPublicKey,
      proposal,
      this.now(),
      this.store.revokedTokens(),
    );
    if (!auth.ok) {
      this.log({ event: 'signal.refused', code: auth.code, signal });
      throw new BridgeError(auth.code === 'denied' ? 403 : 401, auth.code, auth.reason);
    }
    // From here to the journal line, one proposal at a time for this player: the deduplication, the quota, the
    // sequence and the write are read and decided together, and what was checked before the Biscuit's `await`
    // (the player, the token) is checked again, as a revocation may have landed meanwhile.
    return this.locks.run(`player:${playerId}`, async () => {
      const current = this.store.player(playerId);
      if (!current || current.revoked) throw new BridgeError(404, 'player', 'unknown or revoked player');
      if (auth.revocationIds.some((id) => this.store.tokenRevoked(id)))
        throw new BridgeError(401, 'revoked', 'token revoked');
      const seen = this.store.bySequenceKey(playerId, dedupeKey);
      if (seen) return { id: seen.id, sequence: seen.sequence, duplicate: true };
      const connector = auth.revocationIds[0] ?? 'unknown';
      const window = (this.recent.get(connector) ?? []).filter((t) => t > this.now() - 60_000);
      if (window.length >= this.limits.perMinutePerConnector)
        throw new BridgeError(429, 'quota', 'too many signals this minute');
      const sequence = this.store.lastSequence(playerId) + 1;
      if (sequence - 1 - this.store.acked(playerId) >= this.limits.pendingPerPlayer)
        throw new BridgeError(429, 'pending', 'the player has too many signals waiting');
      window.push(this.now());
      this.recent.set(connector, window);
      const payload: WorldSignalV1 = {
        format: 'web-scumm-world-signal',
        schema: 1,
        id: `s-${randomBytes(8).toString('hex')}`,
        sequence,
        gameId: this.config.gameId,
        playerId,
        signal,
        source,
        ...(occurredAt !== undefined ? { occurredAt } : {}),
        receivedAt: this.now(),
        dedupeKey,
        policyVersion: this.config.policyVersion,
        ...(evidenceHash ? { evidenceHash } : {}),
      };
      const jws = await signSignal(payload, this.config.eventKey.privateKey, this.config.eventKey.kid);
      const entry: JournalEntry = { playerId, sequence, id: payload.id, dedupeKey, jws, at: this.now() };
      this.store.write({ t: 'signal', e: entry });
      this.log({ event: 'signal.accepted', playerId, sequence, signal });
      for (const l of this.listeners) l(entry);
      return { id: payload.id, sequence, duplicate: false };
    });
  }

  /** The player whose capability this is (read and acknowledge only). */
  playerOf(capability: string | undefined): Player {
    const p = capability ? this.store.playerByCapability(sha256(capability)) : undefined;
    if (!p || p.revoked) throw new BridgeError(401, 'capability', 'unknown or revoked link');
    if (p.capabilityExpiresAt < this.now()) throw new BridgeError(401, 'capability', 'link expired: pair again');
    return p;
  }

  /** The signed signals of a player after a sequence (the fetch by cursor; SSE sends the same). */
  signals(capability: string | undefined, after: number): { sequence: number; jws: string }[] {
    const p = this.playerOf(capability);
    return this.store.signals(p.playerId, after).map((e) => ({ sequence: e.sequence, jws: e.jws }));
  }

  /** New signals of a player as they are accepted (SSE). Returns the unsubscribe function. */
  subscribe(capability: string | undefined, on: (seq: number, jws: string) => void): () => void {
    const p = this.playerOf(capability);
    const l = (e: JournalEntry) => {
      if (e.playerId === p.playerId) on(e.sequence, e.jws);
    };
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Everything up to `through` is applied and saved on the player's side; the link lives on. */
  ack(capability: string | undefined, through: unknown): void {
    const p = this.playerOf(capability);
    if (
      typeof through !== 'number' ||
      !Number.isInteger(through) ||
      through < 0 ||
      through > this.store.lastSequence(p.playerId)
    )
      throw new BridgeError(400, 'shape', '`through` is a sequence the Bridge sent');
    this.store.write({ t: 'ack', playerId: p.playerId, through });
    this.store.write({ t: 'player', p: { ...p, capabilityExpiresAt: this.now() + this.limits.capabilityMs } });
  }

  // ------------------------------------------------------------------ the operator

  admin(token: string | undefined): void {
    if (!token || sha256(token) !== this.config.adminTokenHash) throw new BridgeError(401, 'admin', 'not the operator');
  }

  /** Revokes a player's link, or a connector's token (one of its revocation ids). */
  revoke(adminToken: string | undefined, what: { playerId?: string; tokenId?: string }): void {
    this.admin(adminToken);
    if (what.playerId) {
      const p = this.store.player(what.playerId);
      if (!p) throw new BridgeError(404, 'player', 'unknown player');
      this.store.write({ t: 'player', p: { ...p, revoked: true } });
      this.log({ event: 'player.revoked', playerId: p.playerId });
    }
    if (what.tokenId) {
      if (!/^[a-f0-9]{16,256}$/.test(what.tokenId)) throw new BridgeError(400, 'shape', 'a revocation id is hex');
      this.store.write({ t: 'revoke-token', id: what.tokenId });
      this.log({ event: 'token.revoked' });
    }
  }

  /** Deletes everything the Bridge holds about a player (docs/en/REALITY-OPS.md, "Deleting a player's data"). */
  forgetPlayer(adminToken: string | undefined, playerId: string): void {
    this.admin(adminToken);
    if (!this.store.player(playerId)) throw new BridgeError(404, 'player', 'unknown player');
    this.store.write({ t: 'forget', playerId });
    this.log({ event: 'player.forgotten' });
  }

  /** What the Bridge holds about a player: the link (without its secret) and the journal. */
  exportPlayer(adminToken: string | undefined, playerId: string) {
    this.admin(adminToken);
    const p = this.store.player(playerId);
    if (!p) throw new BridgeError(404, 'player', 'unknown player');
    const { capabilityHash: _, ...link } = p;
    return { player: link, acked: this.store.acked(playerId), signals: this.store.signals(playerId, 0) };
  }
}
