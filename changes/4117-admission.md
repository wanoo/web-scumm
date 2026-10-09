### Fixed

- **The speedrun queue's room holds for every instance together** (4.1.17): an instance counted the waiting runs,
  then wrote; two instances seeing 99 of 100 both wrote. `RunStore.admit` says `created`, `duplicate` or `full` in
  one step (a transaction under the tenant's lock), and counts runs waiting **or being verified**.
- **The submission quota holds for every instance together** (4.1.17): each process kept its own buckets, so three
  instances gave a client three quotas. `bridge serve` on a SQL store keeps one bucket per client in `run_quota`
  (migration 0004), keyed by an HMAC of the address (never the address), its secret derived from the tenant's event
  key; a refusal says `Retry-After`. A library host keeps the per-instance `MemoryLimiter` unless it passes a
  `SqlLimiter`.

- **A worker that writes too much is said so** (4.1.17): its answer over 1 MB is killed, and the queue read the kill's
  signal as a timeout (`inconclusive`, `timeout`); it is `inconclusive`, `crash`, "the worker wrote too much". Found by
  the mutation run of the new `runs` set.

### Changes

- **Bridge schema 4** (4.1.17): the table `run_quota`. `runs.perMinute` in a configuration's `runs` section.
- **The mutation set `runs`** (`bridge/src/runs.ts`, `runs-store.ts`, `runs-limiter.ts`) is gated from 4.1.17:
  `npm run test:mutation:runs`, a job of its own in ci (`full-ci`), the nightly, the candidate and the release. Its
  survivors read one by one: tests of the queue, the worker, the routes and the stores (`tests/bridge-runs-*.test.ts`).
- **`gh workflow run mutation -f set=<set> -f ref=<ref>`** (4.1.17): one mutation set measured on a runner, its report
  kept with the run; it gates nothing.
