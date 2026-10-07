# The Reality Bridge under load (4.1.10)

`npm run bridge:load` (`tools/bridge-load.ts`): three `serve` processes of the packaged command line on one store,
1 000 players seeded in the store, 50 000 connector proposals over HTTP sent to the instances in turn by 64 concurrent
clients, the first 50 players followed by event streams (SSE) on the third instance. Each proposal is authorised
(Biscuit), deduplicated, sequenced and signed (Ed25519) in one transaction, as in production. Checked after the run:
one journal row per accepted proposal, every player's sequence contiguous, every followed stream complete, in order,
once each. A run that fails one of those checks exits 1. The nightly workflow runs it on SQLite and on Postgres 16 and
keeps the JSON report (`bridge-load-sqlite`, `bridge-load-postgres` artifacts).

## Measured

| Store | Machine | Proposals | Time | Throughput | Accepted latency p50 / p95 / p99 / max | Refused or failed | Journal | Streams |
|---|---|---|---|---|---|---|---|---|
| SQLite (one file, WAL, `synchronous = FULL`) | Apple M5, 10 cores, 32 GB, macOS (Darwin 25.5.0, arm64), Node 22.14.0 | 50 000 | 49.6 s | 1 008 / s | 40.1 / 193.6 / 260.2 / 1 872.8 ms | none (50 000 × 202) | 50 000 rows, 0 gaps | 50 / 50 complete |

Source: one local run on 7 October 2026 (`npx tsx tools/bridge-load.ts --out=…`, the report above copied from its
JSON), the maintainer's machine, nothing else heavy running. One run, not a distribution: the figures say the order of
magnitude, not a guarantee.

**Not measured here: Postgres.** The maintainer's machine has no Docker daemon running, and the spawned processes cannot
load `pg` from outside the repository's `node_modules`; the first figures come from the nightly's `bridge-load
(postgres)` job on GitHub's `ubuntu-24.04` runner and are added here once read. The Postgres store's correctness (the
store contract, the tenants crossed, the fan-out between two instances) was run locally against a throwaway
PostgreSQL 17.9 server; CI runs it on 16.

## The limits reached

- **The write lock of one SQLite file.** Every acceptance, from every process, takes the database's write lock for its
  transaction (`BEGIN IMMEDIATE`): throughput does not grow with instances on SQLite, it is shared. The p95 of ~190 ms
  at 64 concurrent clients is queueing on that lock, not work; the max (~1.9 s) is a transaction that waited for the
  others while a WAL checkpoint ran. SQLite is the `local` profile (D20): one machine, a few processes.
- **A waiting process blocks its event loop.** `node:sqlite` is synchronous: an instance waiting for another's lock
  (`busy_timeout`, 5 s) answers nothing else meanwhile, its streams' heartbeats included. Invisible at this load;
  the reason the `distributed` profile is Postgres.
- **Per-connector quotas are per instance.** The load test lifts them (`limits` in `config.json`); in production N
  instances admit N times `perMinutePerConnector` (docs/dev/threat-models/constellation.md).
- **Not reached:** the per-player pending bound (lifted), the open-streams bound per instance (10 000 by default; 50
  here), memory (not measured by the tool).
