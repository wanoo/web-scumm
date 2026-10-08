### Breaking

- **`RunStore` is the durable queue's** (4.1.16): `create` (false on a duplicate key), `claimNext` (a lease),
  `complete` (only by the lease's holder), `setTrust`, `queued`; `put` and `byKey` are gone. A host that wrote its own
  store implements these (`MemoryRunStore` and `SqlRunStore` ship).

### Fixed

- **Two tied runs share a rank** on a Bridge leaderboard; the order after the time is the submission, then the id.
- **The daily challenge refuses what is not a day**: `date=`, `1999-99-99`, `2026-02-30` (400), a day older than
  `retentionDays` (410), a game id that is an object's property (`__proto__`, 404); its commit counters forget
  clients whose hour is over.

### Changes

- **Durable, shared speedrun leaderboards** (4.1.16, plan §8): runs in the Bridge's SQLite or Postgres (migration
  0002), created once per key across instances, claimed by one worker under a lease and claimed again when the worker
  died, kept across restarts; `workers` per instance; a leaderboard per verifier key (`&key=`, a Fixed or Daily
  world's board apart); a Daily run sent after its day is practice; audit lines for submissions, verdicts,
  moderations and deletions.
- **`bridge serve` mounts `/v1/runs` and the daily challenge** from a configuration's `runs` and `daily` sections, on
  the SQL store, behind the same tenant, CORS and rate limits as the other routes; `bridgeServer` takes `runs` and
  `daily`. REALITY-OPS gives the worker's isolation profile (a container without network, read-only, no secret).
- **The player keeps a Daily world's signed token** and a speedrun in that world carries it.
