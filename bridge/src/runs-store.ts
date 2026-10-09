// Where the speedrun leaderboards keep their runs (4.1.16, ADR 0019): one interface, a memory store for tests and a
// single process, and a SQL store over the Reality store's own database (SQLite for `local`, Postgres for several
// instances; bridge/migrations/0002). Every write that two instances could race on is one statement or one locked
// transaction: a run is created only if its key is new (a unique key, never a read then a write), a queued run is
// claimed by one worker under a lease, a verdict is stored only by the worker that holds the lease, and a lease that
// expired (a worker that died) is claimed again by the next one.
import type { SqlDb, SqlQuery } from './store-sql';

/** How far a run is believed (ADR 0017). */
export type RunTrust = 'local' | 'replay-valid' | 'server-witnessed' | 'moderator-verified';

/** A submitted run as the Bridge keeps it. */
export interface RunRecord {
  id: string;
  tenantId: string;
  gameId: string;
  categoryId: string;
  /** A pseudonym the player chose (never an email). */
  player: string;
  submittedAt: number;
  status: 'queued' | 'verifying' | 'done';
  verdict?: string;
  code?: string;
  reason?: string;
  trust: RunTrust;
  /** The time the category ranks on, in microticks (decimal), when the worker recomputed it. */
  ranked?: string | null;
  /** 4.1.14's split of a leaderboard by seed kind: kept for the `?seed=` filter of schema 1 runs. */
  seedKind?: 'fixed' | 'random';
  /** The world the verifier checked (4.1.16): its hash, mode and seed, and the leaderboard it put the run on. */
  worldHash?: string;
  worldMode?: string;
  worldSeed?: string;
  leaderboardKey?: string;
  /**
   * The run's identity: SHA-256 of its game, category, seed, world and inputs (their RTA stamps aside). The same run
   * re-spaced or re-stamped is the same key: the first submitter keeps it, a second is refused.
   */
  runKey: string;
  /** SHA-256 of the deletion token (the token itself is given once, at submission). */
  deleteTokenHash: string;
  /** The `.wsrun` text until the worker's verdict is stored, then empty (the summary above stays). */
  envelope: string;
  /** The worker holding the run while it is `verifying`, and until when (epoch ms). */
  leaseOwner?: string;
  leaseUntil?: number;
}

/** What a worker found: the verdict and what the run is ranked on. */
export type RunOutcome = Pick<
  RunRecord,
  | 'verdict'
  | 'code'
  | 'reason'
  | 'trust'
  | 'ranked'
  | 'seedKind'
  | 'worldHash'
  | 'worldMode'
  | 'worldSeed'
  | 'leaderboardKey'
>;

/**
 * What a leaderboard asks of the store (4.1.17, plan §6.1): the valid runs of one tenant, game, category and board key
 * (a run of 4.1.14 without a key is on its category's board), optionally one seed kind; each pseudonym's best; ordered
 * by time, then submission, then id; equal times share a rank; then at most `limit` rows. The limit is the answer's,
 * never the candidates': a faster run submitted late is never cut before the ranking.
 */
export interface LeaderboardQuery {
  tenantId: string;
  gameId: string;
  categoryId: string;
  leaderboardKey: string;
  seedKind?: 'fixed' | 'random';
  limit: number;
}

/** One line of a leaderboard: the run (without its envelope) and its rank. */
interface LeaderboardRow {
  run: RunRecord;
  rank: number;
}

/** The most digits a ranked time may have (microticks: about 3 × 10^16 years). */
const RANKED_DIGITS = 30;

/**
 * A ranked time as the stores keep it (4.1.17): decimal digits only, no sign, no leading zero (`"00042"` → `"42"`,
 * `"0"` kept), at most RANKED_DIGITS; null for anything else. Canonical, its order is its length then its text.
 */
export function canonicalTime(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  const t = BigInt(v).toString();
  return t.length <= RANKED_DIGITS ? t : null;
}

/** Time, then submission, then id: the order of a board. */
const byTime = (a: RunRecord, b: RunRecord) =>
  a.ranked!.length - b.ranked!.length ||
  (a.ranked! < b.ranked! ? -1 : a.ranked! > b.ranked! ? 1 : 0) ||
  a.submittedAt - b.submittedAt ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Each pseudonym's best, ordered, ranked (equal times share the rank of the first), then limited. */
function rankBoard(candidates: RunRecord[], limit: number): LeaderboardRow[] {
  const best = new Map<string, RunRecord>();
  for (const r of candidates) {
    const b = best.get(r.player);
    if (!b || byTime(r, b) < 0) best.set(r.player, r);
  }
  const sorted = [...best.values()].sort(byTime);
  let rank = 0;
  return sorted
    .map((run, i) => {
      if (i === 0 || sorted[i - 1]!.ranked !== run.ranked) rank = i + 1;
      return { run, rank };
    })
    .slice(0, Math.max(0, limit));
}

export interface RunFilter {
  gameId?: string;
  categoryId?: string;
  leaderboardKey?: string;
}

/** What a submission became (4.1.17): written, the same run already there, or no room left. */
export type Admission = 'created' | 'duplicate' | 'full';

/** Where runs are kept, per tenant. Every method is atomic against another instance using the same store. */
export interface RunStore {
  /** Creates a run; false when a run of the same tenant has its key already (nothing is written then). */
  create(r: RunRecord): Promise<boolean>;
  /**
   * Admits a submission (4.1.17, plan §7.1): `duplicate` when the tenant has a run of that key, `full` when it has
   * `maxQueued` runs waiting or being verified, else the run is written. One step for every instance together: two
   * instances that both see 99 of 100 never write 101.
   */
  admit(r: RunRecord, maxQueued: number): Promise<Admission>;
  get(tenantId: string, id: string): Promise<RunRecord | undefined>;
  list(tenantId: string, f?: RunFilter): Promise<RunRecord[]>;
  /** Runs waiting for a worker (a tenant's, or every tenant's): the queue's length a submission is refused beyond. */
  queued(tenantId?: string): Promise<number>;
  /** A leaderboard, ranked by the store, without the envelopes (LeaderboardQuery says in which order). */
  board(q: LeaderboardQuery): Promise<LeaderboardRow[]>;
  /** One run without its envelope (what anyone may read of it). */
  summary(tenantId: string, id: string): Promise<RunRecord | undefined>;
  /**
   * Claims the oldest run waiting, or one whose lease expired before `now`, for `workerId` until `now + leaseMs`.
   * Two workers never claim the same run while its lease runs.
   */
  claimNext(workerId: string, leaseMs: number, now: number, tenantId?: string): Promise<RunRecord | undefined>;
  /** Stores a verdict; false when `workerId` no longer holds the run's lease (another worker took it over). */
  complete(tenantId: string, id: string, workerId: string, out: RunOutcome): Promise<boolean>;
  setTrust(tenantId: string, id: string, trust: RunTrust): Promise<void>;
  delete(tenantId: string, id: string): Promise<void>;
  /** Deletes the runs submitted before `before` (epoch ms); returns how many. */
  purge(before: number): Promise<number>;
}

const matches = (r: RunRecord, t: string, f: RunFilter) =>
  r.tenantId === t &&
  (!f.gameId || r.gameId === f.gameId) &&
  (!f.categoryId || r.categoryId === f.categoryId) &&
  (!f.leaderboardKey || r.leaderboardKey === f.leaderboardKey);
const claimable = (r: RunRecord, now: number) =>
  r.status === 'queued' || (r.status === 'verifying' && (r.leaseUntil ?? 0) < now);

/** The runs of one process (tests; a single instance that may lose its runs on restart). */
export class MemoryRunStore implements RunStore {
  private rows = new Map<string, RunRecord>();
  private k = (t: string, id: string) => `${t}\u0000${id}`;
  async create(r: RunRecord) {
    for (const x of this.rows.values()) if (x.tenantId === r.tenantId && x.runKey === r.runKey) return false;
    this.rows.set(this.k(r.tenantId, r.id), structuredClone(r));
    return true;
  }
  // No await between the reads and the write: one turn of the event loop, atomic in this process.
  async admit(r: RunRecord, maxQueued: number): Promise<Admission> {
    let waiting = 0;
    for (const x of this.rows.values()) {
      if (x.tenantId !== r.tenantId) continue;
      if (x.runKey === r.runKey) return 'duplicate';
      if (x.status === 'queued' || x.status === 'verifying') waiting++;
    }
    if (waiting >= maxQueued) return 'full';
    this.rows.set(this.k(r.tenantId, r.id), structuredClone(r));
    return 'created';
  }
  async get(t: string, id: string) {
    const r = this.rows.get(this.k(t, id));
    return r ? structuredClone(r) : undefined;
  }
  async list(t: string, f: RunFilter = {}) {
    return [...this.rows.values()].filter((r) => matches(r, t, f)).map((r) => structuredClone(r));
  }
  async queued(t?: string) {
    let n = 0;
    for (const r of this.rows.values()) if (r.status === 'queued' && (!t || r.tenantId === t)) n++;
    return n;
  }
  async board(q: LeaderboardQuery) {
    const candidates = [...this.rows.values()]
      .filter(
        (r) =>
          r.tenantId === q.tenantId &&
          r.gameId === q.gameId &&
          r.categoryId === q.categoryId &&
          r.status === 'done' &&
          r.verdict === 'valid' &&
          !!r.ranked &&
          (r.leaderboardKey ?? r.categoryId) === q.leaderboardKey &&
          (!q.seedKind || r.seedKind === q.seedKind),
      )
      .map((r) => ({ ...structuredClone(r), envelope: '' }));
    return rankBoard(candidates, q.limit);
  }
  async summary(t: string, id: string) {
    const r = this.rows.get(this.k(t, id));
    return r ? { ...structuredClone(r), envelope: '' } : undefined;
  }
  async claimNext(workerId: string, leaseMs: number, now: number, tenantId?: string) {
    const next = [...this.rows.values()]
      .filter((r) => claimable(r, now) && (!tenantId || r.tenantId === tenantId))
      .sort((a, b) => a.submittedAt - b.submittedAt || (a.id < b.id ? -1 : 1))[0];
    if (!next) return undefined;
    Object.assign(next, { status: 'verifying', leaseOwner: workerId, leaseUntil: now + leaseMs });
    return structuredClone(next);
  }
  async complete(t: string, id: string, workerId: string, out: RunOutcome) {
    const r = this.rows.get(this.k(t, id));
    if (!r || r.status !== 'verifying' || r.leaseOwner !== workerId) return false;
    Object.assign(r, out, { status: 'done', envelope: '', leaseOwner: undefined, leaseUntil: undefined });
    return true;
  }
  async setTrust(t: string, id: string, trust: RunTrust) {
    const r = this.rows.get(this.k(t, id));
    if (r) r.trust = trust;
  }
  async delete(t: string, id: string) {
    this.rows.delete(this.k(t, id));
  }
  async purge(before: number) {
    let n = 0;
    for (const [k, r] of this.rows)
      if (r.submittedAt < before) {
        this.rows.delete(k);
        n++;
      }
    return n;
  }
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));
const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));

function toRun(r: Row): RunRecord {
  const run: RunRecord = {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    gameId: String(r.game_id),
    categoryId: String(r.category_id),
    player: String(r.player),
    submittedAt: Number(r.submitted_at),
    status: String(r.status) as RunRecord['status'],
    trust: String(r.trust) as RunTrust,
    runKey: String(r.run_key),
    deleteTokenHash: String(r.delete_token_hash),
    envelope: String(r.envelope ?? ''),
  };
  const opt: [keyof RunRecord, unknown][] = [
    ['verdict', str(r.verdict)],
    ['code', str(r.code)],
    ['reason', str(r.reason)],
    ['seedKind', str(r.seed_kind)],
    ['worldHash', str(r.world_hash)],
    ['worldMode', str(r.world_mode)],
    ['worldSeed', str(r.world_seed)],
    ['leaderboardKey', str(r.leaderboard_key)],
    ['leaseOwner', str(r.lease_owner)],
    ['leaseUntil', num(r.lease_until)],
  ];
  for (const [k, v] of opt) if (v !== undefined) (run as unknown as Record<string, unknown>)[k] = v;
  // `ranked` is null once a verdict is stored without a time, absent before.
  if (run.status === 'done') run.ranked = str(r.ranked) ?? null;
  return run;
}

const COLUMNS =
  'tenant_id, id, game_id, category_id, player, submitted_at, status, verdict, code, reason, trust, ranked, seed_kind, world_hash, world_mode, world_seed, leaderboard_key, run_key, delete_token_hash, envelope, lease_owner, lease_until';

/** Every column but the envelope. */
const SUMMARY = COLUMNS.replace(', envelope', '');

/**
 * The runs in SQL, over the Reality store's database (`SqliteRealityStore.db`, `PostgresRealityStore.db`): the same
 * file or server, the same migrations. A claim is one transaction under the lock `runs:claim`, so instances claim in
 * turn; everything else is one statement.
 */
export class SqlRunStore implements RunStore {
  constructor(readonly db: SqlDb) {}

  async create(r: RunRecord) {
    const n = await this.db.run(
      `INSERT INTO runs (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) ON CONFLICT DO NOTHING`,
      [
        r.tenantId,
        r.id,
        r.gameId,
        r.categoryId,
        r.player,
        r.submittedAt,
        r.status,
        r.verdict ?? null,
        r.code ?? null,
        r.reason ?? null,
        r.trust,
        r.ranked ?? null,
        r.seedKind ?? null,
        r.worldHash ?? null,
        r.worldMode ?? null,
        r.worldSeed ?? null,
        r.leaderboardKey ?? null,
        r.runKey,
        r.deleteTokenHash,
        r.envelope,
        r.leaseOwner ?? null,
        r.leaseUntil ?? null,
      ],
    );
    return n === 1;
  }
  admit(r: RunRecord, maxQueued: number): Promise<Admission> {
    // Under the tenant's lock (SQLite: the write lock; Postgres: an advisory lock), so the count and the insert are
    // one step for every instance; the unique key still refuses a duplicate written by any other path.
    return this.db.tx(`runs:admit:${r.tenantId}`, async (q) => {
      const [dup] = await q.all('SELECT 1 AS x FROM runs WHERE tenant_id = $1 AND run_key = $2', [
        r.tenantId,
        r.runKey,
      ]);
      if (dup) return 'duplicate';
      const [c] = await q.all(
        `SELECT COUNT(*) AS n FROM runs WHERE tenant_id = $1 AND status IN ('queued', 'verifying')`,
        [r.tenantId],
      );
      if (Number(c?.n ?? 0) >= maxQueued) return 'full';
      return (await new SqlRunStore(q as SqlDb).create(r)) ? 'created' : 'duplicate';
    });
  }
  async get(t: string, id: string) {
    const [r] = await this.db.all('SELECT * FROM runs WHERE tenant_id = $1 AND id = $2', [t, id]);
    return r ? toRun(r) : undefined;
  }
  async list(t: string, f: RunFilter = {}) {
    // Only the filters given, each a typed comparison (Postgres cannot type a parameter compared to '' alone).
    const where = ['tenant_id = $1'];
    const params: unknown[] = [t];
    for (const [col, v] of [
      ['game_id', f.gameId],
      ['category_id', f.categoryId],
      ['leaderboard_key', f.leaderboardKey],
    ] as const)
      if (v) {
        params.push(v);
        where.push(`${col} = $${params.length}`);
      }
    const rows = await this.db.all(`SELECT * FROM runs WHERE ${where.join(' AND ')} ORDER BY submitted_at, id`, params);
    return rows.map(toRun);
  }
  async queued(t?: string) {
    const [r] = t
      ? await this.db.all(`SELECT COUNT(*) AS n FROM runs WHERE status = 'queued' AND tenant_id = $1`, [t])
      : await this.db.all(`SELECT COUNT(*) AS n FROM runs WHERE status = 'queued'`);
    return Number(r?.n ?? 0);
  }
  /**
   * The statement a board is (4.1.17): each pseudonym's best, then the rank, then the limit, so a faster run submitted
   * after ten thousand others is still on the board; the envelopes (up to 2 MB each) are never read. A canonical
   * time orders by its length then its text, compared byte by byte (`COLLATE "C"` on Postgres, SQLite's BINARY).
   * Public for `tools/runs-load.ts`, which prints its plan.
   */
  boardSql(q: LeaderboardQuery): { sql: string; params: unknown[] } {
    const c = this.db.dialect === 'postgres' ? ' COLLATE "C"' : '';
    const order = `LENGTH(ranked), ranked${c}`;
    const params: unknown[] = [q.tenantId, q.gameId, q.categoryId, q.leaderboardKey];
    if (q.seedKind) params.push(q.seedKind);
    const sql = `WITH candidates AS (
         SELECT ${SUMMARY}, ROW_NUMBER() OVER (PARTITION BY player ORDER BY ${order}, submitted_at, id${c}) AS pick
           FROM runs
          WHERE tenant_id = $1 AND game_id = $2 AND category_id = $3 AND status = 'done' AND verdict = 'valid'
            AND ranked IS NOT NULL AND ranked <> '' AND COALESCE(leaderboard_key, category_id) = $4${q.seedKind ? ' AND seed_kind = $5' : ''}
       )
       SELECT *, RANK() OVER (ORDER BY ${order}) AS board_rank FROM candidates WHERE pick = 1
        ORDER BY ${order}, submitted_at, id${c} LIMIT ${Math.max(0, Math.floor(q.limit))}`;
    return { sql, params };
  }
  async board(q: LeaderboardQuery) {
    const { sql, params } = this.boardSql(q);
    const rows = await this.db.all(sql, params);
    return rows.map((r) => ({ run: toRun(r), rank: Number(r.board_rank) }));
  }
  async summary(t: string, id: string) {
    const [r] = await this.db.all(`SELECT ${SUMMARY} FROM runs WHERE tenant_id = $1 AND id = $2`, [t, id]);
    return r ? toRun(r) : undefined;
  }
  claimNext(workerId: string, leaseMs: number, now: number, tenantId?: string) {
    return this.db.tx('runs:claim', async (q: SqlQuery) => {
      const waiting = `(status = 'queued' OR (status = 'verifying' AND lease_until < $1))`;
      const [next] = tenantId
        ? await q.all(
            `SELECT tenant_id, id FROM runs WHERE ${waiting} AND tenant_id = $2 ORDER BY submitted_at, id LIMIT 1`,
            [now, tenantId],
          )
        : await q.all(`SELECT tenant_id, id FROM runs WHERE ${waiting} ORDER BY submitted_at, id LIMIT 1`, [now]);
      if (!next) return undefined;
      const n = await q.run(
        `UPDATE runs SET status = 'verifying', lease_owner = $3, lease_until = $4
           WHERE tenant_id = $1 AND id = $2 AND (status = 'queued' OR (status = 'verifying' AND lease_until < $5))`,
        [next.tenant_id, next.id, workerId, now + leaseMs, now],
      );
      if (n !== 1) return undefined;
      const [r] = await q.all('SELECT * FROM runs WHERE tenant_id = $1 AND id = $2', [next.tenant_id, next.id]);
      return r ? toRun(r) : undefined;
    });
  }
  async complete(t: string, id: string, workerId: string, out: RunOutcome) {
    const n = await this.db.run(
      `UPDATE runs SET status = 'done', verdict = $4, code = $5, reason = $6, trust = $7, ranked = $8, seed_kind = $9,
         world_hash = $10, world_mode = $11, world_seed = $12, leaderboard_key = $13, envelope = '',
         lease_owner = NULL, lease_until = NULL
         WHERE tenant_id = $1 AND id = $2 AND status = 'verifying' AND lease_owner = $3`,
      [
        t,
        id,
        workerId,
        out.verdict ?? null,
        out.code ?? null,
        out.reason ?? null,
        out.trust,
        out.ranked ?? null,
        out.seedKind ?? null,
        out.worldHash ?? null,
        out.worldMode ?? null,
        out.worldSeed ?? null,
        out.leaderboardKey ?? null,
      ],
    );
    return n === 1;
  }
  async setTrust(t: string, id: string, trust: RunTrust) {
    await this.db.run('UPDATE runs SET trust = $3 WHERE tenant_id = $1 AND id = $2', [t, id, trust]);
  }
  async delete(t: string, id: string) {
    await this.db.run('DELETE FROM runs WHERE tenant_id = $1 AND id = $2', [t, id]);
  }
  purge(before: number) {
    return this.db.run('DELETE FROM runs WHERE submitted_at < $1', [before]);
  }
}
