## 4.1.19 PR 1: the backup is one snapshot, the restore all or nothing (ADR 0021)

- Plan §5. The 4.1.18 defects were reproduced by the new tests: tenant exports run concurrently (one Postgres snapshot
  each), then runs and daily records in a later transaction; a restore wrote each tenant in its own transaction, then
  the runs; a JSONL restore could not succeed; the file was cast unchecked, read whole and written in place.
- `bridge/src/backup.ts`, an operator's capability over `SqlRealityStore`. `RealityStore` does not grow.
  - **Backup schema 3**: one read-only transaction and one envelope (backend, versions, start and end, counts, SHA-256
    of the canonical payload). Rows are counted before loading, and the size is bounded. The file is written to a
    temporary file and renamed.
  - **Restore**: the file is read bounded with `fstat` and checked by a strict zod schema for schemas 1, 2 and 3,
    including relations and the digest. The columns written come from the Bridge's own list. Every conflict is found
    before the first write. Everything is written in one transaction and compared with the file before the commit; an
    audit follows the commit (exit code 3 means P0).
  - **The journal** is refused before it is touched.
- `store-sql.ts`: `exportTenantIn` and `importTenantIn` take the caller's transaction.
- The `migrations.ts` `>`→`>=` equivalent is killed by a test that counts transactions, and removed from
  `mutants.json`.
- `tests/bridge-backup.test.ts` covers:
  - the round trip, conflicts and `--force`;
  - a late database error that undoes the tenants already written;
  - a read-back difference that rolls back;
  - a writer that commits a run and its daily record together while backups run;
  - the bounds, links, the atomic write, a forged digest, counts, columns, types, duplicates and relations;
  - schemas 1 and 2, including a Postgres BIGINT given as text;
  - the journal refused.
- It runs on SQLite, and on Postgres in CI's `bridge-postgres` job, one database per case.

- The second reading (an automated second context) found eight defects, all fixed:
  - **The read-back compared the database's order.** Under a non-C collation (en_US, the default of most Postgres),
    a real leaderboard would have failed every restore. Both sides are now ordered by code unit, and so is the
    backup itself: the same store gives the same file from SQLite and from Postgres. The tests now create their
    Postgres databases in en_US, with mixed-case ids.
  - **A schema 1 file deleted leaderboards it never knew of under `--force`.** Only files that carry runs now speak
    for their tenants' runs.
  - **The `IN` lists were not chunked.** They now go in chunks of 500.
  - **An audit difference was announced as a P0 whatever its cause.** REALITY-OPS now says to stop the Bridge
    during a restore, and the audit's own failure is caught.
  - **A lost answer to the COMMIT was said as "rolled back".** It is now said as unknown, with exit code 3.
  - **`--max-bytes=abc` disabled the bound.** A bound must now be a positive integer, otherwise the exit code is 2.
  - **The file read could follow a swapped link.** It is now opened with `O_NOFOLLOW` and its `ino` and `dev` are
    compared.
  - **Text caps were narrower than what produces the rows.** They were widened, and `envelope` is now bounded by the
    file.

→ next: Claude · PR 2 (artefacts and Field Kit), PR 4 (leftovers)
