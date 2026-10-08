## 4.1.17 PR 3 — the leaderboard at any size: ranked by the store, before the limit

Reproduced first: 10 000 runs then a faster 10 001st on `MemoryRunStore` — absent from the board (`hasFastest ===
false`), and the same on SQLite (`ORDER BY submitted_at, id LIMIT 10000`, then the best per player in JS).
`RunStore.board(LeaderboardQuery)` now returns ranked rows: SQL with `ROW_NUMBER() OVER (PARTITION BY player …)` then
`RANK()` then `LIMIT` (SQLite and Postgres, ids and times compared `COLLATE "C"` on Postgres); the memory store the
same in `rankBoard`. A time is canonical at write (`canonicalTime`), so its order is its length then its text — no
number type, no collation. Migration 0003 (dialect-neutral: `LTRIM`, ten `REPLACE`s to recognise a decimal) canonicalises
4.1.16's rows and sets aside what is not a time (`ranked = NULL`, trust untouched, the reason says it); tested on a
schema 2 database with `00042`, `000`, `abc` and 31 digits. Index `runs_rank (tenant, game, category, status,
verdict, player)`: at 100 000 runs on one board (200 000 rows) SQLite reads it in 207 ms p50, 210 ms p95 on a laptop,
136 MB resident (`npm run runs:load`); bounds in CI: 2 000 ms p95, 512 MB.

Said in SPEEDRUN en/fr: each **pseudonym**'s best (no player identity in the Bridge); 100 lines, `&limit=` ≤ 1 000.

→ next: PR 4, admission and quota across instances.
