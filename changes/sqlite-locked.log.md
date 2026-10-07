## `fix/sqlite-locked`: the kill -9 test's "database is locked"

- Seen three times on GitHub's runners, never locally (PR #51 node-24, PR #46 coverage, the `v4.1.13` tag's node-24):
  `bridge-fanout` › three processes, one SQLite file: `the Bridge exited (1)` then `database is locked`, i.e. a
  `serve` dying before it listened. Cause: `SqliteRealityStore.open` ran `PRAGMA journal_mode = WAL` (and
  `synchronous`) straight on the connection, outside `patiently`; SQLite's own 50 ms wait is not enough when another
  process holds the file's exclusive lock while switching it to WAL or migrating it.
- Measured: 6 or 8 processes opening one fresh file at once, `store-sqlite.ts:169` threw 1/90, 1/240 and 2/480 times
  before; 0/240 and 0/480 after. `tests/bridge-sqlite-busy.test.ts` (4 tests: a file held exclusively by another
  connection while one or three stores open it; held past `busyMs` gives `StoreBusyError`; a busy poll is reported
  once and resumes) fails 4/4 without the fix, passes with it. `bridge-fanout`, `bridge-reality-store`,
  `bridge-store`, `bridge-ops`, `bridge` pass, one file at a time.
- Also: statements inside a transaction go through the wait (a read-only transaction's first `SELECT` may meet
  another process's recovery); `DatabaseSync` gets `timeout` (Node 22.16+; the pragma stays for older); the poll's
  failures go to `onPollError`, which `serve` logs.
- Not done: no mutation run (`store-sqlite.ts` is outside the `reality` set); the kill -9 test itself not looped on
  CI; Postgres untouched.
→ next: Claude · watch the kill -9 test on the next CI runs; if it flakes again, the exit names a `StoreBusyError` (a wait too short) rather than an escaped lock
