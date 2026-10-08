# 0019 · A run is bound to the world it was played in (4.1.16)

**Context.** 4.1.14 "Time Attack" made a run a chained proof (ADR 0016) judged by a verifier with trust levels (ADR
0017); 4.1.15 "Remix" made a game produce several worlds (ADR 0018). Each holds alone; together they do not. The
`.wsrun` envelope (schema 1, `src/engine/tools/speedrun/envelope.ts`) carries the run's PRNG seed only; the recorder
draws a fresh seed for any category that is not `fixed` (`recorder.ts`), so `daily` and `mystery` become `random`; the
verifier and the Bridge's worker replay the base game (`tools/speedrun/package.ts`); `worldVerdict` and
`leaderboardKey` (`src/engine/core/remix/categories.ts`) are called by their tests only; the Bridge ranks by a
`seedKind` that knows `fixed` and `random`. Two types say the seed policy: `SpeedrunCategory.seed`
(`core/types/speedrun.ts`, `fixed | random | mystery | daily` since 4.1.15: one field for the run and the world) and `SpeedrunSeedPolicy` (`core/remix/categories.ts`). The world reaches `h0` only through
`fingerprint.logic`, and only when a category lists it.

**Decision** (D29).

1. **One notion, one field.** `SpeedrunCategory.seed` is the run's generator (`fixed` | `random`). A new
   `SpeedrunCategory.world: SpeedrunWorldPolicy` (`policy`: `story` | `fixed` | `random` | `daily` | `mystery`;
   `mode`; `fixedSeed` for `fixed`; `codeWheel { enabled, skip, medium }`) is the world. `SpeedrunSeedPolicy` is merged
   into it; there is one type. Normalised when the game compiles: no `world` is Story; a 4.1.15 `seed: 'daily'` or
   `'mystery'` without `world` becomes `seed: 'random'` + that world, with a deprecation warning; the validator refuses
   what it cannot give a meaning to (`fixed` without `fixedSeed`, Daily without `game.remix.daily` and a public key,
   Story with a non-story variant).
2. **`.wsrun` schema 2** carries `runSeed`, the exact `variant: WorldVariant` (assignments included, never regenerated
   from a seed) and `worldEvidence` (a signed Daily token, or a signed Mystery commitment and a signed reveal). `h0`
   seals the fingerprint components, the category and its rules version, `runSeed`, the variant's full hash, the world
   policy, the canonical hash of the evidence and the PRNG, timing, envelope and Remix algorithm versions. Exports write
   schema 2 only.
3. **Schema 1 stays readable, as Story.** Its `seed` is the `runSeed`, its world the story world of the approved
   manifest. Presented for a Remix category it is `legacy-world-missing`, never requalified from its seed.
4. **One verifier.** Parse → versions and fingerprints → normalise schema 1 or 2 → compile the approved manifest →
   `loadVariant` on the stored world → `worldVerdict` with the authenticated evidence → `applyVariant` → recompute
   `h0` → replay with `runSeed` → compare → verdict and `leaderboardKey`. CLI, JSON, MCP, Studio and the Bridge's worker
   return the same `world { hash, mode, seed, leaderboardKey }` and the same codes (`world-*`, `daily-proof-*`,
   `mystery-*`, `legacy-world-missing`, `leaderboard-key`).
5. **The Bridge ranks by the verifier's key**, never rebuilt from a reduced kind. Integrity is not authenticity: a
   Mystery run without a server witness verifies locally and stays `valid-unranked` on a public board, said before the
   run starts.

**Consequences.** A run's identity is the world it was played in: two runs with the same inputs in two worlds have two
`h0`, two proofs, two board keys; substituting the variant alone fails before the replay. A recorder checkpoint keeps
the variant, the evidence, `runSeed` and `h0`; resuming in another world is refused. Saves v3/v4 and `.wsrun` schema 1
keep their meaning; the reference `.wsrun` of 4.1.14 and 4.1.15 stays verifiable. `docs/dev/DSL-STABILITY.md` and
`tests/api-surface.json` record `world` as the canonical form before the 4.2 freeze.

**Alternatives.** Deriving the world from `seed` and `game.remix` (no new field) keeps the DSL as frozen but gives one
field two meanings, the defect this fixes. Regenerating the world from its seed at verification ties a run to the
algorithm version and to a generator mode; storing the variant does not.
