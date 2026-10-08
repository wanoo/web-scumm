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

export interface RunFilter {
  gameId?: string;
  categoryId?: string;
  leaderboardKey?: string;
}

/** Where runs are kept, per tenant. Every method is atomic against another instance using the same store. */
export interface RunStore {
  /** Creates a run; false when a run of the same tenant has its key already (nothing is written then). */
  create(r: RunRecord): Promise<boolean>;
  get(tenantId: string, id: string): Promise<RunRecord | undefined>;
  list(tenantId: string, f?: RunFilter): Promise<RunRecord[]>;
  /** Runs waiting for a worker (every tenant): the queue's length a submission is refused beyond. */
  queued(): Promise<number>;
  /**
   * Claims the oldest run waiting, or one whose lease expired before `now`, for `workerId` until `now + leaseMs`.
   * Two workers never claim the same run while its lease runs.
   */
  claimNext(workerId: string, leaseMs: number, now: number): Promise<RunRecord | undefined>;
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
  async get(t: string, id: string) {
    const r = this.rows.get(this.k(t, id));
    return r ? structuredClone(r) : undefined;
  }
  async list(t: string, f: RunFilter = {}) {
    return [...this.rows.values()].filter((r) => matches(r, t, f)).map((r) => structuredClone(r));
  }
  async queued() {
    let n = 0;
    for (const r of this.rows.values()) if (r.status === 'queued') n++;
    return n;
  }
  async claimNext(workerId: string, leaseMs: number, now: number) {
    const next = [...this.rows.values()]
      .filter((r) => claimable(r, now))
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
  async queued() {
    const [r] = await this.db.all(`SELECT COUNT(*) AS n FROM runs WHERE status = 'queued'`);
    return Number(r?.n ?? 0);
  }
  claimNext(workerId: string, leaseMs: number, now: number) {
    return this.db.tx('runs:claim', async (q: SqlQuery) => {
      const [next] = await q.all(
        `SELECT tenant_id, id FROM runs WHERE status = 'queued' OR (status = 'verifying' AND lease_until < $1)
           ORDER BY submitted_at, id LIMIT 1`,
        [now],
      );
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
