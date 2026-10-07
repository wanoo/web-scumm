### Breaking

- **`SignalV2`, the signal that names its context** (4.1.10, ADR 0010). `WorldSignalV2` adds `tenantId`,
  `environment`, `audience` (the origin the player paired from), `sessionId` and `keyId` to the signed payload;
  `verifySignal` accepts the versions its expectation allows (both by default), refuses a V2 signed for another
  tenant, environment, origin or link (`audience-mismatch`) and a `keyId` that is not the header's `kid` (`key`). A
  multi-tenant Bridge signs V2 only; a single-tenant Bridge signs V1 by default until 4.1.12, when V2 becomes the only
  version (announced, `docs/en/UPGRADING.md` §22). A key bound to a tenant signs V2 only: a V1 signal under it is
  refused (`schema`); a V1 Bridge's keys bind no tenant. A V2 signal may name the Bridge's own audience when the
  Bridge did not see the player's origin (its keys declare it). The Studio's simulator signs V2 by default;
  `RealityClient` checks the page's origin by default and the shipped player passes the link's `sessionId`. The Rust cross-check verifies V2 with the same codes (`bridge/test-vectors/signal-v2/`).
- **The Bridge's methods are asynchronous** (4.1.10, ADR 0009): `startPairing`, `claimPairing`, `revoke`,
  `forgetPlayer`, `exportPlayer`, `ack`, `unlink`, `subscribe`, `streamAlive` and `playerOf` return promises; the
  routes `/v1/*` are unchanged. `--trust-proxy` alone trusts the loopback only (D20); the client is the rightmost
  `X-Forwarded-For` address that is not a listed proxy. Behind a proxy elsewhere than on the loopback (a PaaS's
  router), every client shares one rate bucket until `--trust-proxy=<its network>` names it.

### Changes

- **A durable, replicable, multi-tenant Bridge** (4.1.10 "Constellation", D20, `docs/dev/threat-models/constellation.md`).
  The Bridge reads and writes through `RealityStore`, every method taking the tenant first; `appendSignal` decides the
  deduplication, the sequence (`MAX + 1`), the quotas and the signature in one transaction. Stores: SQLite through
  `node:sqlite` (the `local` profile; Node 22.13+, no native dependency), Postgres through `pg` (the `distributed`
  profile, `experimental` until a real deployment), the 4.1.9 journal (still served; `npm run bridge -- migrate
  --from=jsonl --to=sqlite` moves it). The schema is versioned (`bridge/migrations/`, up and down). One server serves
  several tenants (`serve --tenants=…`, routed by `Host`), each with its own keys, root, quotas, rotation and
  revocations, and connector tokens bound to their tenant; instances are stateless (a stream on one instance receives
  what another accepted, woken by `NOTIFY` or a short poll). New: `/livez`, `/readyz`, `/healthz`; OpenTelemetry
  metrics when `@opentelemetry/api` is installed; `tenant export|delete`, `backup`, `restore`; quarantine of rows that
  no longer verify (or name another player, sequence or tenant than their row), listed by `doctor`;
  `streamsPerInstance`; a store busy beyond 5 s answers 503 with `Retry-After`; the SQLite files are mode 0600. Tested: the store contract on memory, SQLite and
  Postgres with fast-check properties (concurrent proposals, two tenants crossed), three processes with one killed
  during 1 000 proposals, backup and restore rehearsed. `npm run bridge:load` measures three instances, 1 000 players
  and 50 000 proposals (`docs/dev/BENCH-BRIDGE.md`; nightly on SQLite and Postgres); CI runs a `bridge-postgres` job.
