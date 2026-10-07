# 0009 · The Bridge keeps its state behind an asynchronous `RealityStore`

**Context.** Until 4.1.9 the reference Bridge kept its state in a synchronous `BridgeStore` (`bridge/src/store.ts`):
memory for the tests, an fsync'd JSON-lines journal replayed at start, one process per journal (`JournalLock`). The
sequence of a player was read, incremented and written by one process under an in-memory lock (`bridge/src/lock.ts`).
4.1.10 "Constellation" needs several instances sharing one database and several tenants in it
(`docs/dev/threat-models/constellation.md`): a lock in one process no longer orders anything, and a synchronous
interface cannot front a network database.

**Decision.** The Bridge calls one asynchronous interface, `RealityStore` (`bridge/src/store-async.ts`), whose every
method takes `tenantId` first. `appendSignal` is the one write that matters: in one transaction it looks the
`dedupeKey` up (a duplicate returns the stored signal and `duplicate: true`), draws the sequence as `MAX + 1` for that
tenant and player, calls the Bridge back synchronously with that sequence and the player's acknowledgement (the
Bridge checks its quotas and signs there, with `node:crypto`'s synchronous Ed25519), and writes the row; a throw from
the callback rolls the transaction back. Unique constraints on `(tenant_id, player_id, dedupe_key)` and
`(tenant_id, player_id, sequence)` back the transaction. Three implementations:

- `MemoryRealityStore` (`bridge/src/store-memory.ts`): the tests; `fromBridgeStore` wraps a 4.1.9 `BridgeStore`
  (memory or JSONL) for the single tenant `default`, so `npm run bridge` and its journal keep working unchanged.
- `SqliteRealityStore` (`bridge/src/store-sqlite.ts`): `node:sqlite` (Node 22.13+, no native dependency), WAL, `BEGIN
  IMMEDIATE` for `appendSignal`; several processes on one file are safe (the `kill -9` test runs three).
- `PostgresRealityStore` (`bridge/src/store-postgres.ts`): `pg`, loaded only when used; `pg_advisory_xact_lock` per
  player for `appendSignal`; `LISTEN/NOTIFY` to wake the other instances' streams.

The schema is versioned in `bridge/migrations/` (`0001.up.sql`, `0001.down.sql`), one dialect-neutral file per step,
applied in order by `bridge/src/migrations.ts` and recorded in `schema_migrations`. The JSON-lines journal stays an
import and audit format (`bridge migrate --from jsonl --to sqlite`).

**Cost.** Every Bridge method that reads the store is asynchronous (the tests `await` what they used to call); a
signature is computed inside a transaction (well under a millisecond with Ed25519); two SQL dialects kept in one file
(only portable types and `ON CONFLICT`); the in-memory lock stays for the single-process stores and is redundant with
the transaction elsewhere.

**Would change it.** A store that cannot hold a transaction across the sequence and the dedupe check (an eventually
consistent key-value store): it would need a sequencer of its own, and a new ADR.
