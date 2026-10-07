## `feature/4110-constellation`: the Bridge behind RealityStore, SQLite and Postgres, tenants, stateless instances, SignalV2

- Decided first, written before the code: `docs/dev/threat-models/constellation.md` (a V1 signal replays across two
  tenants that share a key; a capability looked up without its tenant reads another tenant; keys per tenant; the
  audience alone is not enough), ADR 0009 (`RealityStore`), ADR 0010 (`SignalV2` retained: V1 and V2 accepted by the
  player until 4.1.12, V2 only from a multi-tenant Bridge), D20 (SQLite local, Postgres distributed and experimental,
  JSONL import and audit, `trust-proxy` by allowlist). `init` still writes the journal's configuration by default
  (`--store=sqlite` opts in): the engine declares Node 22.12 and `node:sqlite` is unflagged from 22.13.
- Measured (one local run, 7 October 2026, Apple M5, 10 cores, 32 GB, Node 22.14.0; `npx tsx tools/bridge-load.ts`):
  SQLite, three instances, 1 000 players, 50 000 proposals from 64 clients: 49.6 s, 1 008 proposals/s, accepted
  latency p50 40.1 ms, p95 193.6 ms, p99 260.2 ms, max 1 872.8 ms, 50 000 rows, 0 gaps, 50/50 streams complete. The
  `kill -9` test: 1 000 proposals over three processes, one killed after 300, every key once, sequences contiguous.
- Run locally against a throwaway PostgreSQL 17.9 server (no Docker daemon): the store contract, the tenancy and the
  fan-out tests with `BRIDGE_PG_URL`. CI runs them on Postgres 16 (`bridge-postgres`, service container pinned by
  digest). The Rust cross-check (`cargo`) agrees on the 32 V1 cases and the 18 V2 vectors.
- Not done: the Postgres load figures (the nightly's `bridge-load (postgres)` publishes the first; the spawned
  processes cannot load `pg` from outside the repository here), the `kill -9` test on Postgres (CI only), a mutation
  run of the refactored `bridge.ts` (gated set `reality`: survivors possible, read on the next nightly) and of the new
  `reality-store` set (not gated), retention on a SQL store, row-level security per tenant, a rate limit per
  connector shared between instances, the `4.1.10-rc.1` and the release branch.
→ next: Claude · `release/4.1.10`
