### Changes

- **Objectives and the quest journal (4.1.12, ADR 0014).** A game may declare `objectives` (`title`, `done`,
  `optional`, `parent`). The pause menu lists them, each step under its parent, ✓ done or ○ open; the semantic journal
  says `objectiveCompleted` once, right after the event that completes it (even inside a cutscene, before what
  follows, the autosave and an ending), never again in the session, and silently for what already holds when a game
  starts or loads; `npm run solve -- --goal=100%` searches for a state where every objective that is not optional
  holds at once. The validator refuses an objective whose `done` can never hold (naming a custom command without
  declared `effects`), an unknown parent and a cycle of parents, and warns about a `done` the content can take back.
  The flag and item handlers now change the state before they journal it. The sample
  game and the reference chapter declare five each, translated into French. The save format does not change.
- **The game's intermediate representation (4.1.12, ADR 0013).** `compileIR` turns a compiled game into its logic as
  plain data (rooms, entities, rules, scripts, objectives, Reality policies, the world, the trusted extensions by name,
  a variant slot reserved for 4.1.15), deterministic, with the `file:line` that writes each id. `npm run ir -- --game
  <id> [--json]` prints it; the Studio's new **Language** tab shows it with the objectives; MCP's new `get_ir` returns
  it. Every field of a game, a room and an entity is classified logic, presentation, both or tooling in one table the
  compiler checks. The runtime, the solver and the replay keep reading the compiled game.
- **The game's fingerprint (4.1.12, ADR 0013).** Four SHA-256 computed with WebCrypto: `logic` (the IR),
  `trustedExtensions` (the game's code beside its content, hashed by the build), `presentation` (decors, sprites,
  sounds, interface texts and the asset manifest) and `engine` (its version). A rule changed moves `logic` only, a
  decor `presentation` only, a custom command's code `trustedExtensions` only. The pause menu shows the short form
  (`ui.fingerprint`, "Build" by default); a build writes `site.json` with the trusted extensions' hash and the
  engine's version, which `npm run verify:dist` expects.
- **One canonical text per value (4.1.12).** `canonicalJson` (NFC, sorted keys, no `-0`, big integers as decimal
  strings, anything lossy refused) is held to fifty edge values in Node, and `npm run e2e:canonical` compares them in
  Chromium, WebKit and Firefox. The solver's proof cache is keyed by it: the entries of earlier versions are not reused.
- **The Studio writes objectives (4.1.12).** Their form is generated from their schema (each field with its
  description); a value is checked before it is sent, and the validator's errors come back named by file, id and
  field; the diff is previewed before the write and Undo takes it back. MCP's `set_value` writes them in the game file
  with `id: "@game"`; `list_rooms` shows them.
- **The DSL's reference is generated (4.1.12, D22).** `docs/en/DSL.md` and `docs/fr/DSL.md` list every condition,
  every command with its shape, the objectives' fields and how each field counts for the IR, from the schemas
  (`npx tsx tools/dsl-doc.ts`, held by a test). The DSL is stabilised: `docs/dev/DSL-STABILITY.md` says what is
  stable, what may still grow until 4.1.15, and the candidate primitives of the programme with the proof that admitted
  or refused each (objectives admitted; no Reality nor stage primitive needed).
- **API (4.1.12), additive.** `web-scumm/content`: `compileIR`, `canonicalJson`, `provenanceOf`, `logicView`,
  `completionGoal`, `ObjectiveDef`, `GameIR` and the IR's types. `web-scumm/testing`: `fingerprint`,
  `fingerprintGame`, `presentationOf`, `hashSources`, `sha256Hex`, `shortFingerprint`, `GameFingerprint`. MCP: `get_ir`.
  `Engine.objectives`, `App.fingerprint()`, `App.objectivesMenu()`, `BootOptions.build` and two `ui` keys
  (`fingerprint`, `objectives`) are new members.
- **The first visit's JavaScript goes from 120 to 124 KB gzipped** (4.1.12): the fingerprint (WebCrypto), the
  objectives and the quest journal are in the player's main chunk; the budget (`initialJsKB` 140) is untouched and the
  baseline moved on purpose.
- **The validator's migration checks moved to `tools/validate/migrations.ts` (4.1.12)**, beside the objectives'
  checks: `validate.ts` goes from 1 140 to 1 113 lines, and its cap with it.
- **`e2e:pwa` on Firefox tolerates one file missing from the cache after a reinstall warm-up it reported complete**
  (4.1.12, CI only; the files are listed), under the same bound as the refused cached files (two): more is a failure.
  Chromium and WebKit stay strict.

### Breaking

- **The pause menu's fingerprint row in every game (4.1.12).** A game whose release language is not English shows its
  English default ("Build") until it adds `ui.fingerprint` (and `ui.objectives` when it declares objectives) to its
  `ui` and its translation tables; the release-language e2e (`npm run e2e -- --lang xx`) fails on a visible default.
  The sample game and the reference chapter carry both, in English and French (UPGRADING §23).
