// The SQLite store's own decisions, each held by a short test in one process (4.1.18, the reality-store mutation set):
// parameters bound as SQLite takes them, one chain of statements per file (and none shared between in-memory
// databases), the busy wait and its back-off, the file created 0600 and switched to WAL, a close done once, and a
// poll's outage reported once. Another connection stands for another process; no load, no Postgres.
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync as RealDatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StoreBusyError } from '../bridge/src/store-async';
import type { Row } from '../bridge/src/store-sql';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';

/** What the store's connection meets: the file as it stands when SQLite opens it, and a WAL switch answered otherwise. */
const hooks = vi.hoisted(() => ({
  opening: undefined as ((file: string) => void) | undefined,
  journal: undefined as (() => string | undefined) | undefined,
}));
vi.mock('node:sqlite', async (orig) => {
  const real = await orig<typeof import('node:sqlite')>();
  class DatabaseSync extends real.DatabaseSync {
    constructor(file: string, o?: object) {
      hooks.opening?.(file);
      super(file, o ?? {});
    }
    override prepare(sql: string) {
      const mode = sql === 'PRAGMA journal_mode = WAL' ? hooks.journal?.() : undefined;
      if (mode !== undefined) return { all: () => [{ journal_mode: mode }] } as never;
      return super.prepare(sql);
    }
  }
  return { ...real, DatabaseSync };
});

/** The store's connection wrapper, as the tests reach into it. */
type Inner = {
  db: RealDatabaseSync;
  retries: number;
  patiently<T>(fn: () => T): Promise<T>;
  tx<T>(k: string | undefined, fn: (q: { all(sql: string): Promise<Row[]> }) => Promise<T>, o?: object): Promise<T>;
};
const inner = (s: SqliteRealityStore) => s.db as unknown as Inner;

const dir = mkdtempSync(join(tmpdir(), 'reality-store-sqlite-'));
const opened: SqliteRealityStore[] = [];
const open = async (file: string, o: Parameters<typeof SqliteRealityStore.open>[1] = {}) => {
  const s = await SqliteRealityStore.open(file, o);
  opened.push(s);
  return s;
};
let n = 0;
const fresh = () => join(dir, `${++n}.sqlite`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const busy = () => new Error('SQLITE_BUSY: database is locked');
afterEach(() => {
  hooks.opening = undefined;
  hooks.journal = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
// Run in a directory of its own: a store that wrongly took ":memory:" for a file name leaves nothing in the checkout.
const home = process.cwd();
beforeAll(() => process.chdir(dir));
afterAll(async () => {
  for (const s of opened) await s.close().catch(() => {});
  process.chdir(home);
  rmSync(dir, { recursive: true, force: true });
});

describe('the parameters SQLite is given', () => {
  it('a boolean is bound as 1 or 0, undefined as NULL', async () => {
    const s = await open(':memory:', { migrate: false });
    expect(await s.db.all('SELECT $1 AS t, $2 AS f, $3 AS u', [true, false, undefined])).toEqual([
      { t: 1, f: 0, u: null },
    ]);
  });

  it('a statement is prepared once, then reused', async () => {
    const s = await open(':memory:', { migrate: false });
    const prepare = vi.spyOn(inner(s).db, 'prepare');
    await s.db.all('SELECT 1 AS one');
    await s.db.all('SELECT 1 AS one');
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});

describe('one chain of statements per file in this process', () => {
  it('two stores on one file, one named by a relative path: the second waits its turn, never for the lock', async () => {
    const file = fresh();
    const a = await open(file, { migrate: false });
    const b = await open(relative(process.cwd(), file), { migrate: false });
    await a.db.exec('CREATE TABLE t (x INTEGER)');
    const order: string[] = [];
    const first = a.db.tx(undefined, async (q) => {
      await q.run('INSERT INTO t VALUES (1)');
      await sleep(120);
      order.push('a');
    });
    const second = b.db.run('INSERT INTO t VALUES (2)').then(() => order.push('b'));
    await Promise.all([first, second]);
    expect(order).toEqual(['a', 'b']);
    expect(b.retries).toBe(0);
  });

  it('two in-memory stores share no chain: a transaction of one may wait for a statement of the other', async () => {
    const a = await open(':memory:', { migrate: false });
    const b = await open(':memory:', { migrate: false });
    const done = a.db.tx(undefined, async () => (await b.db.all('SELECT 7 AS x'))[0]?.x);
    expect(await Promise.race([done, sleep(1000).then(() => 'stuck')])).toBe(7);
  });
});

describe('the busy wait', () => {
  it('a busy statement is tried again and its result returned', async () => {
    const s = await open(':memory:', { migrate: false });
    let calls = 0;
    const r = await inner(s).patiently(() => {
      if (++calls === 1) throw busy();
      return 42;
    });
    expect([r, calls, s.retries]).toEqual([42, 2, 1]);
  });

  it('another error is thrown at once, not tried again', async () => {
    const s = await open(':memory:', { migrate: false });
    let calls = 0;
    const r = inner(s).patiently(() => {
      calls++;
      throw new Error('no such table: nowhere');
    });
    await expect(r).rejects.toThrow('no such table');
    expect([calls, s.retries]).toEqual([1, 0]);
  });

  it('still busy past busyMs: a StoreBusyError', async () => {
    const s = await open(':memory:', { migrate: false, busyMs: 30 });
    let over = false;
    const r = inner(s).patiently(() => {
      if (!over) throw busy();
      return 'late';
    });
    const settled = await Promise.race([r.then(String, (e) => e), sleep(1000).then(() => 'never gave up')]);
    over = true;
    expect(settled).toBeInstanceOf(StoreBusyError);
  });

  it('busyMs spent exactly: no further try', async () => {
    const s = await open(':memory:', { migrate: false, busyMs: 100 });
    const times = [1000, 1100];
    vi.spyOn(Date, 'now').mockImplementation(() => times.shift() ?? 9000);
    await expect(
      inner(s).patiently(() => {
        throw busy();
      }),
    ).rejects.toBeInstanceOf(StoreBusyError);
    expect(s.retries).toBe(0);
  });

  it('the back-off is 5 ms the first time, plus up to 10 ms of jitter', async () => {
    const s = await open(':memory:', { migrate: false });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    let calls = 0;
    await inner(s).patiently(() => {
      if (++calls === 1) throw busy();
      return 1;
    });
    expect(timeout.mock.calls[0]?.[1]).toBe(10);
  });

  it('a read-only transaction takes no write lock: another connection writing does not hold it up', async () => {
    const file = fresh();
    const s = await open(file, { busyMs: 100 });
    const other = new RealDatabaseSync(file);
    other.exec('BEGIN IMMEDIATE');
    try {
      const rows = await inner(s).tx(undefined, (q) => q.all('SELECT 1 AS one'), { readOnly: true });
      expect(rows).toEqual([{ one: 1 }]);
      expect(s.retries).toBe(0);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
  });
});

describe('opening and closing', () => {
  it('a new file in a new directory is created 0600 before SQLite opens it, then switched to WAL', async () => {
    const file = join(dir, 'new', 'deep.sqlite');
    const seen: (number | 'missing')[] = [];
    hooks.opening = (f) => seen.push(existsSync(f) ? statSync(f).mode & 0o777 : 'missing');
    const s = await open(file);
    expect(seen).toEqual([0o600]);
    expect(await s.db.all('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
  });

  it('a file someone else left 0644 is the owner’s only once opened, its WAL too', async () => {
    const file = fresh();
    writeFileSync(file, '');
    chmodSync(file, 0o644);
    await open(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(`${file}-wal`).mode & 0o777).toBe(0o600);
  });

  it('a WAL switch answered in another mode is tried again until the journal is WAL', async () => {
    const answers = ['delete'];
    hooks.journal = () => answers.shift();
    const s = await open(fresh());
    expect(s.retries).toBe(1);
    expect(await s.db.all('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
  });

  it('":memory:" touches no file of that name, and is not switched to WAL', async () => {
    const cwd = process.cwd();
    const here = mkdtempSync(join(dir, 'cwd-'));
    process.chdir(here);
    try {
      await open(':memory:', { busyMs: 50 });
      expect(existsSync(':memory:')).toBe(false);
      writeFileSync(':memory:', '');
      chmodSync(':memory:', 0o644);
      await open(':memory:', { busyMs: 50 });
      expect(statSync(':memory:').mode & 0o777).toBe(0o644);
    } finally {
      process.chdir(cwd);
    }
  });

  it('closed once: a second close does nothing, and the connection is closed', async () => {
    const s = await SqliteRealityStore.open(':memory:', { migrate: false });
    await s.close();
    await expect(s.close()).resolves.toBeUndefined();
    expect(() => inner(s).db.exec('SELECT 1')).toThrow();
  });
});

describe('the poll of the other processes’ acceptances', () => {
  /** A store whose poll reads through `all`, stepped by hand. */
  async function polled(errors: unknown[]) {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const s = await open(':memory:', { pollMs: 100, onPollError: (e) => errors.push(e) });
    const answers: (() => Promise<Row[]>)[] = [];
    let calls = 0;
    s.db.all = () => {
      calls++;
      return (answers.shift() ?? (() => Promise.resolve([])))();
    };
    const tick = async () => {
      vi.advanceTimersByTime(100);
      await new Promise((r) => setImmediate(r));
    };
    return { s, answers, tick, calls: () => calls };
  }
  const ok = () => Promise.resolve([] as Row[]);
  const fail = () => Promise.reject(new StoreBusyError('busy'));

  it('an outage is reported once, and again after the poll recovered', async () => {
    const errors: unknown[] = [];
    const { s, answers, tick } = await polled(errors);
    answers.push(() => Promise.resolve([{ m: 0 }]), fail, fail, ok, fail);
    const stop = s.watch('default', () => {});
    await new Promise((r) => setImmediate(r));
    await tick();
    expect(errors.length).toBe(1);
    await tick();
    expect(errors.length).toBe(1);
    await tick();
    await tick();
    expect(errors.length).toBe(2);
    stop();
  });

  it('a poll still running is not started twice', async () => {
    const { s, answers, tick, calls } = await polled([]);
    answers.push(() => new Promise<Row[]>(() => {}));
    const stop = s.watch('default', () => {});
    await tick();
    await tick();
    expect(calls()).toBe(1);
    stop();
  });
});
