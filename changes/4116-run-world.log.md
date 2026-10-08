## `feature/4116-run-world`: a run bound to its world, `.wsrun` schema 2, one verifier for every world, `canonicalJson` in Firefox (4.1.16 PR 2)

- Delivered, red test first (`tests/speedrun-remix.test.ts`: a run in the demo's oranges world, refused by 4.1.15's
  verifier, valid now): `SpeedrunWorldPolicy` and `SpeedrunCategory.world`, `categoryWorld` and `runSeedPolicy`
  (`core/remix/categories.ts`, `RemixCategoryRules` kept as 4.1.15's form, `worldVerdict` and `leaderboardKey` take
  both); `RemixSeedError.code` (`world-shape`, `world-hash`, `world-value`, `world-constraint`); `SpeedrunEnvelopeV2`
  and `headHash` sealing the world; the recorder's world (`variant`, `worldEvidence`, `RunStartRefused`, checkpoint
  with the world and `runSeed`, resume refused in another world); the verifier's world step before `h0` and the replay
  on `applyVariant(approved, variant)`, the Daily token checked without its window (a run verified the next day), the
  Mystery commitment and the signed reveal (`verifyReveal`, `bridge/src/daily.ts` signs it); `SpeedrunVerifyResult.world`
  in the CLI's output, the JSON, the MCP tool and the worker; the validator's world checks; the Bridge's run key with
  the world; `canonicalJson`'s `nfc` (lone halves kept). The reference run re-recorded in its story world (schema 2,
  proof `75d97ffd…`, same IGT 2:35.234); 4.1.15's schema 1 file kept as `reference-any.v1.wsrun`, verified as Story and
  refused for a Remix category. Tests: `speedrun-remix` (8), `speedrun-daily` (4, the reference game, the published
  test key, the real Bridge module), the resume, the reference, two canonical values.
- Decided: the envelope's fingerprint is the game as written (the player's `source`), the world travels beside it;
  a schema 2 Story run replays `applyVariant(game, storyWorld)`, a schema 1 run the game as 4.1.14 did (its proof
  unchanged); a Mystery run without a server witness is `valid-unranked` (`mystery-unwitnessed`); `seedKind` stays on
  the worker's answer until PR 3 moves the Bridge to `leaderboardKey`.
- Measured (local): `e2e:canonical` 52 values the same in Node, Chromium, WebKit, Firefox.
- Not done here: the player's Daily and Mystery flows handing their tokens to the recorder, the Bridge's leaderboard
  by key (PR 3); docs beyond SPEEDRUN, DSL-STABILITY and API (PR 5).
→ next: Claude · `feature/4116-bridge-runs` (4.1.16 PR 3)
