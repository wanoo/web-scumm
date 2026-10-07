// The SQLite store under another process's lock (4.1.14): the kill -9 test's flake on GitHub's runners was one of three
// `serve` processes opening one file at once and exiting on "database is locked", thrown by `PRAGMA journal_mode = WAL`
// outside the store's busy wait. Here another connection holds the file (as another process would), deterministically.
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { StoreBusyError } from '../bridge/src/store-async';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';

const dir = mkdtempSync(join(tmpdir(), 'bridge-sqlite-busy-'));
const opened: SqliteRealityStore[] = [];
afterAll(async () => {
  for (const s of opened) await s.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

/** Another connection takes the whole file (what a process switching it to WAL, or migrating it, does). */
function holdExclusively(file: string): () => void {
  const other = new DatabaseSync(file);
  other.exec('PRAGMA locking_mode = EXCLUSIVE');
  other.exec('BEGIN EXCLUSIVE');
  other.exec('CREATE TABLE IF NOT EXISTS held (x INTEGER)');
  return () => {
    other.exec('COMMIT');
    other.close();
  };
}

describe('the SQLite store under another connection lock', () => {
  it('opening a file another connection holds waits for it (the pragmas and migrations included), then opens', async () => {
    const file = join(dir, 'open.sqlite');
    const release = holdExclusively(file);
    setTimeout(release, 200);
    const store = await SqliteRealityStore.open(file);
    opened.push(store);
    expect(store.retries).toBeGreaterThan(0);
    expect(await store.db.all('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    expect(await store.schemaVersion()).toBeGreaterThan(0);
  });

  it('three stores opening and migrating one held file at once: all open, the schema applied once', async () => {
    const file = join(dir, 'three.sqlite');
    const release = holdExclusively(file);
    setTimeout(release, 150);
    const stores = await Promise.all([0, 1, 2].map(() => SqliteRealityStore.open(file)));
    opened.push(...stores);
    const [rows] = await stores[2]!.db.all('SELECT COUNT(*) AS n, COUNT(DISTINCT version) AS d FROM schema_migrations');
    expect(rows!.n).toBe(rows!.d);
  });

  it('still held past its wait: a StoreBusyError, never "database is locked"', async () => {
    const file = join(dir, 'past.sqlite');
    const release = holdExclusively(file);
    try {
      await expect(SqliteRealityStore.open(file, { busyMs: 100 })).rejects.toBeInstanceOf(StoreBusyError);
    } finally {
      release();
    }
  });

  it('a poll that stays busy past its wait is reported once and tried again, never fatal', async () => {
    const file = join(dir, 'poll.sqlite');
    const errors: unknown[] = [];
    const store = await SqliteRealityStore.open(file, { pollMs: 20, busyMs: 60, onPollError: (e) => errors.push(e) });
    opened.push(store);
    const woken: string[] = [];
    store.watch('default', (p) => woken.push(p));
    await new Promise((r) => setTimeout(r, 60));
    // In WAL a reader is not blocked by another connection's write: the poll's statement is made to stay busy instead.
    const all = store.db.all.bind(store.db);
    store.db.all = () => Promise.reject(new StoreBusyError('the store stayed busy for 60 ms'));
    await new Promise((r) => setTimeout(r, 200));
    store.db.all = all;
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(StoreBusyError);
    await store.db.run(
      "INSERT INTO signals (tenant_id, player_id, sequence, id, dedupe_key, jws, at) VALUES ('default', 'p1', 1, 's1', 'k1', 'x', 0)",
    );
    for (let t = 0; t < 2000 && !woken.length; t += 20) await new Promise((r) => setTimeout(r, 20));
    expect(woken).toEqual(['p1']);
  });
});
