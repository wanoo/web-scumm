# Reality Bridge, several instances and several tenants: threat model (4.1.10 "Constellation")

What changes when the reference Bridge (`docs/dev/THREAT-MODEL.md`, 4.1.1) stops being one process with one journal
for one game: several instances behind a load balancer share a database, and one deployment serves several **tenants**
(a tenant is one operator's game in one environment: its manifest, its Biscuit root, its event keys, its quotas, its
players). Written before the code (`docs/dev/plans/4.1.10-constellation.md` §2); every answer names where it is
implemented and tested. The decisions it leads to: ADR 0009 (`RealityStore`), ADR 0010 (`SignalV2`), D20.

## Assets and boundaries

**New assets.** The shared database (every tenant's players, journals, acknowledgements, revocations, quarantine); the
mapping from a request to its tenant (a `Host`, a header); each tenant's keys; the backups.

**New boundaries.** (5) an instance → the database (trusted, authenticated, TLS on a network); (6) tenant A → tenant B:
**untrusted**. A tenant's operator, connectors and players are assumed hostile to every other tenant; the people who
run the deployment are trusted by all tenants (they hold the database).

## The four questions of the plan

### 1. Can a signal signed for tenant A be replayed to tenant B (same `gameId`, maybe the same `playerId`)?

A signed `WorldSignalV1` names `gameId` and `playerId`, and the player checks both, but nothing else of the context it
was signed for. Two tenants may run **the same game** (a studio's `prod` and `staging`, two schools hosting one
course): the `gameId` is then equal. Player ids are random (`p-` + 64 bits) and drawn by the Bridge, so an equal
`playerId` across tenants is unlikely, not impossible: a database restored from another tenant's backup, a staging
tenant seeded from production, an operator who imports players. The replay then succeeds **when the verifying key is
shared**: two tenants configured with the same event key (one key for a whole hosted deployment is the obvious
shortcut), or one raw key listed under two `kid`s.

With distinct keys per tenant the replay fails on the signature (`key` or `signature`). The reference Bridge draws one
key per tenant, but nothing in a V1 signal **proves** which key context it belongs to, and the player cannot tell a
shared-key deployment from a separate one. **Answer:** a signal that names its context in the signed bytes
(`SignalV2`: `tenantId`, `environment`, `audience`, `gameId`, `playerId`, `sessionId`, `keyId`), a keyring whose keys
say which tenant and environment they sign for, and a verifier that refuses a mismatch (`audience-mismatch`).
`tests/reality-key-confusion.test.ts`.

### 2. Can a read capability read another tenant?

A capability is a random 256-bit secret kept as its SHA-256. In 4.1.9 the lookup was `playerByCapability(hash)` over
the whole store: with one shared database, a capability of tenant A presented on tenant B's host would find A's
player, and B's Bridge would deliver A's journal **signed with B's key**. **Answer:** every read and write of
`RealityStore` takes `tenantId` first and every SQL statement filters on it; indexes and unique constraints lead with
it (`bridge/migrations/0001.up.sql`); the tenant is resolved by the server from the request (`Host` mapping, or the
`X-Web-Scumm-Tenant` header only when the deployment allows it) before any store read. Property tests drive two
tenants with random operations and assert that every operation with the wrong tenant is refused or sees nothing
(`tests/bridge-tenancy.test.ts`).

### 3. Does a compromised signing key of one tenant expose the others?

Only if keys are shared. **Answer:** each tenant has its own event key, its own Biscuit root, its own administrator
token and its own rotation (`rotateKeys(tenantId, …)` writes rows of that tenant only, `bridge rotate --dir=<tenant>`).
A V2 signal binds its `keyId` and its tenant: a key compromised at A signs signals that B's players refuse, even if B's
keyring were (wrongly) given A's raw key under B's name, since the key entry in B's keyring is bound to tenant B.
Revocation lists (`revoked_tokens`) are per tenant. A compromised **instance** holds every tenant's private keys it
serves: that is the trust placed in the deployment's operators, said here and in `docs/en/REALITY-OPS.md`; a tenant
that cannot accept it runs its own deployment (the `local` profile).

### 4. Is the `audience` of a signal enough?

V1 has no audience in the signed signal. The Biscuit `audience` (the connector's grant names the Bridge it speaks to)
protects the **connector → Bridge** hop, not the **Bridge → player** hop. An audience alone (the player's origin) would
not be enough either: two tenants may serve the same origin (one hosted page, a tenant chosen by path), and an origin
says nothing of the environment. The decision is the whole context: `tenantId` + `environment` + `audience` +
`keyId` + `sessionId`, each checked when the verifier knows it. The refusal code for all of them is
`audience-mismatch`: the signal was minted for another audience in the broad sense.

## Other threats of a distributed Bridge

| Threat | Answer | Where |
|---|---|---|
| Two instances accept one proposal (a retried webhook, a connector that times out and retries elsewhere) | `appendSignal` is one transaction: the `dedupeKey` looked up and the sequence drawn as `MAX + 1` under a per-player lock (SQLite: `BEGIN IMMEDIATE`; Postgres: `pg_advisory_xact_lock`), backed by `UNIQUE (tenant_id, player_id, dedupe_key)` and `UNIQUE (tenant_id, player_id, sequence)` | `bridge/src/store-sqlite.ts`, `bridge/src/store-postgres.ts`, property tests |
| A gap or a fork in a player's sequence after a crash | The sequence is decided in the same transaction as the row; a crash before `COMMIT` leaves nothing, after it the row is durable. The `kill -9` test kills one of three instances during 1 000 proposals | `tests/bridge-fanout.test.ts` |
| A signal accepted by A never reaches a stream held by B | The database is the source of truth for the fan-out (D20): B's streams read `listAfter(cursor)` when woken (Postgres `LISTEN/NOTIFY`, or a short poll on SQLite) and on their own timer, so a lost wake-up delays, never drops | `bridge/src/streams.ts` |
| A slow reader holds memory on an instance | A stream reads the database in pages and stops reading while its socket is full (64 KB); open streams are bounded per player (4) and per instance (`streamsPerInstance`, 429 beyond) | `bridge/src/streams.ts`, `bridge/src/server.ts` |
| A row that no longer verifies (an operator's manual edit, a restore from a damaged backup) blocks a player's stream | It is moved to `quarantine` with its reason and skipped; `bridge doctor` lists it; never delivered | `bridge/src/streams.ts`, `tests/bridge-ops.test.ts` |
| Spoofed client addresses through a proxy | `trust-proxy` takes an allowlist of proxy addresses or networks (D20): `X-Forwarded-For` is read only when the socket's peer is in it, and the client is the rightmost address not in it | `bridge/src/server.ts` |
| A tenant's export or deletion leaking or missing data | `bridge tenant export|delete` read and delete by `tenant_id` in every table, in one transaction for the deletion; a test fills two tenants and deletes one | `tests/bridge-tenancy.test.ts` |
| A backup restored over the wrong deployment | `bridge restore` refuses a non-empty target without `--force` and checks the schema version | `tests/bridge-ops.test.ts` |
| Metrics or traces carrying personal data | Metric attributes are `tenant` and an outcome code only; never a `playerId`, a token or a payload | `bridge/src/telemetry.ts` |

## What is not answered here

- A malicious **operator of the deployment**: holds every tenant's keys. Out of scope; the `local` profile is the answer.
- Per-tenant **database credentials** (row-level security in Postgres): not in 4.1.10; isolation is by query. Proposed
  for 4.1.12 with the first real distributed deployment.
- A global (cross-instance) rate limit per connector: the minute window stays per instance; with N instances a
  connector can propose N times its quota. The pending-per-player bound is global (it is read in the transaction).
