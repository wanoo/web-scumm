# Changelog

## Unreleased

### Added

- `npm run solve -- --audit-abstractions` (`src/engine/tools/audit.ts`, in `release-check`): the proof with the
  abstractions, every no-op memo hit run anyway, against the explicit search with all of them off; any difference in
  the verdict, invariants, softlocks or what is reached fails (exit 1), an explicit search over budget is `partial`
  (exit 2). `tests/audit.test.ts`: the same audit on 120 seeded random games (`tests/gen/random-game.ts`) and on one
  game per command and per condition (checked against the types at compile time).
- `docs/dev/passes/`: one sheet per release for the checks automation cannot make (screen reader, Safari offline, a
  real phone, playtesters, voices, a signed tag); a release lists in its notes the ones not done (D12).

### Fixed

- The solver merged states that differ by a flag gating only an earlier rule, though that flag decides whether the
  earlier or a later rule answers the same action (first match wins): every path through the later rule could be lost,
  in every mode. The puzzle graph now links an earlier rule's condition to each later rule it can shadow. Found by the
  random games; the demo and the reference game keep the same state counts.
- With several playable characters, `roomsReached` missed the rooms where only an inactive character stood when the
  canonical character was on (the lint's `room-never-reached` could follow).

### Changed

- Truthful wording (Codex's review of 3.3.0): the partial-order reduction section of BENCH is marked historical, with
  a warning never to use it to certify the absence of softlocks, and `solve --prove --por=…` says it ignores the
  flag; the no-op memo is "an equivalence checked on the differential corpus", not a proof for every game; the
  40-room reference is "structured by eras" wherever it is quoted; accessibility is "tested at the keyboard, no
  serious axe violation", not a WCAG claim. The profile's header reads "what each one did, or why it is off".
- The README (en and fr) is a showcase: the promise, the v3.3 measurements with their limits, four player and four
  Studio images, a quick start that begins with `npm run doctor`, then links to the docs. The images come from the
  production bundle and the Studio through `npm run docs:screenshots` (`scripts/docs-screenshots.mjs`).

## 3.3.0 — 2026-10-05

### Added

- A golden save for 3.3.0 (`tests/fixtures/saves/demo-3.3.0.json`): it loads and reaches the ending on this engine.
- `npm run e2e:a11y` (a CI gate in Chromium and WebKit): axe-core on a conversation menu, the map, the save and load
  slots, the overwrite and restart confirmations and every bundled minigame; every bundled minigame won with key
  presses only in a real browser (a win is a minigame that ended without Skip: `App.minigameLog`, fed by a new
  `mg-skip` event); an older save upgraded by the real build (the v2 localStorage autosave and slot moved into
  IndexedDB, a 3.1.0 IndexedDB envelope migrated and resumed, then a manual save round trip). A checklist for the
  manual screen-reader pass before a release: `docs/dev/SCREEN-READER.md`.
- The persistent proof cache (`tools/proof-cache.ts`, `.cache/proofs/`): a solver run keyed by the engine's sources,
  the game's sources and content, and the options (defaults normalised) is given back when none changed, and the
  outputs say so (`cached` in `--json`). `npm run solve` (every mode), `--chapters` and `npm run lint` use it;
  `--no-cache` / `PROOF_CACHE=0` turn it off. Demo: warm proof 0.17 s (cold 2.4 s), chapters 1.1 s (cold 3.4 s).
- Weight budgets (`npm run weight`, `assetBudgets.initialKB / roomKB / chapterKB`): what a phone downloads before the
  first room is playable, per room and per chapter (every room reachable in it, from the proof by chapters), from the
  built files; over a budget fails, and `verify:release` requires the budgets. Demo: 2.0 MB initial, 2.4 MB at most
  per room, 3.7 MB per chapter, budgets 2.5 / 3 / 4.5 MB.
- Provenance tied to the files (`npm run provenance`, `provenance.lock.json`): `--lock` records each shipped file's
  SHA-256 and size with the claims of its entry after a review; `validate --release` fails on a file changed or
  shipped since, a missing file or an entry edited since, and on a licence outside the game's policy
  (`licences: { allow }` in `provenance.json`, required for a release; an asset outside it ships only if a
  `releaseExceptions` entry names it). The demo is locked (214 files, 4.6 MB); `new-game` writes a policy.
- The solver measures itself: `profile.timing` (tries, engine, clone, run, hash, queue, other, classify, in ms) and
  `profile.positions` (distinct character positions among the states); `npm run bench -- --matrix` prints the
  3.3 reference table (20 / 40 rooms × 1 / 2 / 3 characters).
- The no-op memo (`solve` option `memo`, on by default): a try that wrote nothing the solver hashes is not run again
  on a state with the same read values. The engine records what a run writes (`Engine.writes`); one skip in 16 is run
  anyway and compared (`memoVerify`). Demo proof 4.4 s → 2.2 s, proof by chapters 5.7 s → 3.3 s, identical results
  (`tests/memo.test.ts`).
- `npm run solve -- --profile` says what each abstraction did (canonical character, mobility regions, no-op memo) or
  why it is off (`profile.memo`, `abstractionLines`).
- Stable ids on list lines (`ListLine`: `string | { id, text }`): look lists (rooms and items), hint lines (and an
  `id` on a hint), fallback answers, and an `id` on a reaction by kind. Translations are keyed by the id
  (`look.pantry.<id>`, `hints.<id>.lines.<id>`, `rules/fallbacks.look.<id>`, `rules/kinds.<id>.say`), voices too
  (`audio.voices[<id>]`); `npm run ids -- --lines[=all]` writes them into `rooms/*.ts`, `items.ts`, `rules.ts` and
  `game.ts` and renames the locales; `validate --release` requires them in a translated or voiced game. The sample
  game is converted (109 ids, French still 400/400). UPGRADING §10.

### Fixed

- Two engine checks escaped the read trace (the lock on a used item, the hint's `until`): they now go through it.
- A chapter goal that reads the active character (`{ has }`, `{ room }`) could lose boundary states once states that
  differ only by the active character were merged: a canonical state now reaches a goal when any character, seen as
  active, meets it. Found by comparing chapter boundaries with the explicit search run from each start.

### Changed

- One status for every tool (`src/engine/tools/status.ts`): `SolveResult` and `ChaptersProof` carry `status`,
  `exit` and `headline`; `npm run solve` (text and `--json`), the Studio's Check tab and the `solve` MCP tool print
  those. A broken invariant is now the status `broken` (it was `solved` with exit 1), and the Studio no longer says
  "the game can be finished" over a truncated proof or one with softlocks. Witness chapters combine their statuses
  by severity, not by the largest exit code.
- The proof by chapters runs one search per chapter from all its boundary states at once (`start: { states }`),
  sharing its seen states: on the demo 5.7 s instead of 90–147 s, the same boundaries as the explicit search at every
  chapter. Mobility turns itself off, and says why, when no move of the game can be silent.
- Mobility regions (`mobility`, on in proof mode, `src/engine/tools/mobility.ts`): a character's exact room becomes
  the region of rooms it can walk between silently, actions of every room of the region are offered as
  `Go to <room> › action`, every hop is checked when played and a non-silent one restarts with exact rooms; witnesses
  replay. `makeStressGame({ eras: true, softlock? })` and `npm run bench -- --matrix --eras`: the reference game is
  proved at 40 rooms × 3 characters in 578 states and 4.2 s; same verdicts as the explicit search, softlock included
  (`tests/reference-proof.test.ts`, `tests/canonical.test.ts`).
- The canonical character (`canonicalPlayers`, on in proof mode): states that differ only by the active character
  are one, each state offers every character's actions when a switch changes nothing the solver reads; invariants
  are checked from every character's view; off when the goal reads `{ player }`. Same verdicts as the explicit search
  (`tests/canonical.test.ts`), the demo's proof 6 528 → 3 480 states; `profile.canonical` counts folded and explicit
  switches.
- The solver's frontier is a binary heap in the exact order of the sorted list it replaces, and states keep a parent
  pointer instead of a copied path and session: same witnesses, proofs and printed output, 8× faster on the 40-room
  3-character matrix case (the queue took 89% of the time).

## 3.2.2 — 2026-10-04

### Fixed

- `release-check` never ran `validate --release`: the provenance, placeholder and line-id checks of 3.2.1 could be
  skipped by the release workflow. `npm run verify:release` (validate `--release`, `i18n -- status`, strict playtests)
  is now a step of `release-check`, and `tests/release-gate.test.ts` breaks a clean fixture one defect at a time
  (no provenance, an unexcepted placeholder, a translation without line ids) through the CLI.
- A game translated into a single other language (only `fr.json`, no source file) skipped the line-id requirement:
  "translated" now means a locale other than `game.lang` (default `en`).
- Placeholder exceptions are per asset: `releaseExceptions: [{ match, reason }]` replaces the global
  `allowPlaceholders` of 3.2.1 (an old reason never covers a new placeholder); an asset two provenance entries match
  is an error instead of the first entry winning.
- Docs no longer describe a placeholder as a warning, line ids as required only with voices, or the sample game as
  keeping its plain lines.

## 3.2.1 — 2026-10-04

### Fixed

- `npm run solve -- --prove --chapters --json` exited 0 when a checkpoint matched no reachable state (only the text
  output failed): the proof now has one status, `checkpoint_mismatch`, and one exit code (`chaptersExitCode`) for the
  text output and `--json`, tested on a fixture game through the CLI.
- A placeholder asset no longer passes `validate --release` with a warning: it is an error unless `provenance.json`
  says why placeholders may ship (`allowPlaceholders`, set by the sample game for its non-commercial music).
- A translated or voiced release requires a stable id on every line, plain strings included (`validate --release`);
  `npm run ids -- --lines=all` now renames a converted line's translation to its `.say` path; the sample game's 45
  plain lines carry ids, its translations followed them.
- A text identical in two languages is untranslated unless `i18n.same` lists it: `npm run i18n -- status` fails on
  the others (the sample game lists its twelve: names, OK, ▲ ▼).
- CI runs on `v33-*` and `v34-*` branches; a measurement script committed by mistake (`probe40.mts`) is removed; a
  golden save of 3.2.0 joins 3.0.0 and 3.1.0.

## 3.2.0 — 2026-10-04

### Added

- The proof says how a game is lost: `softlockCount` (every reachable softlock state, not 20 samples) and
  `softlockCauses` (grouped by the step that lost the game); a proof from "New game" branches over the intro's
  choices. `npm run solve -- --prove --chapters` proves each chapter from every reachable boundary state of the
  previous one and reports a checkpoint no boundary state matches (with the dimensions that differ); one state budget
  covers the whole proof, past it `truncated`. Checkpoints take `used`, `seen` and `players[].used`. The demo's
  checkpoints were fixed to be reachable states. Measured honestly (BENCH.md): complete for a 40-room single-character
  chain, truncated with two or more playable characters, chapters or not.
- The differential suite (`tests/por.test.ts`) compares the reductions with the plain proof on eight fixtures,
  including a softlock that commutes with everything: stubborn sets agree, sleep sets invent softlocks on three; the
  reductions stay off in proof mode (`unsafeReduction` is for the suite only).
- Accessibility as a gate: the seven bundled minigames play to their end at the keyboard (keys(), operable(),
  arrowFocus() in `minigames/util.ts`; Skip no longer takes the focus a minigame gave one of its controls);
  `npm run e2e -- --axe` (axe-core on the title, a room, the pause menu, the ending) fails on any serious or critical
  violation, and found three fixed here: unnamed empty inventory slots, scene and confetti images without `alt`;
  the Chromium keyboard CI row (keyboard + axe + saves without IndexedDB) gates, a WebKit keyboard row runs.
- Asset provenance: `games/<id>/provenance.json` (source, licence, author, prompt, final or placeholder, by asset key
  with `*`); `npm run validate` checks coverage when the file exists, `--release` requires it and lists placeholders;
  `npm run new-game` records the borrowed sample art as placeholders; the demo's file covers its 194 images, its
  effects and its non-commercial music (the one placeholder).

- Saves say what they did: `clear()` / `clearSlot()` return `false` when the browser refuses (the save stays, the
  failure is reported, `whenIdle()` rejects); "Restart" and a refused file import keep the current game; golden
  saves for 3.0.0 and 3.1.0 load, migrate and reach the ending; refused writes and deletions are tested with a fake
  IndexedDB; `npm run e2e -- --save` proves a manual save survives a reload in a real browser, `--no-indexeddb` the
  localStorage fallback (both in CI).

- Line ids: `say`, `toast` and `guide` carry an optional stable `id`; translation paths follow it
  (`do.<line id>.say` instead of `do[3].say`), `audio.voices[<line id>]` plays without writing `voice` on the line,
  `npm run ids -- --lines` (or `--lines=all` for plain strings too) writes them and renames the locales from their
  current paths, `npm run validate -- --release` reports a line without one, `npm run i18n -- voices` is the voice
  production table. The sample game's 58 object lines carry ids. Duplicate line ids are an error.

- One table of the engine's English interface defaults (`src/engine/dom/ui-defaults.ts`, `App.t()`): the verb bar's
  ARIA label and every menu text come from the game's `ui` or from it; `App.uiFallbacks()` lists the keys a game
  leaves to the defaults, `npm run i18n -- status` prints them, and `npm run e2e -- --lang <xx>` fails when one is
  visible (the release-language check; a `chromium / fr` CI row, experimental first).
- Minigames declare `bindings` (params that name an image or a sound); `validate` checks them (`stroke`, `cables`,
  `scratch`); `scratch`'s `intro` is a translatable text param (its `text` is the sealed ending, given at run time).

### Fixed

- A game made by `npm run new-game` failed `verify:game` and `prove:game`: `solve --chapters` exited 1 when no
  checkpoint declares `goals` (now: nothing to prove by chapter, the global search covers the game), and the build's
  spoiler check crashed on a game without a sealed ending (now: only the private-file check applies). Caught by the
  new `second-game` CI job, which gates Pages: a new game passes check, verify, proof, build and the production e2e
  (axe, saves) with no test written for it.


## 3.1.1 — 2026-10-04

### Changed

- The `release` workflow runs on the `ci` workflow's success for a `v3.*` tag (`workflow_run`), never on the tag push
  alone: a release cannot publish while the check or a browser e2e row is pending or red. `release-check` adds the
  full `npm audit --audit-level=high` and the strict playtests. `ci` also runs on `v32-*` branches.
- A golden save: `tests/fixtures/saves/demo-3.1.0.json` (the demo's save eight inputs into the witness, with the
  remaining inputs) loads on the current engine and reaches the ending (ROADMAP verification 3, now a real test).
- DECISIONS: D5 and D7 are decided, D8 (the private reference game stays on 3.1.0, no longer a gate) and D9 (merge
  on green CI, Codex reviews afterwards) recorded; the charter's truth commands no longer name the private game.
### Added

- The offline warm-up tells the truth: `AssetBank.warm()` returns what it did (a bad HTTP status is a failure, a file
  already in the Cache API counts without a fetch), `App.offlineStatus` / `offlineReady` end `complete` only when every
  file of the plan is cached, else `partial` (reason: network, save-data, slow, quota from `navigator.storage.estimate()`),
  `skipped` or `off`; the pause menu shows it (`ui.offlineStatus`, `offlineComplete`, `offlineRetry`) and a tap retries;
  `npm run e2e:pwa` requires `complete`, checks every file of the plan offline and renders a never-visited room; WebKit's
  impossible offline navigation is "skipped" (exit 3), accepted only by the CI's `--allow-skip`.
### Security

- Studio assistant, custom providers: the private-host check reads `URL.hostname` as a host (IPv6 brackets, IPv4-mapped
  addresses), and refuses `0.0.0.0/8`, `::`, `fc00::/7`, `fe80::/10`, `100.64/10`, `.localhost`, `.internal` as well;
  a provider call never follows a redirect, times out after 60 s and reads at most 8 MB (`providerFetch`, `readCapped`).

### Fixed

- A sealed ending (`ending` / `reveal`) now sets `state.done` like `end` does: the card was shown with the game
  still "not done", which the new e2e check caught. The committed demo playtest's last digest is re-recorded
  accordingly (`done` is part of the state).
- The e2e scripts (generic and the demo's) fail when the solver's run is not `solved` (exit code, status and steps are
  checked) and when the engine does not report the ending (`state.done`); they never replay "the best path anyway".
- Playtests: the analysis started at the `start` entry and dropped the last action (24 entries, 23 played, read
  0..22); `replay()` now returns `first`, the analysis reads `first..first+played-1`, and the table counts inputs
  against the inputs, not the file's entries.
- `npm run lint`: a truncated proof exits 2, says so, and keeps its "never run" / "never reached" findings as
  information (`--json` carries `status` and `truncated`); reachability counts every action the solver attempted
  (`profile.attempted`), not only those that changed the state, so a topic that only talks is no longer "unreachable";
  new `rule-no-effect` info for a live action that ran without changing anything.
- `verify:game` runs the lint; `npm run playtests -- --strict` makes a diverged session an error, used by
  `release-check` and the weekly `prove` workflow.

## 3.1.0 — 2026-10-04

### Added

- CI: the sample game's exhaustive proof on every push, WebKit gating after its three green runs, a keyboard row; a
  weekly `prove` workflow (proof + bench on a 100-room schema-3 game, within a budget); a `release` workflow on
  `v3.*` tags (release checks, then the GitHub release from the changelog); Dependabot. `npm run bench -- --prove
  --v3` with the v3.1 numbers in BENCH.md; the `solve` MCP tool takes `prove`; `doctor` and `serve` are unit-tested.
- Playtests: the pause menu's "Share session" sends a session from a phone (ids only); `npm run playtests` replays the
  files of `games/<id>/playtests/` and sums them up (time per room, stalls, hints, where players stopped, a heat map);
  `verify:game` runs it, the Studio's Check tab shows it and can colour the puzzle graph by the players' sessions,
  the `playtests` MCP tool returns it. Session entries carry a timestamp when the game runs in a page.
- The whole game at the keyboard: verbs, scene targets, inventory, choices, the map, Space to advance a line, Escape
  to close or pause, focus kept inside menus; `npm run e2e -- --generic --keyboard` (`docs/en/ENGINE.md`,
  "Accessibility"); `ui.advance` names the continue marker.
- `npm run lint`, the `lint` MCP tool and a "Content lint" panel in the Studio's Check tab: from the puzzle graph,
  conditions nothing can satisfy, rules another rule hides, red herrings, stuck hints, dead options; after a solver
  run, live actions never run and rooms never reached. `GameDef.lint.ignore` keeps a finding on purpose.
- `bootGame` (`src/engine/boot.ts`): the page's bootstrap is part of the engine; `src/main.ts` only says what is
  specific to its build (`docs/en/UPGRADING.md` §8).
- `npm run ids`: stable ids (schema 3) written into a game's sources, its locale tables renamed to the id-based
  paths, and the `renameSeen` / `renameCounter` migration step generated for its v2 saves (`docs/en/UPGRADING.md` §2).

### Changed

- Manual save slots live in IndexedDB next to the autosave, as envelopes read back after each write; the v2
  localStorage slots are imported once; a file imported from the save menu also fills the first free slot.
- The whole game is cached for offline play after the first visit (`GameDef.offline`, default `full`; `'nearby'`
  keeps the v3.0.0 behaviour), in batches during idle time; `npm run e2e:pwa` opens a room never visited from the
  cache. Decision D5.
- The sample game is schema 3: every rule, topic, listener, choice and block has an id; its v1 saves migrate.
- Translation paths name rules, topics, choices and listeners by id when they have one (`room:house/on.<id>.do[1]`);
  v2 content keeps the positional paths. The puzzle graph, the solver and the Play tab name topics and listeners by
  the same ids as the engine (the solver's heatmap now colours v3 topics).
- The sample game's credits name the Swan Lake arrangement and its CC BY-NC 4.0 licence.

### Fixed

- Docs: the assistant key is in `sessionStorage` (STUDIO fr), a phone needs `dev:lan` (DESIGN), the branch model
  after v3.0.0 (ROADMAP, CHARTER, AGENTS), `page:world`, the README's releases table and repository map, the
  attribution URL in LICENSE-ASSETS, `read_doc` reads UPGRADING and CLASSICS, `docs/fr/MCP.md` is a full translation.
- The two-entry build Pages deploys (game + Studio demo) could not open offline: the chunks of the game's locales,
  its session export and the save envelope's schema went under `assets/tools/`, which the worker does not precache.
  The CI e2e job now builds that shape.
- `npm run e2e:pwa` on WebKit reports that offline navigation cannot be automated instead of failing on the
  resource errors of the aborted navigation.

## 3.0.0 — 2026-10-04

The first v3 release, co-developed by two assistants under `docs/dev/CHARTER.md`; the review trail is `docs/dev/LOG.md`.
v3 breaks v2 on purpose (decision D1): `docs/en/UPGRADING.md` is the list of what to do, and nothing in it is needed
to keep a v2 game running on this engine during the transition.

### Added

- `docs/en/UPGRADING.md` + `docs/fr/UPGRADING.md`, readable through the MCP `read_doc` tool.
- `npm run prove:game`: the exhaustive proof (global and per chapter) as an explicit release gate, run by
  `release-check`, never by `build`.
- `scripts/e2e/lib.mjs`: `E2E_CPU=<rate>` throttles Chromium like a shared runner; the harness prints the engine's
  state when a step fails.

### Changed

- Stable ids are named by one function (`src/engine/core/content-ids.ts`) shared by the engine, the solver and the
  puzzle graph.
- A save that names content that no longer exists is pruned with a visible toast (`ui.saveAdjusted`), not refused;
  only structural corruption, an unknown current room or an unknown active player reject it.
- The accessibility targets are keyboard-only: touch and mouse go through the room's hit-testing, which picks the
  smallest zone under the finger.
- The CI runs the production e2e in Chromium (gate) and WebKit (experimental until three green runs).
- Offline: the room and its neighbours are warmed; the README says what is cached offline. Whether a global preload
  returns is decision D5, pending.

### Fixed

- The map's place list could become untappable when anything refreshed the screen while the map waited (seen on
  every CI run, latent on slow phones).
- The e2e harness no longer waits 30 s for a minigame's Skip button that is fading after a win.

## 3.0.0-beta.1 — 2026-10-04

First public v3 preview. The save envelope and authoring template are v3; existing v2 games remain supported during the beta. This release is not the final v3 compatibility commitment.

### Added

- Exhaustive solver proof mode with softlock classification, explicit assumptions and stable exit codes.
- Schema-v3 compilation boundary and stable persistence IDs.
- Validated v3 save envelopes, verified IndexedDB autosaves and visible storage failures.
- Generic quality commands, production PWA/browser smoke tests and dependency/asset audit separation.
- Complete extraction of verb and built-in minigame text.
- LAN capability-token and same-origin protection for Studio write routes.
- Semantic scene hotspots, live announcements and keyboard focus handling.
- Room-scoped, connection-aware asset warming.

### Changed

- Development servers bind to loopback unless a `:lan` command is used.
- Assistant keys use session storage; custom provider URLs are disabled by default.
- Sample asset licensing now matches the actual generated effects and non-commercial music source.
- Normal builds require a winning witness; exhaustive softlock proof is an explicit `prove:game` release gate, so a
  large game's honest `truncated` proof cannot masquerade as failure to build its playable witness.
- Offline documentation now matches the bounded room-and-neighbor warming policy; unvisited rooms are not promised
  offline and are not downloaded wholesale on constrained devices.

### Fixed

- Truncated and unsuccessful solve runs no longer exit successfully.
- State-changing random branches and all nested dialogue choices are explored without a silent 32-variant cap.
- A multi-player demo branch that could consume another player’s required token.
