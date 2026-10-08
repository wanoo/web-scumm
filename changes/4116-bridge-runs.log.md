## `feature/4116-bridge-runs`: durable leaderboards and daily challenge, leases across instances, mounted routes (4.1.16 PR 3)

- Delivered: `bridge/src/runs-store.ts` (`RunStore` with `create`/`claimNext`/`complete`, `MemoryRunStore`,
  `SqlRunStore` over the Reality store's `SqlDb`: `INSERT … ON CONFLICT DO NOTHING` on `UNIQUE (tenant_id, run_key)`,
  a claim in one transaction under the lock `runs:claim`, a verdict stored only by the lease's holder); migration
  0002 (`runs`, `daily_kv`); the queue's workers claim from the store (`workers`, `leaseMs`, `pollMs`), `idle()` claims
  once first; the leaderboard by `leaderboardKey`, ties sharing a rank; a late Daily run is practice; audit lines;
  `DailyStore` asynchronous (`putIfAbsent`), `SqlDailyStore`; dates validated as real UTC days, a retention,
  `Object.hasOwn` on games, the commit counters pruned; `bridgeServer({ runs, daily })` behind tenants, CORS (DELETE,
  `X-Delete-Token`) and the anonymous budget; `bridge serve` from `runs` and `daily` sections (SQL store required);
  the player's `storedEvidence` (a Daily world's token kept beside it) handed to the recorder. Tests:
  `tests/bridge-runs-durable.test.ts` (SQLite here and Postgres in CI's `bridge-postgres` job: two instances and the
  same run at once, three workers over two instances, a dead worker's lease, a restart, ties, keys, tenants, a re-sealed
  copy, late Daily runs, the daily store across instances, the mounted routes; the stub worker
  `tests/fixtures/runs-stub-worker.mjs` speaks the real protocol), date refusals.
- Decided: one queue per server (the first directory's `runs`), the daily challenge per tenant; the commit counters
  stay per instance (bounded, pruned), the commitments themselves are shared; the daily key rotates with a release of
  the game (the manifest names one key; the DSL is frozen, D28).
- Not done: the player's Mystery flow (a Mystery category refuses to start in the player); the worker's container
  profile is documented (REALITY-OPS), not run in CI; Postgres figures for many workers (4.1.10's load job is the place).
→ next: Claude · `feature/4116-code-wheel` (4.1.16 PR 4)
