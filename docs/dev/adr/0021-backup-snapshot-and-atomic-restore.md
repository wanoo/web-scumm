# 0021 · A backup is one snapshot; a restore is all or nothing (4.1.19)

**Context.** 4.1.18's backup (schema 2) exported each tenant in a transaction of its own, run concurrently
(`Promise.all`; on Postgres one connection and one snapshot each), then read `runs` and `daily_kv` in a later one: under
traffic a file could mix several instants. Its restore wrote each tenant in its own transaction, then the runs and
daily records in another: a late error (a column, a conflict, the database) left the tenants restored and the command
failed. The file was cast to its type without a schema, read whole into memory whatever its size, and written in
place. A restore into the JSON-lines journal could not succeed (`--force` deleted, then threw).

**Decision** (D33, plan §5).

1. **Schema 3, one snapshot.** `bridge backup` reads every family of a SQL store in one read-only transaction
   (Postgres: `REPEATABLE READ READ ONLY`; SQLite in WAL: the transaction's snapshot), through one `SqlQuery`. The
   envelope names the backend, the Bridge's version, the SQL schema, the start and end, the counts per family, and the
   SHA-256 of the payload's canonical text (sorted keys; the digest never covers itself). The rows are counted inside
   the snapshot first and a store above `--max-rows` (2 000 000) is refused before it is loaded; a file above
   `--max-bytes` (256 MiB) is never written. The file is written to a private temporary file, flushed, then renamed.
   A journal pairing's capability is never carried.
2. **A restore checks before it writes.** The file is opened, `fstat`ed and refused above `--max-bytes` before a byte is
   read, a link or a non-regular file refused, a file that changes size while read refused. A strict schema (zod) for
   schemas 1, 2 and 3 refuses an unknown field, a wrong type, an oversized value; then the rows' relations: duplicates
   of every key, an acknowledgement of a player the file does not hold, a row of another tenant, and (schema 3) a run of
   a tenant it does not carry. Schema 3's counts and digest must match. The columns of `runs` and `daily_kv` written are
   the Bridge's own list in canonical order (`RUN_COLUMNS`, compared with the schema by a test), never the file's keys.
3. **One transaction, compared before the commit.** Conflicts (a tenant, a run of its tenants, a daily key) are all
   found before the first write; without `--force` nothing is written. With `--force` the deletes and the inserts share
   the transaction. Before the commit each tenant is exported again and compared with the file, and the runs and daily
   records are read back: a difference rolls everything back. After the commit a separate reading audits the result; a
   difference there is a fault of the backend, said as a P0 (exit code 3), not a late failure of the command.
4. **An operator's capability, not the runtime's.** It lives in `bridge/src/backup.ts` over `SqlRealityStore`
   (`exportTenantIn`, `importTenantIn` on a caller's transaction); `RealityStore` does not grow. The journal is refused
   before it is touched: migrate it to SQLite (`migrate --from=jsonl --to=sqlite`), then restore.

**Costs.** A backup is held in memory once (bounded, not streamed): beyond the bounds, `pg_dump` or the provider's
snapshots are the backup of a large deployment. A restore of schema 1 or 2 keeps their weaker guarantee for runs of a
tenant they do not carry. Restoring into the journal is no longer possible.

**What would change it.** A deployment whose store passes the bounds and needs a portable logical backup (then a
streamed format, one family per section, with the same digest); a backend without a snapshot read.
