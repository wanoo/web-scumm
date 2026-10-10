// `RealityStore` in SQL (4.1.10, ADR 0009): one implementation for SQLite and Postgres over a small `SqlDb` (rows,
// a count of rows changed, a transaction with a lock key). Statements are written once with `$1` placeholders and the
// portable subset both dialects share (`ON CONFLICT`, `excluded`, `CASE`, `COALESCE`). `appendSignal` is the one
// transaction that orders anything: under the player's lock, the dedupe key looked up, `MAX(sequence) + 1` drawn,
// the Bridge called back to check and sign, the row written; the unique keys of bridge/migrations/0001.up.sql back it.
import type { WorldSignal } from '../../src/engine/reality/protocol';
import { migrate, schemaVersion } from './migrations';
import type { Pairing, Player } from './store';
import {
  type AppendResult,
  type ClaimOutcome,
  checkTenant,
  type KeyRow,
  type ProposedSignalRow,
  type QuarantineRow,
  type RealityStore,
  type StoredSignal,
  type TenantExport,
} from './store-async';

export type Row = Record<string, unknown>;

/** What a SQL store needs of its database. */
export interface SqlQuery {
  all(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Runs a statement; returns the number of rows it changed. */
  run(sql: string, params?: unknown[]): Promise<number>;
  exec(sql: string): Promise<void>;
}
export interface SqlDb extends SqlQuery {
  readonly dialect: 'sqlite' | 'postgres';
  /**
   * One transaction; `lockKey` serialises the transactions that name the same key across every process (SQLite: the
   * database's write lock; Postgres: an advisory lock). Retries a transient conflict; `onRetry` counts them.
   */
  tx<T>(lockKey: string | undefined, fn: (q: SqlQuery) => Promise<T>, o?: { readOnly?: boolean }): Promise<T>;
  close(): Promise<void>;
}

const num = (v: unknown) => Number(v ?? 0);
const opt = (v: unknown) => (v === null || v === undefined ? undefined : v);

function toPlayer(r: Row): Player {
  const p: Player = {
    playerId: String(r.player_id),
    gameId: String(r.game_id),
    capabilityHash: String(r.capability_hash),
    capabilityExpiresAt: num(r.capability_expires_at),
  };
  if (opt(r.issued_at) !== undefined) p.issuedAt = num(r.issued_at);
  if (num(r.revoked) === 1) p.revoked = true;
  if (opt(r.session_id) !== undefined) p.sessionId = String(r.session_id);
  if (opt(r.origin) !== undefined) p.origin = String(r.origin);
  return p;
}
function toSignal(r: Row): StoredSignal {
  const s: StoredSignal = {
    tenantId: String(r.tenant_id),
    playerId: String(r.player_id),
    sequence: num(r.sequence),
    id: String(r.id),
    dedupeKey: String(r.dedupe_key),
    jws: String(r.jws),
    at: num(r.at),
  };
  if (opt(r.kid) !== undefined) s.kid = String(r.kid);
  if (opt(r.payload) !== undefined) {
    // A payload that is not JSON stays out: the Bridge quarantines the row when it reads it.
    try {
      s.payload = JSON.parse(String(r.payload)) as WorldSignal;
    } catch {
      s.payload = { unreadable: true } as unknown as WorldSignal;
    }
  }
  return s;
}
function toPairing(r: Row): Pairing {
  const p: Pairing = { code: String(r.code), gameId: String(r.game_id), expiresAt: num(r.expires_at) };
  if (opt(r.player_id) !== undefined) p.playerId = String(r.player_id);
  if (num(r.claimed) === 1) p.claimed = true;
  if (opt(r.origin) !== undefined) p.origin = String(r.origin);
  return p;
}
const toQuarantine = (r: Row): QuarantineRow => ({
  tenantId: String(r.tenant_id),
  playerId: String(r.player_id),
  sequence: num(r.sequence),
  reason: String(r.reason),
  at: num(r.at),
});

const PLAYER_COLUMNS =
  'tenant_id, player_id, game_id, capability_hash, capability_expires_at, issued_at, revoked, session_id, origin';
const SIGNAL_COLUMNS = 'tenant_id, player_id, sequence, id, dedupe_key, jws, at, kid, payload';

async function upsertPlayer(q: SqlQuery, tenantId: string, p: Player): Promise<void> {
  await q.run(
    `INSERT INTO players (${PLAYER_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, player_id) DO UPDATE SET game_id = excluded.game_id,
       capability_hash = excluded.capability_hash, capability_expires_at = excluded.capability_expires_at,
       issued_at = excluded.issued_at, revoked = excluded.revoked, session_id = excluded.session_id,
       origin = excluded.origin`,
    [
      tenantId,
      p.playerId,
      p.gameId,
      p.capabilityHash,
      p.capabilityExpiresAt,
      p.issuedAt ?? null,
      p.revoked ? 1 : 0,
      p.sessionId ?? null,
      p.origin ?? null,
    ],
  );
}
async function insertSignal(q: SqlQuery, s: StoredSignal): Promise<void> {
  await q.run(`INSERT INTO signals (${SIGNAL_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    s.tenantId,
    s.playerId,
    s.sequence,
    s.id,
    s.dedupeKey,
    s.jws,
    s.at,
    s.kid ?? null,
    s.payload ? JSON.stringify(s.payload) : null,
  ]);
}

/** The tables a tenant has rows in, deleted together by `deleteTenant`. */
const TENANT_TABLES = ['signals', 'quarantine', 'pairings', 'revoked_tokens', 'signing_keys', 'players'];

/** One tenant's rows, read through `q` (inside the caller's transaction: an export, a backup's single snapshot). */
export async function exportTenantIn(q: SqlQuery, tenantId: string): Promise<TenantExport> {
  const players = await q.all('SELECT * FROM players WHERE tenant_id = $1 ORDER BY player_id', [tenantId]);
  const signals = await q.all(
    `SELECT ${SIGNAL_COLUMNS} FROM signals WHERE tenant_id = $1 ORDER BY player_id, sequence`,
    [tenantId],
  );
  const tokens = await q.all('SELECT token_id FROM revoked_tokens WHERE tenant_id = $1 ORDER BY token_id', [tenantId]);
  const keys = await q.all('SELECT * FROM signing_keys WHERE tenant_id = $1 ORDER BY key_id', [tenantId]);
  const quarantine = await q.all('SELECT * FROM quarantine WHERE tenant_id = $1 ORDER BY player_id, sequence', [
    tenantId,
  ]);
  const pairings = await q.all('SELECT * FROM pairings WHERE tenant_id = $1 ORDER BY code', [tenantId]);
  return {
    tenantId,
    players: players.map(toPlayer),
    signals: signals.map(toSignal),
    acks: players
      .filter((r) => num(r.acked) > 0)
      .map((r) => ({ playerId: String(r.player_id), through: num(r.acked) })),
    revokedTokens: tokens.map((r) => String(r.token_id)),
    keys: keys.map((r) => ({
      tenantId,
      keyId: String(r.key_id),
      publicKey: String(r.public_key),
      ...(opt(r.retire_after) !== undefined ? { retireAfter: String(r.retire_after) } : {}),
    })),
    quarantine: quarantine.map(toQuarantine),
    pairings: pairings.map(toPairing),
  };
}

/**
 * Writes one tenant's export through `q`: into a tenant that holds nothing yet, or, with `replace`, after deleting
 * what it holds. The caller's transaction makes it all or nothing (one tenant for `importTenant`, every family for a
 * restore).
 */
export async function importTenantIn(q: SqlQuery, x: TenantExport, replace: boolean): Promise<void> {
  const tenantId = checkTenant(x.tenantId);
  if (replace) for (const t of TENANT_TABLES) await q.run(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
  for (const p of x.pairings ?? [])
    await q.run(
      `INSERT INTO pairings (tenant_id, code, game_id, expires_at, player_id, claimed, origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [tenantId, p.code, p.gameId, p.expiresAt, p.playerId ?? null, p.claimed ? 1 : 0, p.origin ?? null],
    );
  for (const p of x.players) await upsertPlayer(q, tenantId, p);
  for (const s of x.signals) await insertSignal(q, { ...s, tenantId });
  for (const a of x.acks)
    await q.run('UPDATE players SET acked = $3 WHERE tenant_id = $1 AND player_id = $2', [
      tenantId,
      a.playerId,
      a.through,
    ]);
  for (const id of x.revokedTokens)
    await q.run('INSERT INTO revoked_tokens (tenant_id, token_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      tenantId,
      id,
    ]);
  for (const k of x.keys)
    await q.run(
      'INSERT INTO signing_keys (tenant_id, key_id, public_key, retire_after) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [tenantId, k.keyId, k.publicKey, k.retireAfter ?? null],
    );
  for (const r of x.quarantine)
    await q.run(
      'INSERT INTO quarantine (tenant_id, player_id, sequence, reason, at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [tenantId, r.playerId, r.sequence, r.reason, r.at],
    );
}

export abstract class SqlRealityStore implements RealityStore {
  abstract readonly kind: 'sqlite' | 'postgres';
  constructor(readonly db: SqlDb) {}

  /** Brings the schema to `to` (the latest by default); the versions applied, negative when undone. */
  migrate(o: { to?: number } = {}): Promise<number[]> {
    return migrate(this.db, o);
  }
  /** The schema's version (0: empty). */
  schemaVersion(): Promise<number> {
    return schemaVersion(this.db);
  }

  async ping(): Promise<void> {
    await this.db.all('SELECT 1 AS one');
  }
  async tenants(): Promise<string[]> {
    const rows = await this.db.all(
      'SELECT tenant_id FROM players UNION SELECT tenant_id FROM signals UNION SELECT tenant_id FROM signing_keys UNION SELECT tenant_id FROM revoked_tokens',
    );
    return rows.map((r) => String(r.tenant_id)).sort();
  }

  async pendingPairings(tenantId: string, now: number) {
    const [r] = await this.db.all('SELECT COUNT(*) AS n FROM pairings WHERE tenant_id = $1 AND expires_at >= $2', [
      checkTenant(tenantId),
      now,
    ]);
    return num(r?.n);
  }
  async sweepPairings(tenantId: string, now: number) {
    await this.db.run('DELETE FROM pairings WHERE tenant_id = $1 AND expires_at < $2', [checkTenant(tenantId), now]);
  }
  async putPairing(tenantId: string, p: Pairing) {
    await this.db.run(
      `INSERT INTO pairings (tenant_id, code, game_id, expires_at, player_id, claimed, origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, code) DO UPDATE SET game_id = excluded.game_id, expires_at = excluded.expires_at,
         player_id = excluded.player_id, claimed = excluded.claimed, origin = excluded.origin`,
      [checkTenant(tenantId), p.code, p.gameId, p.expiresAt, p.playerId ?? null, p.claimed ? 1 : 0, p.origin ?? null],
    );
  }
  async pairing(tenantId: string, code: string) {
    const [r] = await this.db.all('SELECT * FROM pairings WHERE tenant_id = $1 AND code = $2', [
      checkTenant(tenantId),
      code,
    ]);
    return r ? toPairing(r) : undefined;
  }
  async confirmPairing(tenantId: string, code: string, player: Player) {
    checkTenant(tenantId);
    return this.db.tx(`pairing:${tenantId}:${code}`, async (q) => {
      const n = await q.run(
        'UPDATE pairings SET player_id = $3 WHERE tenant_id = $1 AND code = $2 AND player_id IS NULL',
        [tenantId, code, player.playerId],
      );
      if (n !== 1) return false;
      await upsertPlayer(q, tenantId, player);
      return true;
    });
  }
  async claimPairing(tenantId: string, code: string, capabilityHash: string): Promise<ClaimOutcome> {
    checkTenant(tenantId);
    return this.db.tx(`pairing:${tenantId}:${code}`, async (q) => {
      const [r] = await q.all('SELECT * FROM pairings WHERE tenant_id = $1 AND code = $2', [tenantId, code]);
      if (!r) return 'missing';
      const p = toPairing(r);
      if (!p.playerId) return 'pending';
      const n = await q.run('UPDATE pairings SET claimed = 1 WHERE tenant_id = $1 AND code = $2 AND claimed = 0', [
        tenantId,
        code,
      ]);
      if (n !== 1) return 'already';
      const m = await q.run('UPDATE players SET capability_hash = $3 WHERE tenant_id = $1 AND player_id = $2', [
        tenantId,
        p.playerId,
        capabilityHash,
      ]);
      return m === 1 ? 'claimed' : 'missing';
    });
  }

  async player(tenantId: string, playerId: string) {
    const [r] = await this.db.all('SELECT * FROM players WHERE tenant_id = $1 AND player_id = $2', [
      checkTenant(tenantId),
      playerId,
    ]);
    return r ? toPlayer(r) : undefined;
  }
  async playerByCapability(tenantId: string, hash: string) {
    const [r] = await this.db.all('SELECT * FROM players WHERE tenant_id = $1 AND capability_hash = $2', [
      checkTenant(tenantId),
      hash,
    ]);
    return r ? toPlayer(r) : undefined;
  }
  async putPlayer(tenantId: string, p: Player) {
    await upsertPlayer(this.db, checkTenant(tenantId), p);
  }
  async forgetPlayer(tenantId: string, playerId: string) {
    checkTenant(tenantId);
    await this.db.tx(`player:${tenantId}:${playerId}`, async (q) => {
      for (const t of ['signals', 'quarantine', 'pairings', 'players'])
        await q.run(`DELETE FROM ${t} WHERE tenant_id = $1 AND player_id = $2`, [tenantId, playerId]);
    });
  }

  /** Said to the other instances once the row is committed (Postgres NOTIFY); nothing on SQLite (its watch polls). */
  protected abstract announce(q: SqlQuery, tenantId: string, playerId: string): Promise<void>;

  async appendSignal(input: ProposedSignalRow): Promise<AppendResult> {
    const { tenantId, playerId, dedupeKey } = input;
    checkTenant(tenantId);
    return this.db.tx(`player:${tenantId}:${playerId}`, async (q) => {
      const [seen] = await q.all(
        `SELECT ${SIGNAL_COLUMNS} FROM signals WHERE tenant_id = $1 AND player_id = $2 AND dedupe_key = $3`,
        [tenantId, playerId, dedupeKey],
      );
      if (seen) return { signal: toSignal(seen), duplicate: true };
      const [last] = await q.all(
        'SELECT COALESCE(MAX(sequence), 0) AS last FROM signals WHERE tenant_id = $1 AND player_id = $2',
        [tenantId, playerId],
      );
      const [ack] = await q.all('SELECT acked FROM players WHERE tenant_id = $1 AND player_id = $2', [
        tenantId,
        playerId,
      ]);
      const sequence = num(last?.last) + 1;
      const d = input.sign({ sequence, acked: num(ack?.acked) });
      const row: StoredSignal = {
        tenantId,
        playerId,
        sequence,
        id: d.id,
        dedupeKey,
        jws: d.jws,
        at: d.at,
        kid: d.kid,
        payload: d.payload,
      };
      await insertSignal(q, row);
      await this.announce(q, tenantId, playerId);
      return { signal: row, duplicate: false };
    });
  }
  async listAfter(c: { tenantId: string; playerId: string; after: number; limit: number }) {
    const rows = await this.db.all(
      `SELECT ${SIGNAL_COLUMNS} FROM signals WHERE tenant_id = $1 AND player_id = $2 AND sequence > $3
       ORDER BY sequence LIMIT $4`,
      [checkTenant(c.tenantId), c.playerId, c.after, c.limit],
    );
    return rows.map(toSignal);
  }
  async lastSequence(tenantId: string, playerId: string) {
    const [r] = await this.db.all(
      'SELECT COALESCE(MAX(sequence), 0) AS last FROM signals WHERE tenant_id = $1 AND player_id = $2',
      [checkTenant(tenantId), playerId],
    );
    return num(r?.last);
  }
  async acked(tenantId: string, playerId: string) {
    const [r] = await this.db.all('SELECT acked FROM players WHERE tenant_id = $1 AND player_id = $2', [
      checkTenant(tenantId),
      playerId,
    ]);
    return num(r?.acked);
  }
  async acknowledge(i: { tenantId: string; playerId: string; sequence: number }) {
    await this.db.run(
      'UPDATE players SET acked = CASE WHEN acked < $3 THEN $3 ELSE acked END WHERE tenant_id = $1 AND player_id = $2',
      [checkTenant(i.tenantId), i.playerId, i.sequence],
    );
  }

  async revokeToken(tenantId: string, id: string) {
    await this.db.run('INSERT INTO revoked_tokens (tenant_id, token_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      checkTenant(tenantId),
      id,
    ]);
  }
  async tokenRevoked(tenantId: string, id: string) {
    const [r] = await this.db.all('SELECT 1 AS one FROM revoked_tokens WHERE tenant_id = $1 AND token_id = $2', [
      checkTenant(tenantId),
      id,
    ]);
    return r !== undefined;
  }
  async revokedTokens(tenantId: string) {
    const rows = await this.db.all('SELECT token_id FROM revoked_tokens WHERE tenant_id = $1', [checkTenant(tenantId)]);
    return new Set(rows.map((r) => String(r.token_id)));
  }

  async rotateKeys(i: { tenantId: string; keyId: string; publicKey: string; retireAfter?: string }) {
    await this.db.run(
      `INSERT INTO signing_keys (tenant_id, key_id, public_key, retire_after) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, key_id) DO UPDATE SET public_key = excluded.public_key,
         retire_after = excluded.retire_after`,
      [checkTenant(i.tenantId), i.keyId, i.publicKey, i.retireAfter ?? null],
    );
  }
  async keys(tenantId: string): Promise<KeyRow[]> {
    const rows = await this.db.all('SELECT * FROM signing_keys WHERE tenant_id = $1 ORDER BY key_id', [
      checkTenant(tenantId),
    ]);
    return rows.map((r) => ({
      tenantId: String(r.tenant_id),
      keyId: String(r.key_id),
      publicKey: String(r.public_key),
      ...(opt(r.retire_after) !== undefined ? { retireAfter: String(r.retire_after) } : {}),
    }));
  }

  async quarantine(row: QuarantineRow) {
    await this.db.run(
      `INSERT INTO quarantine (tenant_id, player_id, sequence, reason, at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [checkTenant(row.tenantId), row.playerId, row.sequence, row.reason, row.at],
    );
  }
  async quarantined(tenantId?: string) {
    const rows =
      tenantId === undefined
        ? await this.db.all('SELECT * FROM quarantine ORDER BY tenant_id, player_id, sequence')
        : await this.db.all('SELECT * FROM quarantine WHERE tenant_id = $1 ORDER BY player_id, sequence', [
            checkTenant(tenantId),
          ]);
    return rows.map(toQuarantine);
  }

  async exportTenant(tenantId: string): Promise<TenantExport> {
    checkTenant(tenantId);
    // One read-only snapshot: the export is one instant of the tenant, not rows read across concurrent writes.
    return this.db.tx(undefined, (q) => exportTenantIn(q, tenantId), { readOnly: true });
  }
  async importTenant(x: TenantExport, o: { replace?: boolean } = {}) {
    const tenantId = checkTenant(x.tenantId);
    await this.db.tx(`tenant:${tenantId}`, (q) => importTenantIn(q, x, o.replace ?? false));
  }
  async deleteTenant(tenantId: string) {
    checkTenant(tenantId);
    await this.db.tx(`tenant:${tenantId}`, async (q) => {
      for (const t of TENANT_TABLES) await q.run(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
    });
  }

  abstract watch(tenantId: string, wake: (playerId: string) => void): () => void;
  async close() {
    await this.db.close();
  }
}
