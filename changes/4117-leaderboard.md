### Fixed

- **A leaderboard never loses a faster run** (4.1.17): the store returned the first 10 000 runs by submission and the
  queue ranked those, so a faster run submitted after them was missing (reproduced with 10 001 rows). The store now
  ranks: each pseudonym's best, ordered by time then submission then id, equal times sharing a rank, then the limit
  (100 lines, `&limit=` up to 1 000). The memory store, SQLite and Postgres answer the same.
- **A ranked time is canonical** (4.1.17): `"00042"` and `"42"` were two times; the worker's time is kept as decimal
  digits without leading zeros (at most 30), ordered as a decimal past `Number.MAX_SAFE_INTEGER`.

### Changes

- **Bridge schema 3** (4.1.17, `bridge/migrations/0003`): the ranked times of 4.1.16's rows brought to the canonical
  form, a value that is not a decimal set aside (its time removed, its trust untouched, said in its reason), and the
  index the ranking reads. `bridge migrate --schema=2` undoes the index only.
- **`npm run runs:load`** (4.1.17): the leaderboard at 100 000 runs on SQLite or Postgres: p50/p95 latency, resident
  memory, the SQL plan; a bound passed fails it. The candidate and the nightly run it on both stores.
- The leaderboard says what it ranks: each **pseudonym**'s best (the Bridge knows no player identity).
