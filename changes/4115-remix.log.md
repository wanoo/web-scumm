## `feature/4115-remix`: VariationManifest, WorldVariant, saves v4, the daily challenge, the code wheel, the Studio's Remix tab, the DSL frozen (4.1.15 "Remix", one pull request)

- Delivered, in the sheet's order (`docs/dev/plans/4.1.15-remix.md`), each part with its tests: (1) ADR 0018, D25–D28,
  `docs/dev/threat-models/remix-seed.md`, the ADR index; `Math` forbidden in `src/engine/core/remix/`
  (`noRestrictedGlobals`) and `Math.random` in `src/engine/core/` (a Biome GritQL plugin, `tools/biome/`), plus a test
  that greps and one that runs the path with `Math.random` throwing; (2) `core/remix/manifest.ts` (zod/mini),
  `compile.ts` (`compileManifest`, `compileVariant`, `catalogue`, `loadVariant`), `seed-code.ts` (`WS-XXXX-XXXX`),
  `sha256.ts` (synchronous, tested against WebCrypto), `ir.variant` filled, `ir.world.remix`; (3) `RoomDef.anchors`,
  the validator's Remix checks, the demo's pantry key among three anchors; (4) the reference's seller (start room,
  round); (5) the coupled festival password with Grandma's riddle, en + fr, the desync property over the catalogue;
  (6) the reference's festival order, rules never reordered (test), `puzzleGraph` per world; (7) presentation targets
  (line, prop image, palette, minigame parameter), the `cosmetic` stream; (8) `npm run remix`, `npm run
  verify:variants` (in `verify:game`), certificates under `.cache/proofs/variants/`; (9) `SaveEnvelopeV4`,
  `upgradeEnvelope`, `SaveWorldMismatch`, `Session.variant`, replay rebuilds the world, 4.1.9's golden save added;
  (10) `core/remix/categories.ts` (Story, Fixed, Random, Mystery, Daily), `SpeedrunCategory.seed` with `mystery` and `daily` after merging 4.1.14; (11)
  `bridge/src/daily.ts` (new module, not mounted) and `reality/daily.ts`; (12) the title's Remix menu, the pause menu's
  world row, `?seed=`/`?daily=`/`?world=`; (13) the Studio's Remix tab (`remix-model.ts` 173 lines, `remix-tab.ts`
  258); (14)–(16) the `code-wheel` minigame and its core, `npm run code-wheel` (SVG, PDF with Pillow), accessibility;
  (17) the reference's Story + Remix + daily (published test key) + wheel; (18) `scripts/e2e-remix.mjs`; (19) twenty
  playtest seeds (`games/reference/playtests/remix-*.session.json`, `npm run remix -- --record=20`); (20) DSL-STABILITY
  frozen, the API surface and its tables, UPGRADING §27, TOOLS, REMIX en/fr, the release step publishing the proved
  catalogues.
- Decided. D25 per mode: `demo` `story` and `remix` are catalogues (1 and 3 logical worlds); `reference` `story`,
  `remix`, `daily`, `mystery` are catalogues (1, 24, 24, 24, the last three the same 24 worlds); no bundled generator
  (the generator path is the test fixture's, 527 280 worlds, 10 000 seeds checked valid by property, none claimed
  proved). A world is data applied to the game (reserved flags `remix.*` read with `{ flag, eq }`), not a new
  condition: the runtime, the solver and the replay are unchanged; the story world writes no flag. Seed codes check
  with Σ(2i+1)·symbol mod 32 in their own alphabet (Crockford's `*~$=U` refused: they break URLs and file names). A
  code wheel needs an odd number of actors (both "windows apart" and "answers apart" exist only for odd n). The
  reference's password and wheel are optional, not objectives (the quest journal keeps three to five): every world
  must reach what they set (`remixGoals`).
- Measured (local, 7 Oct 2026, this worktree): `npm run verify:variants -- --prove --max=200000`: demo 1 + 3 worlds,
  reference 1 + 24 worlds, all proved, no softlock, about 2 min 30 s for both games; `npm run playtests -- --strict` on reference: 20
  sessions replayed in their worlds, none diverged. `core/remix/` 15 kB minified (esbuild). New test files 7, 69
  tests: remix-compile 20, remix-worlds 13, remix-saves 7, remix-daily 5, code-wheel 11, dom/remix-menu 6,
  dom/studio-remix 7.
- Not done. `npm run e2e:remix` written, not run here (the four runtimes); the five human playtest seeds (D12); the
  daily module is not mounted on the Bridge's HTTP server (`bridge/src/server.ts` is the Time Attack branch's to
  touch) nor written against a `RealityStore`; a code wheel's record is dispatched as a DOM event, not yet stored in
  the session or the speedrun journal; `story` mode of the wheel ends like `parody` (a minigame has no outcome
  channel to trigger a narrative event); the `e2e:a11y` pass over the wheel; the 4.2 baseline (`tests/quality-baseline.json`)
  not regenerated (`npm run quality:baseline` not run on this machine); 4.1.14 merged (`SpeedrunCategory.seed` accepts
  `mystery` and `daily`, its validator checks them, the reference run re-recorded), but the `.wsrun` envelope carries no
  `variant` yet (`src/engine/tools/speedrun/` is the Time Attack branch's): a verifier must be handed
  `applyVariant(game, variant)`, and `tests/remix-saves.test.ts` proves the replay half with a package of that shape.
- After the second reading (Opus, security; 12 findings, all applied): (1, blocking) `dom/remix-boot.ts`: the page
  starts in the autosave's world, a link to another world is a question on the title, the Remix menu asks before
  erasing, both stores keep a foreign save until `clear()` (DOM test `tests/dom/remix-boot.test.ts`, 5 tests); (2)
  `loadVariant` parses `WorldVariantSchema` and checks mode, domains, completeness and constraints always, ADR 0018
  says integrity ≠ authenticity; (3) `construct` backtracks (test A∈{x,y}, C∈{x}); (4) Mystery shopping bounded, not
  prevented: 3 commits per client, game and hour, the first reveal's time recorded, `MYSTERY_START_WINDOW_MS` = 60 s in
  `worldVerdict`; the residual risk recorded in the threat model; (5) `minigame:<rule>:<param>` only for the built-in
  minigames' texts and backdrops; (6) the runtime claims say "Node-tested, cross-runtime check written, not run"; (7)
  the minigames draw from `MinigameCtx.random`, the GritQL rule covers `minigames/` and aliases; (8) `newSeed` throws
  without WebCrypto (`core/prng.ts`, one function, asked by the reading); (9) a stored world of another algorithm
  version is applied as stored when it passes the checks (decided, ADR 0018); (10) a malformed link is said on the
  title; (11) `npm run code-wheel` takes a game id only; (12) non-ASCII seed codes refused.
- After PR #50's CI run (37635494627): the save envelope's story world no longer pulls the compiler into the first
  chunk (`core/remix/story.ts`, equal to `storyVariant`, tested); `dom/remix-menu.ts` imports the Reality code only
  for a daily challenge (the demo, without `reality`, does not precache that chunk: the offline PWA boot and
  `e2e:weight` failed on it). Measured with `npx vite build` + `npx tsx tools/dist.ts`: demo 132 KB, reference 136 KB
  (budget 140); the "1 thing the provenance does not account for" was that budget line. `core/save.ts` back to 100 %
  of its branches (`tests/save-world.test.ts`, measured with vitest coverage on the five save test files). Not run:
  the full `test:coverage` and `coverage-ratchet` (one-file-at-a-time rule of this machine), the e2e.
- After the rerun on 18647c4: `pwa-firefox` passed every scenario then reported "error loading dynamically imported
  module …/virtual_pwa-register-*.js". `src/main.ts` now imports the register module statically (it was its own lazy
  chunk; it was in the precache, `dist/sw.js`), so that chunk no longer exists; first visit unchanged (demo 132 KB,
  reference 137 KB). The cause in Firefox was not reproduced here (no e2e on this machine).
→ next: Claude · `release/4.1.15`
