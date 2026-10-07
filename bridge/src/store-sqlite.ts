// The `local` profile's store (4.1.10, D20): SQLite through `node:sqlite` (Node 22.13+; no native dependency), one
// file, WAL, `synchronous = FULL` (a write reported done survives a power cut), several processes allowed: a
// transaction is `BEGIN IMMEDIATE` (the file's write lock, waited for up to `busyMs`), so two instances drawing a
// sequence for one player never draw the same. The other instances' acceptances are seen by a short poll of the
// journal's `rowid` (the wake-up; the Bridge reads the rows itself).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { checkTenant } from './store-async';
import { type Row, type SqlDb, type SqlQuery, SqlRealityStore } from './store-sql';

/** `$1` placeholders as SQLite's `?`, the parameters in the order they appear (a `$n` may appear twice). */
function positional(sql: string, params: unknown[] = []): [string, unknown[]] {
  const out: unknown[] = [];
  const text = sql.replace(/\$(\d+)/g, (_m, n: string) => {
    out.push(params[Number(n) - 1]);
    return '?';
  });
  return [text, out];
}
const value = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);

const BUSY = /SQLITE_BUSY|database is locked/i;

/**
 * One chain of statements per file in this process: two connections to one file in one process would otherwise
 * deadlock, the second's `BEGIN IMMEDIATE` blocking the event loop the first needs to finish its transaction.
 * Across processes the file's lock does the same work.
 */
const CHAINS = new Map<string, { tail: Promise<unknown> }>();

class SqliteDb implements SqlDb {
  readonly dialect = 'sqlite' as const;
  private statements = new Map<string, StatementSync>();
  /** One transaction or statement at a time on this file in this process (its awaits would interleave otherwise). */
  private chain: { tail: Promise<unknown> };
  retries = 0;

  constructor(
    readonly db: DatabaseSync,
    private busyMs: number,
    file: string,
  ) {
    let c = file === ':memory:' ? undefined : CHAINS.get(file);
    if (!c) {
      c = { tail: Promise.resolve() };
      if (file !== ':memory:') CHAINS.set(file, c);
    }
    this.chain = c;
  }

  private prepared(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }
  private direct: SqlQuery = {
    all: async (sql, params) => {
      const [text, args] = positional(sql, params);
      return this.prepared(text).all(...(args.map(value) as never[])) as Row[];
    },
    run: async (sql, params) => {
      const [text, args] = positional(sql, params);
      return Number(this.prepared(text).run(...(args.map(value) as never[])).changes);
    },
    exec: async (sql) => {
      this.db.exec(sql);
    },
  };
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.tail.then(fn, fn);
    this.chain.tail = run.catch(() => {});
    return run;
  }
  all(sql: string, params?: unknown[]) {
    return this.serial(() => this.direct.all(sql, params));
  }
  run(sql: string, params?: unknown[]) {
    return this.serial(() => this.direct.run(sql, params));
  }
  exec(sql: string) {
    return this.serial(() => this.direct.exec(sql));
  }
  tx<T>(_lockKey: string | undefined, fn: (q: SqlQuery) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      // The write lock is taken at BEGIN: a busy file is waited for (busy_timeout), then tried again a few times.
      for (let attempt = 0; ; attempt++) {
        try {
          this.db.exec('BEGIN IMMEDIATE');
          break;
        } catch (e) {
          if (!BUSY.test(String(e)) || attempt >= 5) throw e;
          this.retries++;
          await new Promise((ok) => setTimeout(ok, 10 + Math.random() * 40));
        }
      }
      try {
        const r = await fn(this.direct);
        this.db.exec('COMMIT');
        return r;
      } catch (e) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          /* the transaction was already rolled back by SQLite */
        }
        throw e;
      }
    });
  }
  async close() {
    await this.serial(async () => this.db.close());
  }
  /** How long `BEGIN IMMEDIATE` waits for another process (ms). */
  get busy(): number {
    return this.busyMs;
  }
}

export class SqliteRealityStore extends SqlRealityStore {
  readonly kind = 'sqlite' as const;
  private polls = new Set<ReturnType<typeof setInterval>>();

  private constructor(
    private sqlite: SqliteDb,
    readonly file: string,
    private pollMs: number,
  ) {
    super(sqlite);
  }

  /**
   * Opens (or creates) the file and brings its schema to the latest version, unless `migrate: false` (`bridge
   * migrate` and `doctor` look first). `pollMs`: how often the other processes' acceptances are looked for.
   */
  static async open(
    file: string,
    o: { migrate?: boolean; pollMs?: number; busyMs?: number } = {},
  ): Promise<SqliteRealityStore> {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    // Loaded here, not at the top: a 4.1.9 configuration (the JSON-lines journal) never needs it, on any Node.
    const { DatabaseSync } = await import('node:sqlite');
    const busyMs = o.busyMs ?? 5000;
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA busy_timeout = ${busyMs}`);
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    const store = new SqliteRealityStore(
      new SqliteDb(db, busyMs, file === ':memory:' ? file : resolve(file)),
      file,
      o.pollMs ?? 250,
    );
    if (o.migrate !== false) await store.migrate();
    return store;
  }

  /** Transactions that waited for another process's lock and tried again. */
  get retries(): number {
    return this.sqlite.retries;
  }

  protected async announce(): Promise<void> {
    // Nothing to send: the other processes poll the journal (`watch`).
  }

  watch(tenantId: string, wake: (playerId: string) => void): () => void {
    checkTenant(tenantId);
    let mark: number | undefined;
    let busy = false;
    const look = async () => {
      if (busy) return;
      busy = true;
      try {
        if (mark === undefined) {
          const [r] = await this.db.all('SELECT COALESCE(MAX(rowid), 0) AS m FROM signals');
          mark = Number(r?.m ?? 0);
          return;
        }
        const rows = await this.db.all(
          'SELECT rowid AS r, player_id FROM signals WHERE rowid > $1 AND tenant_id = $2 ORDER BY rowid LIMIT 1000',
          [mark, tenantId],
        );
        const players = new Set<string>();
        for (const row of rows) {
          mark = Math.max(mark, Number(row.r));
          players.add(String(row.player_id));
        }
        for (const p of players) wake(p);
      } catch {
        /* the store is closing, or busy: the next poll looks again */
      } finally {
        busy = false;
      }
    };
    void look();
    const t = setInterval(() => void look(), this.pollMs);
    t.unref?.();
    this.polls.add(t);
    return () => {
      clearInterval(t);
      this.polls.delete(t);
    };
  }

  override async close() {
    for (const t of this.polls) clearInterval(t);
    this.polls.clear();
    await super.close();
  }
}
