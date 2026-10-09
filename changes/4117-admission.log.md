## 4.1.17 PR 4 — admission and quota across instances, and the speedrun queue under mutation

The race was read in the code (`runs.ts`: `queued()` then `create()`, two statements; `RunQueue.buckets` a `Map` per
process) and is now closed by construction. `RunStore.admit(run, maxQueued)` is one transaction under the lock
`runs:admit:<tenant>` (SQLite `BEGIN IMMEDIATE`, Postgres advisory lock): a duplicate first (a duplicate is said as
such even when the queue is full), then the count of `queued` + `verifying`, then the insert. The memory store does
the same without an await between read and write. `SubmissionLimiter`: `MemoryLimiter` (per process, least recently
used past `maxBuckets`) and `SqlLimiter` (`run_quota`, one row per tenant and HMAC client key, under
`runs:quota:<tenant>`); the key version is stored beside the bucket, a rotated key resets the quota once, its buckets
purged. `bridge serve` derives the secret from the tenant's event key (`kid` as version), so every instance of a
tenant has it without new configuration.

Tested: three processes on one SQLite file admitting 10 runs each against a room of 7 (7 created, 2 duplicates of the
shared run, 21 full) and taking 4 tokens each of a 6-a-minute quota at the same instant (6 granted); the stored row
holds the HMAC, not the address; on Postgres (CI's `BRIDGE_PG_URL`) ten connections race. A 429 carries
`Retry-After`; an invalid run costs a token.

The set `runs` joins `GATED` from the start, its tests the four short Bridge run files (12 s a pass): the load tools and
the Postgres races stay out of the loop.

→ next: PR 5, the code wheel's transcript and the trust levels.
