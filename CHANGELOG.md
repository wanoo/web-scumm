# Changelog

## Unreleased

- Codex's plans after 4.0 in `docs/dev/` (D14): "Clarity" ships as 4.1.0, "Reality Bridge" as 4.1.1, 4.2 will be
  the final version. CI runs on `docs/…`, `test/…` and `refactor/…` branches too.
- `npm run quality:baseline -- --check [--dist]` (`tools/quality-baseline.ts`): the behaviour of 4.0.0 frozen in
  `tests/quality-baseline.json` before any refactoring. For the demo, the reference game and 13 solver fixtures: the
  witness (status, length, a hash of the digest after every input) and the proof (status, states, softlocks); the 13
  golden saves played to their end; the hash of the public API and MCP surface; the number of test declarations (may
  only grow); the first visit's JavaScript (may only shrink). Each difference is named. In the CI `check` job.
- **Biome** formats and lints the engine, the tools, the tests and the scripts (`biome.json`; a game's content in
  `games/` is linted, never reformatted, since the Studio writes it). The formatting is one mechanical commit, listed in
  `.git-blame-ignore-revs`. New scripts: `npm run format`, `format:check`, `lint:code`, `lint:content` (the content lint;
  `npm run lint` stays its alias through 4.x) and `quality` (all of them plus both TypeScript configurations), in CI.
- TypeScript: `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch` hold everywhere;
  `tsconfig.strictest.json` adds `noUncheckedIndexedAccess` on `src/engine` and `src/studio` (tests and `tools/`
  outside it). An index the code knows is there reads through `must()` (`src/engine/core/must.ts`), which throws with
  what was missing instead of carrying `undefined` on.
- The Canvas painter (`dom/render-canvas.ts`) is loaded the first time a room asks for it: a game that paints with
  the DOM no longer downloads it. The demo's first visit: 122 → 120 KB of JavaScript gzipped, the index guards above
  included (+0.5 KB). It stays in the offline precache.

## 4.0.0 — 2026-10-05

"Stable Platform" (LOG #94): fewer new things, more promises. Nothing in the content format or the save format
changes: a 3.x game on schema 3 moves without a rewrite (`docs/en/UPGRADING.md` § 10), and every save of the 3.x line
loads. What changes is what is kept: the public API (`docs/en/API.md`) follows semantic versioning and the
deprecation policy of `docs/en/SUPPORT.md`. Human passes: 0 of 7 (D12, `docs/dev/passes/4.0.0.md`).

### API

- Stable from this release: `web-scumm/content`, `web-scumm/player`, `web-scumm/minigames`, `web-scumm/testing`, the
  authoring schema 3, the save envelope (schema 3), the Studio/MCP tools' arguments and the `web-scumm` command. Any
  other path into `src/engine` is internal.

### Added

- `npm run upgrade-check -- --from=<version | previous>`, a CI job: a game created with the previous release's
  package, a save made by that engine, then this engine installed, `migrate --check`, `verify`, `build`, and the old
  save loaded and played to the end.
- The independent game, "The Lighthouse", moved from 3.9.0 to 4.0.0 by installing the new tarball: nothing to
  migrate, `release --commercial` green, its 3.9.0 save loaded and played to the end (LOG #94).

### Added (asked for 4.0)

- **A double tap acts with the verb a player means** (`core/default-verb.ts`): through an exit, talk to a character,
  look at anything else; a single tap still only walks. A prop, a hotspot, an actor or an exit can name its own with
  `defaultVerb` (a cupboard: `open`). An item picked from the bag without a verb is **given** to a character and
  **used** on anything else, and the sentence line says which before the tap. Checked in Chromium and WebKit
  (`npm run e2e:taps`, in the reference job).

### Dependencies

- The open Dependabot pull requests are settled: taken, earcut 3.2.4 and the GitHub Actions majors (`setup-node` 7,
  `setup-python` 7, `upload-artifact` 7, `upload-pages-artifact` 5, `deploy-pages` 5); not taken, Vite 8 (its new
  bundler breaks a CommonJS default import: the game does not start) and TypeScript 7 (it drops `baseUrl` and
  non-relative `paths`): toolchain migrations for a minor of their own; nor the raised minimums of Pillow, NumPy and
  SciPy (a minimum is what the tools need, not the latest: NumPy 2.5 breaks other packages of a shared Python).

### Migration

- From 3.x: import from the four public entries instead of `@engine/*` (which keeps working, without the promise);
  use `EndingDef` instead of `RevealDef`; `npx web-scumm migrate --check` says whether anything else is due.

## 3.9.0 — 2026-10-05

"Independence" (LOG #93): a game no longer has to live in this repository. The engine is a package, a game made from
its packed template outside the repository is verified, built and played to its end in CI, and an independent game,
"The Lighthouse", passes the commercial release gate on the packed engine.

### Added

- The engine as a package (`docs/en/PACKAGE.md`): `npm run pack` makes `web-scumm` (the engine, its pages, its tools,
  the template, the `web-scumm` command) and `create-web-scumm`. `npx create-web-scumm my-game` makes a project with
  `game/`, `public/`, a `package.json` calling `web-scumm dev|studio|assets|verify|build|release`, and a `tsconfig.json`
  pointing into the package; the tools run on the project (`WEB_SCUMM_PROJECT`) and never write into the package.
  Releases attach both tarballs, attested and summed.
- `npm run fresh-install`, a CI job: packs, creates a game in an empty folder outside the repository, installs the
  tarball, runs `assets`, `verify` and `build`, and plays the game to its end in Chromium. A file of the project that
  names the repository fails it.
- The template has its own placeholder art, drawn from shapes (`tools/placeholder-art.py`): a new game no longer
  borrows the sample game's. `web-scumm migrate [--check]` brings a game to the current authoring schema (3), and
  `web-scumm ids` gives it its stable ids.
- The public API, as a preview of 4.0's contract (`docs/en/API.md`): `web-scumm/content`, `web-scumm/player`,
  `web-scumm/minigames`, `web-scumm/testing` (`src/engine/api/`, the package's `exports`). `tests/api-surface.json`
  holds their names and the Studio/MCP tools' arguments; `tests/api-surface.test.ts` fails on a change `API.md` does
  not document. The template imports from them only. `docs/en/SUPPORT.md` says what 4.0 will promise.

### Fixed

- `verify:commercial` found the files a source names only under `games/`, `tools/`, `src/`, `public/`: a game in its
  own project (`art-src/draw.py`) failed it. Any relative path counts now, resolved in the project; a URL never does.

### Deprecated

- `RevealDef`: use `EndingDef`; removed in 5.0.

## 3.8.0 — 2026-10-05

"Human Proof", the machine part (LOG #92): everything the field passes need is ready, and what a browser can check
is checked in Safari's engine too. The seven passes themselves are people's and devices' (D12, `docs/en/FIELD.md`):
0 of 7 done for this release.

### Added

- The reference chapter's two-score scenario (a plan on the phrase, the bridge, a save restored before the landing, a
  stop while a transition waits, the decoded peak under `transitionPeakMB`) runs in WebKit as well as Chromium, in CI
  (`npm run e2e:music -- --only=reference --browser=webkit`).
- `docs/{en,fr}/FIELD.md`: the seven field passes (screen reader, Safari offline, a real phone, playtesters, recorded
  voices, listening, signed tag), how to make each and what to bring back; the passes template has the listening row.
- Near misses in playtests: a tap on nothing within 24 px of a target counts for that room and target; the shared
  session carries the counts (ids only) and `npm run playtests` lists them.
- `?fps`: a frame counter (now and the lowest second) for the real-phone pass.

## 3.7.1 — 2026-10-05

"Artifact Truth": what is tested, what is declared and what is shipped are the same files (the review of 3.7.0, LOG
#91). `inventory(dist) = code + locked assets + named data + fonts + icons + licences`, checked on every build.

### Fixed

- The archive held what Vite copies from `public/`, shared by the games: the sample game's shipped the reference
  chapter's score and bridges, files its provenance lock never named. Every build now ends with `tools/dist.ts seal`:
  the files that are not the game's are removed and `dist/licenses/` is written (the engine's `LICENSE`,
  `LICENSE-ASSETS`, `CREDITS.md` from the provenance, `THIRD_PARTY_NOTICES.txt` with the licence of every bundled
  package and the fonts' OFL, `assets-manifest.json`). `npm run verify:dist`, a step of `build` and of
  `verify:commercial`, refuses any file of `dist/` that is not code, a locked asset with its reviewed bytes, a data
  file the game names, a font, an icon or a notice.
- A stinger that does not fit in the decoded audio beside the playing score is no longer played over the cap: the
  director lets it go (`stinger()` returns null, `lastStinger.skipped`) and it is streamed instead. The cap holds after
  every operation, which `tests/director.test.ts` now checks after every lifecycle case.
- `playtests --strict` passed with no session at all. It still only refuses a diverged session, and says when it
  checked none; the field quotas are new options (below).
- The release workflow builds the commit CI tested (`workflow_run.head_sha`), checks that the tag still points there,
  takes any SemVer tag (not only `v3.*`), and refuses a release that already has files (no `--clobber`): a published
  release is never replaced. The archive's assets manifest is attached beside it.
- CI runs on `feature/**`, `fix/**` and `release/**` branches, whatever the version (it stopped at `v37-*`).
- The nightly's shards split any total exactly (501 seeds ran 504) and the merge fails on a gap or an overlap
  (`audit:corpus --shard=i/n --total=N`, `--merge … --total=N`). The four-shard nightly ran on `main` (501 seeds of
  each kind: 910 compared, 593 partial, no divergence).
- The README's "Releases" section named v3.5 two releases later; `tests/readme-release.test.ts` now holds it to
  `package.json`'s version. Python bytecode (`__pycache__/`, `*.pyc`) is no longer tracked.

### Added

- Field quotas for playtests: `--require=N`, `--require-completed=N`, `--require-devices=N` (a diverged session counts
  for none), and `npm run verify:field` (`verify:commercial`, then 5 sessions, 3 played to the end, 2 device families;
  not a release gate, D12). A shared session says its device family (`ios`, `android`, `desktop`), nothing finer.

### Changed

- The player's first visit runs 122 KB of gzipped JavaScript (153 before): the save envelope's schemas use
  `zod/mini` (same checks, tree-shaken), and each built-in minigame loads when one starts
  (`src/engine/minigames/meta.ts` keeps what the tools read). New budget `assetBudgets.initialJsKB`, checked on the
  build by `npm run verify:dist`. The engine's layers are written down (`src/engine/BOUNDARIES.md`) and checked by
  `tests/boundaries.test.ts`: the core imports no DOM or tool, the player never the solver, the validator or the Studio.

## 3.7.0 — 2026-10-05

"Field Proof", the machine part (LOG #88–#90): what can be proved without a person. The human passes are still to
do (D12, `docs/dev/passes/3.7.0.md`).

### Changed

- The sample game's theme is written for the project: Tchaikovsky's *Swan Lake* oboe theme (public domain) set down
  note by note with its own harmony, harp, strings and bass (`games/demo/audio/projects/swan-theme/compose.py`),
  rendered by `npm run audio` with the same four stems. It replaces an arrangement of a CC BY-NC transcription: the
  sample game and the reference chapter have no release exception left and pass `npm run verify:commercial`. The
  theme is 54 s (66 s before): 79 MB decoded, 2.5 MB of stems.
- The nightly corpus runs in four shards, one job each, then a job adds them up (`audit:corpus --merge`).

### Added

- The reference chapter's market has a score of its own ("Night Market", D major, 96 BPM, stems melody, chords and
  bass) and two bridges: the theme hands over on its next phrase, the market hands back on its "home" marker.
  `transitionPeakMB` 150 (128 measured).
- `npm run e2e:music -- <url> --only=reference`, in CI on the reference build: the handover through the bridge, a save
  loaded before the way back lands, a stop while a transition waits, the decoded audio under the budget.

## 3.6.1 — 2026-10-05

"Audio truth": the 3.6.0 review's fixes (LOG #86–#87). The music now has three intents, `play`, `restore` and `stop`,
and the director owns everything it schedules.

### Fixed

- Loading a save while its own score played kept the current position: the saved phase was dropped when the track was
  already the current one. Loading is now a restore: the saved track starts at its point, even when it is playing.
- Loading a save with another score went through the story's transition (a marker, a bridge). A restore cuts.
- A stop, a restore or a new request during a scheduled transition left the old score and the bridge playing: the
  director only knew the new score. A transition is now a plan it cancels; the old score is stopped by a timer, not a
  stop scheduled up front.
- A score that fell back to its single mix started it from the top: the phase was cleared before the attempt. It is
  kept until something plays.
- A voice during a transition cancelled the new score's fade-in, and a bridge was not ducked. Voices duck one bus
  under everything the director plays.
- The bridge was not counted against `maxDecodedMB`, and stingers were never evicted. A bridge that does not fit is
  dropped, two scores that do not fit become a cut, stingers evict like scores.

### Added

- `assetBudgets.transitionPeakMB`: the worst transition's two scores and bridge plus the largest stinger decoded,
  bridges and stingers measured with ffprobe; required by a release with transitions.
- `validate` refuses a transition rule an earlier one covers, and a marker from `'*'` that a score it can leave lacks;
  it warns when a transition is over `maxDecodedMB`.
- The nightly corpus writes its counts (tried, compared, partial, diverged) as an artifact and on the run's page.

### Changed

- README: the 3.6 screenshots and numbers; corpus figures read "900 tried, 549 compared".

## 3.6.0 — 2026-10-05

"Production": the rest of the 3.5.0 review (LOG #80–#85). A save now keeps the music's phase (`state.music`, optional:
the 3.5 saves load as they are). The open matrix of 20 rooms × 3 characters stays truncated (600 000 states): the
target is missed again, as allowed (BENCH.md "3.6").

### Fixed

- The solver leaked about 15 MB a search. Each action raced a zero-delay timer that was never cleared, and a search runs
  in microtasks, so the timers waited for the process to go idle. A corpus of audits ran out of memory. Measured after
  60 audits: 918 MB before, 9 MB after.
- The abstraction audit compared reached flags that the search does not track: those that cannot matter to the goal,
  every flag in an unsolvable game. It reported three false divergences on 900 games. It now compares the live flags
  (`SolveResult.liveFlags`).

### Added

- Weight budgets for what the playable ones leave out (3.6): `backgroundScoreKB` (the scores' stems, downloaded where
  the director plays them), `offlineTotalKB` (the full warm-up, app shell included), `decodedAudioMB` (the largest
  score decoded, from `pcmBytes`). A release requires them; the demo and the reference set them (3.0 MB, 7.6 MB, 97 MB
  measured).
- `validate --release` measures each score's stem files with ffprobe (3.6): the same rate, channels and exact number
  of samples, the loop ending inside them, `pcmBytes` within 1% of what they decode to. Hand-made stems that would
  drift apart no longer pass a release (`src/engine/tools/stems.ts`, `tests/stems.test.ts`).
- The music director's decoded audio is capped (3.6): `audio.maxDecodedMB` (default 160), the scores least recently
  played let go first. A score larger than the cap plays as its single mix, alone (the others keep their stems), and
  is not even downloaded when its `pcmBytes` says so. Before, every decoded stem stayed until the game closed.
- Transitions between scores (3.6): `audio.transitions` rules (`from`, `to`, `at`: beat, bar, phrase or a marker of
  the old score, `bridge`, `fadeBeats`), `ScoreDef.markers` and `phraseBars`. The new score starts on the old one's
  grid, after the bridge; `npm run e2e:music` measures both to the sample in Chromium. Without a rule, as in 3.5.
- The canonical owner pools by group (3.6): the characters who can meet, every two of them, share a pool of the free
  items they hold, and the others keep their own. In 3.5 the pool applied only when all of them could meet, which with
  three characters was seldom. Open chain, 3 characters: 8 rooms 29 909 → 12 613 states, 10 rooms 64 957 → 14 528,
  12 and 14 rooms proved (66 189 and 93 480) where 3.5 stopped at 120 000.
- `npm run audit:corpus` and a nightly workflow: the abstractions against the explicit search on 500 random games of
  each kind (plain, free items, three characters). The random game generator makes three characters.
- A save keeps the music's phase (`state.music`: the track and the position in its file, written by the app, ignored
  by the engine and the tools); loading it resumes the music there (the director's `offset`, the mix's `seek`).

## 3.5.1 — 2026-10-05

"Cue": the fixes found by the review of 3.5.0 (LOG #75–#78). No change to the game state: the 3.5.0 saves load as
they are.

### Fixed

- The music director plays only the latest request: a score whose stems finished decoding after another score was
  asked for replaced it, and a stop while a score loaded did not cancel it (found by the review of 3.5.0; a request
  generation, `tests/director.test.ts`).
- The weight test no longer reads the `dist` an earlier build left: it weighs the game's assets with an empty
  `DIST_DIR`, and CI weighs the app shell of a fresh build (`npm run weight -- --release` after `npm run build`).
- A proof worker that stopped mid-search stayed in the pool: `stats()` asked it with no timeout and could wait for
  ever. It now leaves the pool for good, its node going to the others (or to this thread when none is left), and
  `stats()` asks only the live ones, 2 s at most each (tests: one of four stops, then all, by exit or by an error).
- A browser that does not tell its memory (Safari, iOS included) was taken for an 8 GB device and got the stems. It
  now gets them only when the scores' decoded weight is known and at most 128 MB (`ScoreDef.pcmBytes`, written by
  `npm run audio -- stems`; the demo's theme is 101 MB); otherwise the single mix. `validate` warns about a score
  without it.
- `bench --workers-table` reports the peak RSS: 4 workers take 1.2 GB where one search takes 0.5 GB (BENCH.md "3.5.1").

## 3.5.0 — 2026-10-05

"Score": music, workers, inventories (the plan of D11; `docs/en/ROADMAP.md`, `docs/en/BENCH.md` 3.5). The open matrix
of 20 rooms × 3 characters stays truncated: the 3.5 target is missed, as allowed (D11).

### Added

- The canonical owner (3.5, proofs): items no condition reads, in no invariant or goal, lost only by an action on them
  and given by no rule (`poolableItems`) are pooled while the playable characters can meet; the hand-overs that give a
  character the pool are played and checked before its actions are tried (`profile.ownership`, `--ownership=off`).
  The reference chapter: 904 → 288 states; the open chain of 20 rooms × 2 characters, truncated before, proved in
  14 002 states. The 20 × 3 open matrix stays truncated at 200 000 states: the 3.5 target is not met (BENCH.md).
  Audited against the explicit search on 60 random games with free items (`randomGame(seed, { free: true })`).
- Witness dominance (`--dominance`, witnesses only), with a run again without it when nothing is found; it prunes
  nothing on the bundled and stress games (BENCH.md "3.5"), so it stays off.

- Proof workers (3.5, `src/engine/tools/solve-pool.ts`): `npm run solve -- --prove --workers=N|auto [--batch=64]`
  expands the frontier a batch at a time on worker threads and merges in the batch's order: the same result for 1, 2,
  4 or 8 workers (`tests/workers.test.ts`), ×2.54 with 4 on a 40 000-state proof, ×2.01 on the 40-room era reference
  (BENCH.md "3.5", `npm run bench -- --workers-table`). Off unless asked for: without it the search is the one of
  3.4, byte for byte. A worker that cannot start leaves the work to the search's thread (`profile.workers.reason`);
  custom commands reach the workers from the game's module. `--time=<s>` (`timeLimitMs`) stops a search: `truncated`,
  `profile.stoppedBy: 'time'`, and such a result is not cached. The search is now an expansion that reads nothing of
  the search (`makeExpander`) and a merge that does, one code path with or without workers.

- The music director (3.5, `dom/director.ts`, `core/score.ts`): a track of `audio.music` can have a score
  (`audio.scores`: stems, tempo, the mix per game state). Its stems play sample-locked on Web Audio; a change of state
  (a flag, the room, the active character) moves stem gains on the next bar or beat, crossfaded; another room with the
  same track keeps the music going. `{ music: { stinger } }` plays a cue on the next beat. The single mix plays under
  Save-Data, on a low-end device or without Web Audio (`?music=mix|stems` forces one). `npm run audio -- stems` renders
  the stems from the arrangement (one gain for all: their sum is the mix). The sample game's theme in four stems (the
  harp and the bass alone while Biscuit plays, no melody in the garden), the reference chapter's (no melody until the
  lights come back). `npm run e2e:music` (CI): thirty minutes rendered offline with 0 samples of drift, 100 changes of
  mix without a click (a hard switch is caught), real-time jitter 0.02 ms in Chromium and WebKit, the stems in the
  game. The Studio's Music tab plays a score and each state's mix. The asset graph, the offline plan, provenance and
  `npm run weight` count the stems (the budgets count the single mix, the stems on their own line; `--stems`).

## 3.4.0 — 2026-10-05

"Stagecraft": picture, scene and Studio (Codex's 3.4 plan, D10–D13; `docs/en/ROADMAP.md`, `docs/en/BENCH.md` 3.4).

### Added

- The reference chapter (3.4, `games/reference`, "The Night Market", D13): the engine's second real game, built from
  the sample game's art. Two playable characters who need each other, 8 rooms, a staged market (6 layers, parallax, 3
  masks, stairs between two zones), a yard on two planes, an autonomous script, a minigame, a timeline finale, en and
  fr. A CI job builds it, proves it whole and by chapters, plays it to the end at the keyboard in Chromium and WebKit
  and in French, and checks its rooms, its frame rate (CPU ÷4) and its first visit's bytes (`docs/en/BENCH.md` 3.4).

- The Studio's structured editing (3.4): reactions, conditions, commands and a room's stage as forms (from one table
  of every condition and command, checked against the types at compile time), a diff preview, a write as code in the
  file's style validated after it is made (an edit that adds an error is taken back), atomic writes, Undo / Redo over
  the session's writes (refused when the file changed since), the placement editor's walk zones, links, layers,
  occluders, lights and particle areas, editable durations on the timeline, the painter choice and frame rate in Play,
  and a Voices tab. The `set_value` MCP tool gives an AI the same structured write (23 tools). `npm run e2e:studio`
  (a CI gate) creates, previews, applies and undoes a stage in a real browser.

- Voice production (3.4): `npm run voices` (`status`, `export` to CSV or JSON for the actors, `import` their statuses,
  actors and notes into `games/<id>/voices.json`, `check` every clip with ffmpeg: codec, rate, length for its text,
  loudness, peak; in `verify:release`). Clips per language (`audio.voicesByLang`), chosen with the language and
  counted by the offline plan. The music steps back while someone speaks. Captions for the sounds that matter
  (`{ sfx, caption }`, translated, a captions setting on by default, offered only in a game that captions something).

- Stage physics (3.4, `core/motion.ts`): `launch` (a ballistic flight), `spring` (a damped swing), `path` (a smooth
  curve through points), `follow` (an offset from a leader). Closed forms of time, never a simulation; presentation
  only (a character keeps where it lands, like `place`); validated, laid on the timeline, jumped to their end with
  reduced motion. The solver proves a game the same with motions everywhere.

- Walk topology (3.4): several walk zones joined by links (walk, stairs, ladder, jump, teleport, with their duration,
  animation and facing), the fewest links between two points, a depth scale per zone, a camera that zooms per zone
  (1–2) and moves vertically when zoomed. A closed link stops the walk at its foot and says its `locked` line, never
  the action: `npm run lint` warns when a rule behind it does not check the link's condition (`walk-link-gate`). The
  dev overlay and the Studio's spot view draw the zones and links. Old rooms: one zone, the same pictures.

- The stage, painted (3.4): layers at their depth with parallax, blend and opacity; occluders through a polygon (both
  painters), a black-and-white mask, a layer's alpha, feathered or inverted (canvas); radial and ambient lights;
  seeded particles; the room's fade or wipe transition. The model evaluates the stage's conditions and gives the stage
  again when one changes; reduced motion (the setting or `prefers-reduced-motion`) turns off parallax, particles and
  transitions.

- The Canvas 2D painter (`dom/render-canvas.ts`, D10): `renderer: 'canvas'` on a room or the game, `?renderer=` to
  force one. The sample game's rooms within 0.31% of the DOM references, the whole game played by it in CI (a new
  `chromium / canvas` row), and `npm run e2e:perf` (frames per second while the hero walks, CPU slowed 4×: 60 with
  either painter on the sample game).

- The stage schema (3.4): `RoomDef.stage` (layers with roles and conditions, lights, particle emitters, the room's
  transition, the logic of walk links) and its geometry in the layout (`layers`, `occluders`, `walkZones`, `walkLinks`,
  `lights`, `emitters`); `renderer: 'dom' | 'canvas'` on a room or the game. `stageOf` normalizes any room (an old one
  is one backdrop and one zone). `npm run validate` checks ids, images, geometry, zones joined by their links, and what
  only the canvas painter draws; the asset graph counts the stage images; link refusals are translatable. A stage is
  never game state: the sample game with a stage on every room proves state for state the same.

- The renderer contract (D10): `RoomView` is the scene model (positions, poses, depth, walking, fades, the camera, the
  hit test) and hands finished sprites to a painter (`SceneRenderer` / `SpriteSpec`, `dom/renderer.ts`); the DOM
  painter (`dom/render-dom.ts`) is the reference. The rooms render pixel for pixel as before.

- Visual baselines: `RoomView.still()` freezes the scene; `npm run e2e:visual` (a CI gate) compares every room of the
  sample game with `tests/visual/demo/*.png`.

- One asset graph (`src/engine/core/asset-graph.ts`): the title, each room, the map, the game-wide rules and the whole
  game, from the content. The renderer's room preload, the background warm-up, the offline plan, provenance and
  `npm run weight` all read it. It counts what the old budget missed (voice clips, minigame images and sounds, music
  changed by commands, the title video, gained items' icons, phone callers, prop animations) and no longer counts a
  playable character in a room it cannot reach.

- `npm run weight` counts the app shell the service worker precaches (from `dist/sw.js`, compressed, with what a first
  visit downloads twice) in `initial`, and the decoded memory of the images. `npm run e2e:weight` (a CI gate in the
  Chromium row) checks the prediction against a real first visit: on the sample game 2 416 KB transferred for 2 486 KB
  predicted, nothing outside the prediction.

### Changed

- The Canvas painter draws the viewport only, over a background pre-rendered once per room: 59 frames per second in
  the sample game's wide market with the CPU slowed 12× (31.5 on the CI runner at 4× before), its rooms still within
  0.28% of the DOM references.

- A first visit to the sample game drops from 6.6 MB to 2.4 MB: the interface font is a Latin subset (DotGothic16,
  2 MB → 118 KB, `tools/subset-font.py`) with the full font as a `unicode-range` fallback outside the precache, the
  default fonts go through the bundler (the service worker's precache no longer downloads them a second time), and
  VT323, precached but never used, is gone.

### Fixed

- The Canvas painter rebuilt its background and occluders (a blur over the whole room) each time a character's next
  frame finished loading, and copied a whole viewport per occluder each frame: only a backdrop, layer or mask image
  makes the caches stale now, and an occluder keeps only the pixels that hide. The reference market, CPU ÷8: 20 → 47
  frames per second, the same pixels.

- The e2e harness switches characters until the engine has switched (the button ignores a press while a line is on
  screen: at the keyboard's pace, a hand-over's line); `e2e:weight` waits for a Canvas room as for a DOM one;
  `npm run assets` prepares a stage's layer, mask and particle images; `solve`, `replay` and `lint` no longer cut their
  JSON output at 8 KB in a pipe (`tools/flush.ts`).

## 3.3.1 — 2026-10-05

"Truth": what 3.3.0 promised, made exact (Codex's review of 3.3.0, LOG #55).

### Added

- `npm run solve -- --audit-abstractions` (`src/engine/tools/audit.ts`, in `release-check`): the proof with the
  abstractions, every no-op memo hit run anyway, against the explicit search with all of them off; any difference in
  the verdict, invariants, softlocks or what is reached fails (exit 1), an explicit search over budget is `partial`
  (exit 2). `tests/audit.test.ts`: the same audit on 120 seeded random games (`tests/gen/random-game.ts`) and on one
  game per command and per condition (checked against the types at compile time).
- `npm run verify:commercial` (`validate --commercial` after `verify:release`): a release that may be sold. It refuses
  any `releaseExceptions` entry, any placeholder, any non-commercial or no-derivatives licence, and any provenance entry
  without an author or a source that can be checked (a new `url` field, or a repository file named in `source`). The
  sample game fails it on purpose: its music is CC BY-NC 4.0.
- `docs/dev/passes/`: one sheet per release for the checks automation cannot make (screen reader, Safari offline
  with its checklist `docs/dev/SAFARI-OFFLINE.md`, a real phone, playtesters, voices, a signed tag). The release notes
  list them (D12: reported, not blocking).
- The GitHub release carries the built game (`dist.tar.gz`), its SHA-256, an SBOM of the shipped dependencies
  (CycloneDX) and a build provenance attestation (`gh attestation verify <file> -R wanoo/web-scumm`).

### Fixed

- The solver merged states that differ by a flag gating only an earlier rule, though that flag decides whether the
  earlier or a later rule answers the same action (first match wins): every path through the later rule could be lost,
  in every mode. The puzzle graph now links an earlier rule's condition to each later rule it can shadow. Found by the
  random games; the demo and the reference game keep the same state counts.
- With several playable characters, `roomsReached` missed the rooms where only an inactive character stood when the
  canonical character was on (the lint's `room-never-reached` could follow).

### Changed

- CI: the whole game at the keyboard in WebKit and the whole game in French in Chromium are gates (green on every run
  of 3.3 on `main`, D7's rule).
- `verify:release` prints what a `releaseExceptions` entry lets through as named, accepted exceptions, not warnings;
  the sample game's decorative `tea_drunk` flag is kept on purpose with `lint.ignore: ['flag-never-read:tea_drunk']`,
  which `npm run validate` now honours. The sample game's release check has no warning left.
- Truthful wording: the partial-order reduction section of BENCH is marked historical, with a warning never to use it
  to certify the absence of softlocks, and `solve --prove --por=…` says it ignores the flag; the no-op memo is "an
  equivalence checked on the differential corpus", not a proof for every game; the 40-room reference is "structured by
  eras" wherever it is quoted; accessibility is "tested at the keyboard, no serious axe violation", not a WCAG claim.
  The profile's header reads "what each one did, or why it is off".
- The README (en and fr) is a showcase: the promise, the v3.3 measurements with their limits, four player and four
  Studio images, a quick start that begins with `npm run doctor`, then links to the docs. The images come from the
  production bundle and the Studio through `npm run docs:screenshots` (`scripts/docs-screenshots.mjs`).
- Decisions D10–D13: a Canvas 2D renderer allowed beside the DOM one (3.4), the plan 3.3.1 → 3.4 "Stagecraft" → 3.5
  "Score", human gates reported rather than blocking, the 3.4 reference chapter made from the sample game's art.

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
