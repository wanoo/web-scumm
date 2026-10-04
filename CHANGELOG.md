# Changelog

## 3.1.1 — 2026-10-04
## 3.2.0 — unreleased

### Added

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

## 3.1.1 — unreleased

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
