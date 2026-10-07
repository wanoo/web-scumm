// The `distributed` profile's store (4.1.10, D20; experimental until a real deployment): Postgres through `pg`
// (MIT), loaded only when this store is opened, so a Bridge on SQLite or on its journal never needs it. The schema is
// SQLite's (bridge/migrations/). `appendSignal` holds a transaction-scoped advisory lock on its player, and announces
// the row with `pg_notify` (sent at commit): every instance `LISTEN`s and wakes the streams of that player. The
// database stays the source of truth: a lost notification delays a stream until its next read, never drops a signal.
import { checkTenant } from './store-async';
import { type Row, type SqlDb, type SqlQuery, SqlRealityStore } from './store-sql';

/** The part of `pg` this store uses (typed here: `pg` is optional and not imported for its types). */
interface PgClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  release(err?: Error): void;
  on(ev: 'notification', fn: (m: { channel: string; payload?: string }) => void): void;
  on(ev: 'error', fn: (e: Error) => void): void;
}
interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
  on(ev: 'error', fn: (e: Error) => void): void;
}
/** The `pg` module (`import pg from 'pg'`), or a test's stand-in. */
export interface PgModule {
  Pool: new (o: { connectionString: string; max?: number }) => PgPool;
}

const CHANNEL = 'web_scumm_signals';
/** Transient conflicts a transaction is tried again for: serialization, deadlock, a unique key raced. */
const RETRY = new Set(['40001', '40P01', '23505']);

class PgDb implements SqlDb {
  readonly dialect = 'postgres' as const;
  retries = 0;
  constructor(readonly pool: PgPool) {}
  async all(sql: string, params?: unknown[]) {
    return (await this.pool.query(sql, params)).rows;
  }
  async run(sql: string, params?: unknown[]) {
    return (await this.pool.query(sql, params)).rowCount ?? 0;
  }
  async exec(sql: string) {
    await this.pool.query(sql);
  }
  async tx<T>(lockKey: string | undefined, fn: (q: SqlQuery) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const c = await this.pool.connect();
      const q: SqlQuery = {
        all: async (sql, params) => (await c.query(sql, params)).rows,
        run: async (sql, params) => (await c.query(sql, params)).rowCount ?? 0,
        exec: async (sql) => void (await c.query(sql)),
      };
      try {
        await c.query('BEGIN');
        if (lockKey !== undefined) await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
        const r = await fn(q);
        await c.query('COMMIT');
        c.release();
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
        const code = (e as { code?: string }).code;
        if (!code || !RETRY.has(code) || attempt >= 5) throw e;
        this.retries++;
        await new Promise((ok) => setTimeout(ok, 5 + Math.random() * 20));
      }
    }
  }
  async close() {
    await this.pool.end();
  }
}

export class PostgresRealityStore extends SqlRealityStore {
  readonly kind = 'postgres' as const;
  private listener: PgClient | undefined;
  private watchers = new Map<string, Set<(playerId: string) => void>>();

  private constructor(private pg: PgDb) {
    super(pg);
  }

  /**
   * Connects to `url` (`postgres://…`), brings the schema to the latest version unless `migrate: false`, and listens
   * for the other instances' acceptances. `pg` is the module to use (by default `import('pg')`).
   */
  static async open(
    url: string,
    o: { migrate?: boolean; pg?: PgModule; max?: number } = {},
  ): Promise<PostgresRealityStore> {
    const name = 'pg';
    const mod =
      o.pg ??
      ((
        (await import(/* @vite-ignore */ name).catch(() => {
          throw new Error('the distributed profile needs the `pg` package: npm install pg');
        })) as { default?: PgModule } & PgModule
      ).default as PgModule);
    const pool = new mod.Pool({ connectionString: url, max: o.max ?? 10 });
    pool.on('error', () => {
      /* an idle client lost: the pool opens another on the next query */
    });
    const store = new PostgresRealityStore(new PgDb(pool));
    if (o.migrate !== false) await store.migrate();
    return store;
  }

  /** Transactions tried again after a transient conflict. */
  get retries(): number {
    return this.pg.retries;
  }

  protected async announce(q: SqlQuery, tenantId: string, playerId: string): Promise<void> {
    await q.all('SELECT pg_notify($1, $2)', [CHANNEL, `${tenantId} ${playerId}`]);
  }

  private async listen(): Promise<void> {
    if (this.listener) return;
    const c = await this.pg.pool.connect();
    this.listener = c;
    c.on('notification', (m) => {
      const [tenant, player] = (m.payload ?? '').split(' ');
      if (!tenant || !player) return;
      for (const w of this.watchers.get(tenant) ?? []) w(player);
    });
    c.on('error', () => {
      // The listening connection dropped: listen again on the next watch; the Bridge's slow pass covers the gap.
      this.listener = undefined;
    });
    await c.query(`LISTEN ${CHANNEL}`);
  }

  watch(tenantId: string, wake: (playerId: string) => void): () => void {
    checkTenant(tenantId);
    let set = this.watchers.get(tenantId);
    if (!set) this.watchers.set(tenantId, (set = new Set()));
    set.add(wake);
    void this.listen().catch(() => {
      this.listener = undefined;
    });
    return () => set.delete(wake);
  }

  /** Resolves once this store listens (the tests wait for it before counting on a wake-up). */
  listening(): Promise<void> {
    return this.listen();
  }

  override async close() {
    this.watchers.clear();
    if (this.listener) {
      await this.listener.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
      this.listener.release();
      this.listener = undefined;
    }
    await super.close();
  }
}
