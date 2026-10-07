# 0010 · `SignalV2`: a signed signal names the context it was signed for

**Context.** A `WorldSignalV1` names its `gameId` and `playerId`. With several tenants on one deployment
(`docs/dev/threat-models/constellation.md`), two tenants may serve the same game, and an operator may (wrongly) share
an event key between them or list one raw key under two names: a signal signed for tenant A then verifies at tenant B,
and nothing in the signed bytes says it should not. The Biscuit `audience` protects the connector → Bridge hop only.

**Decision.** Retained. `WorldSignalV2` (`src/engine/reality/protocol.ts`, `schema: 2`) carries every V1 field plus
`tenantId`, `environment` (`prod`, `staging` or `dev`), `audience` (the origin the player paired from), `sessionId`
(the link) and `keyId` (equal to the JWS header's `kid`). `verifySignal` accepts the versions its expectation allows:

- a key of the keyring may say the `tenantId` and `environment` it signs for (`GET /v1/keys` sends them); a V2 signal
  whose context differs from its key's, or from what the player expects (`tenantId`, `environment`, its own origin,
  its `sessionId` when known) is refused `audience-mismatch`; a `keyId` other than the header's `kid` is refused `key`;
- a multi-tenant Bridge signs V2 only, lists its keys with their tenant, and a V1 signal under a key bound to a tenant
  is refused (`schema`), as by a player that asks for V2 only (`versions: [2]`); a V2 signal may name the Bridge's own
  audience instead of the player's origin (a pairing whose origin it did not see), which the key's `audience` admits;
- a single-tenant Bridge signs V1 by default during 4.1.10 and 4.1.11 (`--signal-version=2` opts in), so a player of
  4.1.1–4.1.9 keeps working; the player accepts both. From 4.1.12 the Bridge signs V2 only and the player accepts V2
  only: a break of the 4.1 incubation line (D18), announced in `docs/en/UPGRADING.md` §22.

The Rust cross-check (`bridge/xcheck/src/signal.rs`) verifies V2 with the same codes; its vectors are
`bridge/test-vectors/signal-v2/conformance.json`; `tests/reality-key-confusion.test.ts` replays tenant A's signal to
tenant B's player with the same raw key.

**Cost.** About 150 more bytes per signal; a verifier that knows more context; two versions to keep until 4.1.12.

**Would change it.** Per-tenant keys enforced by construction (a key derivation that includes the tenant, checked by
the player), which would make the binding implicit; not chosen, since the player cannot verify a derivation it does
not hold the root of.
