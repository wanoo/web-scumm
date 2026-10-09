// How many runs a client may submit (4.1.17, plan §7.2): a token bucket per tenant and client, `perMinute` tokens a
// minute. In memory for one process (development, tests), in SQL for several instances: the bucket is one row,
// read and written in one transaction under the tenant's lock, so three instances give a client one quota, not three.
// A client is never stored as it came: its key is HMAC-SHA-256(secret, tenant, client) — the address a host passes
// (the socket's, or the one a trusted proxy names: bridge/src/server.ts) never reaches the database or a log.
//
// Rotation: one key is active; its version is stored beside each bucket, not in the bucket's name. A new secret gives
// every client a new bucket — a controlled reset of the quota (at most one more minute's worth per client) — and the
// buckets of a retired version are purged with the old ones.
import { createHmac } from 'node:crypto';
import type { SqlDb } from './store-sql';

/** The answer to one submission: allowed, or refused with the seconds to wait. */
export type Take = { ok: true } | { ok: false; retryAfterS: number };

export interface SubmissionLimiter {
  /** Takes one token of `client`'s bucket in `tenantId`; a duplicate or an invalid run takes one all the same. */
  take(tenantId: string, client: string, now: number): Promise<Take>;
  /**
   * Deletes `tenantId`'s buckets not touched since `before` (epoch ms) and those of its retired keys; returns how many.
   * Never another tenant's: each tenant has its own key and versions. Without a tenant, only the idle buckets go.
   */
  purge(before: number, tenantId?: string): Promise<number>;
}

export interface LimiterOptions {
  /** Submissions a minute per client (default 10). */
  perMinute?: number;
  /** The secret the client key is made with; the same on every instance of a tenant (a SQL limiter needs it). */
  secret: string;
  /** The secret's version (default `1`): a new secret, a new version (`bridge serve`: the event key's id). */
  keyVersion?: string;
  /** Buckets kept at most (default 100 000): beyond, the least recently used go first. */
  maxBuckets?: number;
}

/** The client's key: never the address itself. */
export const clientKey = (secret: string, tenantId: string, client: string) =>
  createHmac('sha256', secret).update(`${tenantId}\u0000${client}`).digest('base64url');

/** A bucket refilled to `now`, and whether a token was left. */
function refill(b: { tokens: number; at: number } | undefined, per: number, now: number) {
  const tokens = b ? Math.min(per, b.tokens + (Math.max(0, now - b.at) / 60_000) * per) : per;
  if (tokens < 1) return { tokens, ok: false as const, retryAfterS: Math.max(1, Math.ceil(((1 - tokens) / per) * 60)) };
  return { tokens: tokens - 1, ok: true as const, retryAfterS: 0 };
}

/** One process's buckets. */
export class MemoryLimiter implements SubmissionLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(readonly o: LimiterOptions) {}
  async take(tenantId: string, client: string, now: number): Promise<Take> {
    const per = this.o.perMinute ?? 10;
    const k = clientKey(this.o.secret, tenantId, client);
    const r = refill(this.buckets.get(k), per, now);
    this.buckets.delete(k); // re-inserted last: the map's order is the least recently used first
    this.buckets.set(k, { tokens: r.tokens, at: now });
    const max = this.o.maxBuckets ?? 100_000;
    for (const old of this.buckets.keys()) {
      if (this.buckets.size <= max) break;
      this.buckets.delete(old);
    }
    return r.ok ? { ok: true } : { ok: false, retryAfterS: r.retryAfterS };
  }
  // Keys are HMACs of the tenant and the client: this process holds one key, so idle is the only reason to delete.
  async purge(before: number, _tenantId?: string) {
    let n = 0;
    for (const [k, b] of this.buckets)
      if (b.at < before) {
        this.buckets.delete(k);
        n++;
      }
    return n;
  }
  /** How many buckets are kept (tests). */
  get size() {
    return this.buckets.size;
  }
}

/** The buckets of every instance, in the store's database (bridge/migrations/0004). */
export class SqlLimiter implements SubmissionLimiter {
  constructor(
    readonly db: SqlDb,
    readonly o: LimiterOptions,
  ) {}
  take(tenantId: string, client: string, now: number): Promise<Take> {
    const per = this.o.perMinute ?? 10;
    const k = clientKey(this.o.secret, tenantId, client);
    const version = this.o.keyVersion ?? '1';
    // One bucket is one row: the lock is the client's, so two clients of a tenant never wait on each other.
    return this.db.tx(`runs:quota:${tenantId}:${k}`, async (q) => {
      const [row] = await q.all('SELECT tokens, at FROM run_quota WHERE tenant_id = $1 AND client_key = $2', [
        tenantId,
        k,
      ]);
      const r = refill(row ? { tokens: Number(row.tokens), at: Number(row.at) } : undefined, per, now);
      if (row)
        await q.run(
          'UPDATE run_quota SET tokens = $3, at = $4, key_version = $5 WHERE tenant_id = $1 AND client_key = $2',
          [tenantId, k, r.tokens, now, version],
        );
      else
        await q.run(
          'INSERT INTO run_quota (tenant_id, client_key, key_version, tokens, at) VALUES ($1, $2, $3, $4, $5)',
          [tenantId, k, version, r.tokens, now],
        );
      return r.ok ? { ok: true } : { ok: false, retryAfterS: r.retryAfterS };
    });
  }
  async purge(before: number, tenantId?: string) {
    if (tenantId === undefined) return this.db.run('DELETE FROM run_quota WHERE at < $1', [before]);
    const version = this.o.keyVersion ?? '1';
    let n = await this.db.run('DELETE FROM run_quota WHERE tenant_id = $1 AND (at < $2 OR key_version <> $3)', [
      tenantId,
      before,
      version,
    ]);
    // Bounded per tenant: past `maxBuckets`, its least recently used go.
    const max = this.o.maxBuckets ?? 100_000;
    const [c] = await this.db.all('SELECT COUNT(*) AS n FROM run_quota WHERE tenant_id = $1', [tenantId]);
    const over = Number(c?.n ?? 0) - max;
    if (over > 0) {
      const [edge] = await this.db.all(
        `SELECT at FROM run_quota WHERE tenant_id = $1 ORDER BY at LIMIT 1 OFFSET ${over - 1}`,
        [tenantId],
      );
      if (edge)
        n += await this.db.run('DELETE FROM run_quota WHERE tenant_id = $1 AND at <= $2', [tenantId, Number(edge.at)]);
    }
    return n;
  }
}
