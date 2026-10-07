# 0018 · A variation manifest compiles to an immutable world (4.1.15)

**Context.** 4.1.15 "Remix" (programme §11, sheet `docs/dev/plans/4.1.15-remix.md`) lets one game produce several
games that are really different (an item in another place, a character starting elsewhere or walking another round,
a code and its hint drawn together, another order of puzzle groups, other lines of the same intent) without turning
its story into random content. Until 4.1.14 a game had one world. The engine had a seeded generator with streams
(`src/engine/core/prng.ts`, ADR 0016), a canonical text for hashing (`src/engine/core/canonical.ts`), an IR with a
reserved `variant` slot (`src/engine/core/ir.ts`, ADR 0013), a solver that runs the real engine (ADR 0003) and a save
envelope v3 (`src/engine/core/save.ts`). The runtime, the solver and the replay read a `GameDef`.

**Decision.** `GameIR + VariationManifest + seed + algorithmVersion → WorldVariant`, immutable, the same on Node,
Chromium, WebKit and Firefox, applied as plain data to the game before anything runs it.

1. **The manifest is data** (`GameDef.remix`, `src/engine/core/remix/manifest.ts`, a zod schema): modes (`story`,
   `remix`, `daily`, `mystery`…, each with its strategy, D25), dimensions with finite domains and a story value
   (`item-placement` over tagged anchors `RoomDef.anchors`, `actor-start`, `actor-route`, `coupled`, `puzzle-order`,
   `presentation`), constraints (`exclusive`, `requires`, `not-behind`), and the daily challenge's public key.
2. **Compiled before launch** (`src/engine/core/remix/compile.ts`, `compileManifest`): the domains, the anchors behind
   an action that needs their item removed, every impossible dependency collected into a `RemixManifestError` the
   validator reports at build time (`src/engine/tools/validate/remix.ts`), never in a player's game.
   `compileVariant` refuses a malformed seed, an unknown mode and an unknown algorithm version with a `RemixSeedError`;
   it never falls back to another world. A seed is `story` or a code `WS-XXXX-XXXX` (seven Crockford base32 symbols
   and a check symbol, `src/engine/core/remix/seed-code.ts`).
3. **Draws come from `core/prng.ts` only.** One stream per dimension (`<seed>|remix|<dimension>`), `logic` for the
   logical dimensions, `cosmetic` for presentation (D27), `copy-protection` for the code wheel; a catalogue mode draws
   one index in its enumerated list. Integers and rejection sampling, no modulo bias, no `Math`: `biome.json` forbids
   `Math` in `src/engine/core/remix/` (`noRestrictedGlobals`) and `Math.random` in `src/engine/core/` (a GritQL
   plugin, `tools/biome/no-math-random.grit`; the one exception is `prng.ts`'s `newSeed` without WebCrypto), and
   `tests/remix-compile.test.ts` both greps the sources and runs the path with `Math.random` throwing.
4. **The world is plain data** (`src/engine/core/remix/apply.ts`, `applyVariant`): a logical value away from its story
   value writes the reserved flag `remix.<dimension>` (a puzzle order `remix.<dimension>.<group>` = its position) in
   `start.flags`; an actor's start moves its character's `room`; a coupled pair fills `{code:<id>}` and `{hint:<id>}`
   in every text, after the translation; a presentation value replaces a line, an image, a palette or a minigame
   parameter; the code wheels take the world's seed. The author writes each branch with the conditions the DSL has
   (`{ flag: 'remix.key-spot', eq: 'market.oranges' }`): no new condition, no rule reordered, no text generated. The
   story world writes no flag, so a game played without Remix is its story world, as before.
5. **Hashed and stored, never regenerated.** `WorldVariant { seed, algorithm, algorithmVersion, manifestHash, mode,
   assignments, hash }`, `hash` the SHA-256 of its `canonicalJson` (`src/engine/core/remix/sha256.ts`, written out so a
   save can be written synchronously; tested against WebCrypto). The save envelope v4 (`SaveEnvelopeV4`), the session
   (`Session.variant`) and a speedrun package carry it; a load, a replay and a verifier rebuild the world from the
   stored assignment (`loadVariant`: its hash checked; against a moved manifest, each value must still exist), never
   from the seed with this engine's generator. A v3 save receives the story world (`upgradeEnvelope`).
6. **The IR names it.** `ir.variant` is filled with the instance (`{ mode: 'variant', id: hash, manifest, variant }`)
   when the game was compiled from one; `ir.world.remix` carries the manifest, `ir.rooms[].anchors` the anchors.

**What it costs.** Every branch is written by the author (a reserved flag read by a condition): the validator warns
when no condition reads a value, since that world would play like the story. The solver proves one world at a time:
`npm run verify:variants` runs it per logical instance (presentation left out), and a catalogue is capped at 10 000
instances. The player carries the compiler because a save is written with its world: 15 kB minified for `core/remix/`
(measured with esbuild on 7 Oct 2026; `zod/mini`, `canonical.ts` and `prng.ts` were already in the player). A world chosen in the menu reloads the page so that the engine is built from it.

**What would change it.** A manifest no catalogue can hold and no construction can prove, which would need the solver
to reason over the dimensions symbolically; a primitive condition `{ variant }` if reserved flags proved confusing in
practice (D28 freezes the DSL without it).
