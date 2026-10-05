# Roadmap: from a reactive engine to a world engine (v1.3 → v2.0)

*Written on 3 October 2026 from an external audit of v1.2.1; M1 shipped in v1.3.0. French version: [docs/fr/ROADMAP.md](../fr/ROADMAP.md).*

## Context

An external audit of web-scumm concluded that the engine can produce a good short point-and-click, but not comfortably
a game of 30 to 100 rooms, because it was purely reactive (tap → rule → commands) with no world simulation. We checked its
18 claims against the code: 12 exact, 4 partial, 2 wrong (`give` / `take` / `room` are not commands; the minigames are
not in the core, they are already a registry a game extends from `games/<id>/index.ts`). The main diagnosis holds.

The goal: one person, with any AI, can make a **complete** (long) game with this engine. This roadmap orders the work by
what actually blocks a long game, not by fidelity to Day of the Tentacle.

What was true in v1.2.1 (`src/engine/core/types.ts`, `engine.ts`, `src/engine/tools/solve.ts`):
- one `hero`, one inventory; actors stored per `room.actor`, no command moved an actor to another room;
- no autonomous script, no timer, no event: `onEnter` was the only trigger besides a tap; the only loop was the render rAF;
- fixed 640 × 400, no camera; no prop animation, no frame event;
- talk topics `{topic, if, do}` per room, branching through `choice` / `if` inside `do`;
- exits = hotspots with `goto`; `validate` builds no room graph;
- one save (`<id>.save`), a different version means a new game, no migration;
- best-first solver, `--max 20000`, start from a checkpoint possible, no notion of goal or invariant;
- no `custom`, no locale, no `voice`, settings = music / sfx.

## Our take on the audit (kept, changed)

**Kept**: scheduler + events + world actors as the first milestone; no rewrite, no Phaser; chapter solver with goals and
invariants; multi-slot saves with data-only migrations; a "why is this rule unavailable" debugger; animations with frame
events; an escape hatch with effects declared to the solver.

**Changed**:
- *Events and the scheduler are one feature.* An event bus without scripts able to wait (`waitEvent`, `waitUntil`) is
  only a renamed flag. Both land together, in the same serialisable state format.
- *Several playable characters is not P0* for "anyone makes a complete game": it is P0 only for DOTT. It comes after the
  camera and after the saves, because it changes the shape of the state and should benefit from migrations.
- *No separate "dialogue graph".* Topics + `choice` + `do` are already a data graph; a second format would duplicate the
  DSL and break the solver, MCP and prompts. What is missing is the **visualisation** in the Studio (a tree derived from
  the topics) and filling known gaps (the Studio cannot add or remove a topic). Insult sword fighting is an *activity*
  (minigame), not a dialogue primitive.
- *Minigames → plugins*: already the case (`minigames` exported by the game, merged into `App`). Only docs and an example
  outside the core are missing; not a priority.
- *Localisation*: retrofit by extraction (texts identified by their path `room.hotspot.look`, `locales/<lang>.json`
  files that override) rather than keys in the content, so the DSL the AI writes stays light. Stays P2.
- *The real risk* is not technical: every added primitive must be understood by `validate`, `solve`, CONTENT_GUIDE en/fr,
  the prompts generator, the MCP tools and the Studio, otherwise the AI will not use it, or badly. Every milestone below
  includes that propagation, and the demo uses every primitive at least once.

## Design principles (every milestone)

1. **Everything stays data**: new commands in the `Cmd` union, new typed fields on `RoomDef` / `GameDef`, never
   functions in the content (except the `custom` registry, which lives in `index.ts` like the minigames).
2. **Everything is in `GameState`**: script program counters, world actors, camera ⇒ exact save and resume,
   deterministic solver.
3. **The solver models time as a choice**: "let script X finish its iteration" is a solver action, `wait` is zero in
   simulation; the effects of a `custom` command are declared (`effects: Cmd[]`).
4. **One milestone = at most one `saveVersion` bump**, with a migration provided.
5. **The private game follows**: its repository embeds a copy of `src/engine`; at every milestone the engine is copied
   back and the game replayed (e2e, tests, solver). That is the full-size regression test.

## Milestones

### M1 — "World" (v1.3, shipped): the world acts without a tap

- **World actors**: `GameState.where` (character → room), `CharacterDef.room` (starting room), `{ moveActor: [char, room], at? }`,
  condition `{ actorIn: [char, room] }`; a moving character only shows in the room it is in; checkpoints take `where`.
  No save bump: per-room actor overrides (`room.actor`) are unchanged, `where` is filled from the characters' `room`.
- **Events**: `{ emit: id }`; `RoomDef.events` and `GameDef.events`: `{ on, if?, once?, do }`, run synchronously, room
  then game. An event is not a state: it fires, then is gone; a listener sets a flag when something must be remembered.
- **Scheduler**: `RoomDef.scripts` / `GameDef.scripts`: `{ id, while?, loop?, do }`; commands `waitUntil`, `waitEvent`,
  `startScript`, `stopScript`; `GameState.scripts[id] = { pc, done?, off? }` so a save resumes them. Scripts advance one
  command at a time between the player's actions, never during one, a cutscene, a conversation or a minigame.
  `Engine.autoScripts` (true in the browser, false in node: tests and the solver call `runScript` / `advance`).
- **Solver**: "Script <id>" is an action (run until it waits, ends or loops); numeric flags are clamped to the highest
  threshold a condition compares them with, so a counter script does not create states forever. **Validator**: unique
  script ids, loops that never wait, events emitted but never listened to (and the reverse), moving characters without a
  starting room or without an actor in the target room.
- **Dev panel**: World (room of each moving character, editable) and Scripts (position, stop / restart). **Studio**: Scripts
  and Events sections of a room. **e2e**: a "Script <id>" step waits for the script to move on.
- **Demo**: Biscuit stretches on his own (house script), Lou strolls along the stalls (market script, `while`), the market
  emits `key_found`, the game listener moves Grandpa (and his armchair) home for the finale (`moveActor`, `actorIn`).
- Also: navmesh paths are pulled straight when the shortcut stays inside the walk zone (the hero no longer takes a detour
  around a corner it does not need).

### M2 — "Scale" (v1.4, shipped): hold 40 rooms without losing the testers

Files: `src/engine/tools/{validate,solve}.ts`, new `src/engine/tools/graph.ts`, `src/engine/dom/app.ts` (menu), new
`src/engine/core/migrate.ts`, a `world` review page.

- **Declared exits**: `RoomDef.exits: Record<id, { to; entry?; if?; walkTo?; transition?: 'fade' | 'cut' }>`. An exit is
  rendered as a hotspot (same layout); the engine generates the `goto` rule. Existing `goto` hotspots stay valid.
- **World graph**: `graph.ts` builds rooms / exits / entries; `validate` reports unreachable rooms, missing entry points,
  unintended one-way exits (unless `oneWay: true`). `npm run page:world`: a clickable graph (DOT / SVG export), also in
  the Studio's Check tab.
- **Chapters and goals**: `checkpoints[i].goals?: Cond[]` and `GameDef.invariants?: Cond[]` ("never true"). `solve`
  resolves checkpoint to checkpoint by default (each segment bounded), then globally on request; fails if an invariant
  becomes true on a reached path. `--json` output enriched with the segments (the e2e already replays the path).
- **Saves**: `GameDef.saves?: { slots }` (default 1 = today's behaviour). Pause menu: save / load a slot with room, date,
  play time, thumbnail (the room's backdrop). JSON export / import of a slot. Key `<id>.save.<n>`, `<id>.save` migrated to slot 1.
- **Data-only migrations**: `GameDef.migrations?: Array<{ from; renameFlag?; renameItem?; renameRoom?; renameActor?; drop? }>`,
  applied in a chain in `migrate.ts` before the state is completed. `validate`: renames point to existing ids.
- **Content profiler**: `npm run validate -- --report`: per room (hotspots without `look`, verbs on fallback, props that
  never change), per item (obtained where, used how often, consumed), per character (topics, unreachable ones, lines > N).
  Same report in the Studio's Check tab.
- **Demo**: 3 rooms → declared exits, 2 checkpoints with goals, 1 invariant, 3 slots.

### M3 — "Picture" (v1.5, shipped): staging

Files: `src/engine/core/types.ts` (Layout, PropDef, Cmd), `src/engine/dom/room.ts`, `src/engine/dev/editor.ts`,
`tools/pages/placement.ts`, `tools/assets.py`.

- **Wide rooms and camera**: `Layout.width?` (≥ 640, height stays 400); logical coordinates extend; `assets.py` accepts
  backdrops wider than 1280. `GameState.camera: { x, target? }`. Commands `{ camera: 'follow' | { pan, ms } | { to: who } | 'reset' }`.
  `room.ts` translates the scene layer; `shake` already exists. The editor and the placement page show the whole room with
  the camera frame. The solver ignores the camera.
- **Prop animations with frame events**: `PropDef.anims?: Record<name, { frames; fps?; loop?; at?: Record<frame, Cmd[]> }>`;
  commands `{ play: [prop, anim] }`, `{ waitAnim: prop }`. Same `at` on characters' `anim` poses. The solver runs the `at`
  commands in order, without waiting.
- **Voice**: `say` takes `voice?: SoundId`; `GameDef.audio.voices?`; auto-advance at the end of the clip; separate voice
  volume. `refs.ts` / `assets.py` include the clips.
- **Preferences**: `GameDef.ui.settings?` enables text speed, subtitle size, reduced animations / shake, a dyslexia-friendly
  font (provided by the game in `skin.fonts`), music / sfx / voice volumes. Stored outside the save.
- **Demo**: a wider market (1.5 screens) with camera follow; the pantry door animated with an `sfx` on frame 3.

### M4 — "Cast" (v1.6, shipped): several playable characters

Files: `types.ts`, `engine.ts`, state, `dom/app.ts` (inventory, switch button), `solve.ts`, `validate.ts`, `migrate.ts`.

- `GameDef.hero` stays valid (sugar for a single player). New `GameDef.players?: { ids; initial; sharedInventory? }`.
- `GameState.players: Record<Id, { room, inventory, hero: Record<room, Point> }>` + `GameState.active`. The flat
  `room` / `inventory` / `hero` fields become views on the active player (access centralised in `state.ts`). Migration
  provided (`saveVersion` + 1).
- Commands `{ switchPlayer: id }`, `{ transfer: [item, to] }`; condition `{ player: id }`; a switch button in the UI, `ui` texts.
- Solver: switching is an action; the hash includes every player. Validate: an item transferred to a player who can never receive it.
- A dedicated test fixture (see M5); the demo does not need it, a second sample `games/trio` (3 rooms, 2 players) illustrates and tests it end to end.

### M5 — "Open" (v2.0, shipped): openness and robustness

- **Custom commands**: `games/<id>/index.ts` exports `commands?: Record<name, { run(ctx, args); effects?: Cmd[] }>`;
  command `{ custom: name, args }`. The solver applies `effects`; `validate` requires `effects` or `pure: true`.
  Doc: "when the DSL is not enough".
- **Localisation**: `npm run i18n extract` writes `games/<id>/locales/<base>.json` (key = content path, value = text);
  `locales/<lang>.json` overrides at load time; `GameDef.lang` / a selector. Studio: a coverage tab (missing, too long).
  The source content stays inline: nothing changes for the AI writing a game.
- **Micro-game tests**: `tests/fixtures/{scripts,events,actors,exits,saves,camera,players}/`, one room each, one test per
  primitive; the current fixture stays for the base.
- **Studio "Play"**: a tab playing the game in a `?dev` iframe with the state inspector (already in the dev panel) and a
  **rule explainer**: tap a hotspot / item → the candidate rules with every condition evaluated ✓ / ✗ (reuses the core's
  `check`, exposed in dev mode).
- **Minigames**: nothing to code; document the existing registry as `activities` and ship an example in `games/_template`.

## v2.1 "Proof" (shipped): prove the engine rather than extend it

A second audit, on v2.0.1, concluded that the primitives were there and that the next step was proof and tooling, not
more commands. Two of its claims were wrong (`engine.ts` and `types.ts` are under a thousand lines each, not three
thousand), its direction was right. What v2.1 delivered:

- **One catalogue of the commands** (`src/engine/core/cmds.ts`): every key of `Cmd`, which ones hold nested lists, which
  ones change the state, which ones carry text; the validator, the solver, the texts walker and the content tools read
  it. Adding a variant to `Cmd` without listing it fails `tsc`; `tests/cmds.test.ts` runs every command through the
  validator and the engine.
- **The classics** (`docs/en/CLASSICS.md`): twenty famous mechanics of the genre written with the DSL as is, each
  marked native / feasible / custom, five of them played and proven in `tests/classics.test.ts`. Writing them found
  three real solver gaps, fixed: it only ever took the last option of a `choice`, it clamped counters that go down
  (haggling), and it ran a script whole instead of one `wait` at a time (a patrol was never seen in the middle room).
- **The puzzle graph** (`src/engine/tools/puzzle.ts`): what every rule, topic, script and listener needs and changes;
  a card per item, flag, prop, place or event (acquired by, used by, requires first, unlocks, downstream); in the
  Studio's Check tab, as `npm run page:puzzles`, as the `puzzle_graph` tool. The validator uses it to spot a flag only
  set by actions that already need it.
- **The solver prunes what cannot matter**: from the same graph, a flag nobody but its setter reads, a script whose
  effects reach nothing live, a walker nobody waits for are left out of the state. The generated 40-room game went
  from "20 000 states, truncated" to 804 states in a second (`docs/en/BENCH.md`).
- **A generated stress game** (`src/engine/tools/stress.ts`, `npm run bench`): rooms, players, items, flags, walkers,
  scripts, topics, chapters and migrations at any size, every tool timed on it; a small one runs in the tests.
- **Loops honour `at`** for sounds and shakes; the validator refuses a state change there.
- **Translations survive refactors**: `extract --lang xx` follows a text that moved (same source text in the previous
  reference file), parks what disappeared under `_stale:`, revives it when the path returns.

## v2.2 "Studio" (shipped): see the dialogue, see the clock

- **The dialogue tree** (`src/engine/tools/dialogue.ts`): a character's topics as a tree (topics, lines, choices and
  options, branches, each with its condition), derived from the DSL, nothing to keep in sync. In the Studio's Rooms tab
  (a toggle next to the topics; tapping a node jumps to its editor) and as the `dialogue_tree` tool.
- **The journal** (`Engine.trace`, dev mode): what every action answered, events emitted and listeners reached, script
  steps, characters moved, player switches. In the Studio's Play tab (filter by kind) and the dev panel (last ten).

## v2.3 "Replay" (shipped): reproduce, profile, prune

The third audit asked for three things a long game needs more than any primitive: reproduce a tester's bug, know why
the solver is slow or big, and explore fewer equivalent orders. All three come from the same fact: the engine knows
what every action read and changed.

- **The session** (`Engine.session`, always recorded): every input since the game started or a save was loaded
  (actions, map travels, player switches, script steps), with the answers given on the way (choices, map, random draws)
  and what answered (the puzzle graph's ids). "Export session" in the game's save menu, in the dev panel and in the
  Studio's Play tab; `npm run replay -- file.json` plays it on the real engine without a display and says where it
  stops matching (`src/engine/tools/replay.ts`). A bug report is a session file and a screenshot; the Play tab's
  **Replay** scrubs through it and lands the game anywhere on the way.
- **The solver's solution is a session** (`SolveResult.steps`): `replay()` proves it, the e2e harness taps it (no more
  label parsing), and CI plays the sample game in Chromium on every push.
- **The solver profile** (`npm run solve -- --profile`, the Check tab's "Solver health", the `solve` tool with
  `profile: true`): states, engine runs, no-ops, what the states are made of (which dimension splits them most), states
  by room, what answered most (a heat map on the puzzle graph), use/give combinations that could only fall back,
  independent dimensions (a checkpoint between them would cut the states), monotonic things. Actions no written rule
  can answer are not run at all any more: three times fewer engine runs on the sample game.
- **Why is this live?** (`liveClasses`, `whyLive` in `src/engine/tools/puzzle.ts`): every node of the puzzle graph is
  *critical* (it reaches the end, a goal or an invariant), *world*, *visible* or *dead* (out of the solver's state); a
  card shows the chain; "Critical path" fades the rest of the graph.
- **Partial-order reduction** (`src/engine/tools/por.ts`, `npm run solve -- --por=sleep|stubborn`): actions that
  touch different things commute. `sleep` skips the orders already covered (fewer runs, the same states); `stubborn`
  explores one of several commuting actions at a time (fewer states too: k independent pickups before a door are k + 1
  states instead of 2^k). Off by default, the plain search stays the proof; `tests/por.test.ts` checks that every
  fixture gives the same answers in all three modes.
- **Custom commands checked** in dev mode: a `run` that changes the state outside its declared `effects` is reported
  in the journal.
- Two holes of the state hash closed (`visited`, the counters of `random` blocks); the dialogue tree's lines jump to
  their editor again.

## v2.4 "Author" (shipped): the story against the game, the cutscene against the clock

- **Storyboard coverage** (`src/engine/tools/coverage.ts`): the storyboard (`games/<id>/storyboard.json`) checked
  against the content: rooms, speakers, talk characters and sounds by id; panel actions ("Open Grandpa's armchair",
  "Use pipe with tank", "Talk to Lou: Where is the key?") parsed with the game's verbs and the names of the things in the
  room, then looked up in the rules, the kind reactions, the topics and the look lines; lines, topics and hints by
  text (exact, close, or absent). Every check is *ok*, *partial* (the pieces exist, no rule answers; a close line),
  *missing* or *unknown* (prose). Badges on the boards and panels of the Studio's Storyboard tab (with the list of
  what is not there yet), a "Storyboard coverage" panel in Check, the `storyboard_coverage` tool (20 tools).
- **The cutscene timeline** (`src/engine/tools/timeline.ts`, `src/engine/core/timing.ts`): how long a command list
  takes and what overlaps, read from the DSL as written: lines last as the presenter shows them, walks as far as the
  layout says, animations their frames, `parallel` branches on their own lanes, a choice or a minigame marked as the
  player's turn. A "Timeline" toggle next to every cutscene, arrival script and world script in the Rooms tab; tap a
  bar to jump to its line. The presenter's durations now come from one file.
- Dominance pruning (the auditor's fifth stage) was not done: on the sample game, the private game and the stress game
  the profile shows no dimension where monotonic things dominate; it stays a note in `docs/en/BENCH.md`.

## v2.5 "Sound" (shipped): music and effects from one palette

- **The audio pipeline** (`tools/audio`, `npm run audio`, `docs/en/AUDIO.md`): a MIDI (or an audio file, transcribed)
  becomes a Sega Mega Drive arrangement (YM2612 FM + SN76489 PSG + DAC drums) written as a `spec.json` the assistant
  authors from an automatic analysis (tracks, ranges, doublings, sections); Furnace renders `.fur`, `.wav`, `.vgm`,
  `.mp3`; a QA report measures every channel against the palette's targets, the pitch accuracy and the peak. One
  palette (`tools/audio/palette.json`) for every track of every game, the way one style block serves every image.
- **Sound effects from the same palette** (`games/<id>/audio/sfx.json`, `npm run audio -- sfx`): short recipes on the
  FM, PSG and noise channels, rendered, trimmed and normalised to `audio/sfx/*.mp3`. The sample game's nineteen
  effects are now Mega Drive renders instead of Kenney samples, and it has a theme: the opening of Tchaikovsky's
  *Swan Lake* (public domain), played on the title screen and in every room.
- Vendor-neutral: the workflow and the rules live in `docs/en/AUDIO.md` (`read_doc AUDIO` through MCP), `AGENTS.md`
  names the command and the licence rule; the Claude skill only points there.
- Not done, on purpose: adaptive music (iMUSE-like transitions); Furnace is downloaded by `setup`, not bundled; CI
  does not render audio (the files are committed).

## v3 "Trust" (shipped 4 October 2026): the engine you can trust a long game to

Co-developed by two assistants under `docs/dev/CHARTER.md`; the exchange is `docs/dev/LOG.md`, the decisions
`docs/dev/DECISIONS.md`. v3 may break v2 (D1): every break ships with its migration and an upgrading guide, and the
private reference game is migrated on a branch before v3.0.0 is tagged. Since v3.0.0, `main` is the release branch and
each `v3-<topic>` merges there as it passes its gates (D7).

The opening proposal is Codex's beta (`v3-beta1`, log #1), reviewed in log #2. Its topics, each a `v3-<topic>` branch
when split out:

- **saves**: a validated save envelope, an IndexedDB autosave read back after each write, visible storage failures,
  a PWA update that waits for a verified save; stale references pruned, not rejected.
- **prove**: `solve -- --prove` with an honest `status`, softlocks by reverse reachability, `random` and nested
  choices explored; the proof stays outside `npm run build` or runs with the reduction and a budget.
- **ids**: `schemaVersion: 3` with stable ids on rules, choices, topics, listeners, persistent blocks and script steps;
  one naming function shared by the engine, the solver and the puzzle graph.
- **studio-security**: loopback by default, LAN token, same-origin writes, key in sessionStorage.
- **ci**: production-build e2e, WebKit smoke test (non-blocking until three green runs), `doctor`, `audit:deps`.
- **offline**: budgeted room/neighbor warming, with an explicit cached-rooms offline contract instead of an unbounded
  whole-game download.
- **upgrading**: `docs/en/UPGRADING.md` + `docs/fr/UPGRADING.md`, the v2 → v3 checklist, run on the private reference game.

## v3.1 "Playtest" (shipped 4 October 2026): what v3.0.0 left open, then two tools a studio expects

One `v3-<topic>` branch at a time, each with its log entry, tests, docs in both languages and a CI run, merged into
`main` as it passed: `v3-webkit` (the generic replay from the title; WebKit gates after its three green runs),
`v3-ids` (`npm run ids`, the sample game on schema 3, translation paths by id), `v3-boot` (`bootGame`; the
precache fix of the two-entry build), `v3-slots` (slots in IndexedDB), `v3-offline` (the whole game offline after
the first visit, D5), `v3-a11y` (a whole game at the keyboard), `v3-lint` (the content lint), `v3-playtests`
(sessions from phones replayed in CI, stalls on the heat map), `v3-ci` (the proof measured honestly, release and
prove workflows, Dependabot), `v3-docs` (this sweep). Next for the solver: the reduction in proof mode, with
`tests/por.test.ts` as its proof (BENCH.md).

## v3.1.1 "Truth" (4 October 2026): every green command means exactly what it says

Codex's audit of 3.1 (LOG #24) found tools that could report success without proving their wording; the maintainer
chose to patch before building (LOG #25, #26). `v3-qa-truth`: the e2e requires a `solved` solver run and the engine's
own `state.done` (a sealed ending now sets it), the playtest analysis counts from the first input, the lint exits 2 on a
truncated search and reads every attempted action, `verify:game` lints, `playtests --strict` gates releases.
`v3-offline-truth`: the warm-up returns what it did, the status is `complete` only when every file is cached, the
pause menu shows it, the PWA smoke checks the whole plan and never counts WebKit's skip as a proof.
`v3-studio-net`: private hosts refused in both IP families, no redirect, a deadline and a cap on provider calls.
`v3-release-truth`: the release runs on the CI's success for the tag, a golden 3.1.0 save, the full dependency audit,
D5/D7/D8/D9 recorded. The private reference game stays on 3.1.0 (D8).

## v3.2 "Production" (4 October 2026): identity, saves, proof, accessibility and assets a team can rely on

The second half of Codex's horizon (LOG #25), one branch at a time, each merged on green CI (D9): `v32-bindings`
(one table of the engine's English texts, a release-language e2e that fails on any visible default, minigame
bindings validated), `v32-line-ids` (a stable id per line: translations and voices follow it, `npm run ids --
--lines`), `v32-save-results` (clear and import say what they did and never lose the game, golden saves for 3.0.0
and 3.1.0, a save round trip in a real browser with and without IndexedDB), `v32-proof-scale` (every softlock counted
and grouped by cause, the proof by chapters from every reachable boundary state, checkpoints checked, one budget; the
reductions measured and kept out of proof mode; BENCH.md says where the proof stops: multi-character games),
`v32-a11y-gate` (every bundled minigame plays at the keyboard, axe-core on four screens, the keyboard row gates),
`v32-assets-provenance` (`provenance.json` for every shipped asset), `v32-release` (a second game made by `new-game`
passes every gate in CI). Out of 3.2, said in BENCH.md and ENGINE.md: proving a multi-character long game (the 3.3 solver track below), a
screen-reader pass (manual), DNS pinning of custom providers.

## v3.3 "Scale" (5 October 2026): prove multi-character games, close the production contracts

From an outside review (LOG #38) and Codex's reviews of 3.2 (LOG #39, #40), one branch at a time, each merged on
green CI (D9). The proof: `v33-proof-profile` (where the time goes, `npm run bench -- --matrix`), `v33-proof-core`
(a heap frontier and parent pointers: the queue went from 89% of the time to nothing, same witnesses),
`v33-player-canonical` (states that differ only by who is active are one state), `v33-mobility` (mobility regions:
silent moves folded into the next action, an exact fallback when a move is not silent), `v33-chapter-interfaces`
(one shared search per chapter from every boundary state, a goal checked on every character's view: a real bug
found against the explicit search), `v33-noop-memo` (the partial-order reduction measured in proof mode and refused:
it reported a softlock that does not exist; instead the engine's writes are traced and a try that wrote nothing is
not run again on the same read values, every skip checkable), `v33-one-status` (one status, exit code and sentence
for the CLI, its JSON, the Studio and the MCP tool), `v33-proof-cache` (a result keyed by the engine, the game and the
options, given back when nothing changed). Production: `v33-list-ids` (look lists, hints, fallback answers and
reactions by kind get stable ids), `v33-provenance-lock` (a reviewed lock of every shipped file and a licence policy,
both required for a release), `v33-asset-weight` (what a phone downloads before the first room, per room and per
chapter, held to budgets), `v33-browser-gates` (axe-core on dialogues, the map, the save slots and every minigame;
every minigame won at the keyboard in a real browser; storage upgrades in Chromium and WebKit).

Exit criteria, measured (BENCH.md "v3.3"): the 40-room, 3-character reference game (structured by eras) proved in 578 states and 3.5 s
(budget 200 000 states, 60 s); the demo proved in 2.2 s (budget 5 s) and by chapters in 3.3 s (budget 20 s); the
abstractions give the explicit search's verdicts on the differential corpus (`tests/reference-proof.test.ts`,
`tests/memo.test.ts`, `tests/canonical.test.ts`); the profile says what each abstraction did or why it is off; one
status everywhere; CI on `v33-*`. Not done, said here: parallel workers (each chapter is one shared search and
chapters follow each other: nothing independent is left to split, and every budget is met), dominance between
boundary states and a symbolic backend (no game exceeds the budgets), a manual screen-reader pass (the maintainer's,
checklist in `docs/dev/`), the open 3-character matrix where items move freely between characters (a true product
of item placements, BENCH.md). Stagecraft (layers, walk topology, structured Studio editors, voice production) moves
to 3.4.

## v3.3.1 "Truth" (5 October 2026): what 3.3.0 promised, made exact

From Codex's review of 3.3.0 (LOG #55), one branch at a time (D9): `v331-docs-truth` (the partial-order reduction
marked historical and refused in proofs, the memo "checked, not proved", the reference "structured by eras", no WCAG
claim, the manual pass sheets), `v331-abstraction-audit` (`solve --audit-abstractions` on any game, 120 random games
and one game per command and condition; it found a flaw of the base search, rule shadowing missing from the liveness
analysis, fixed), `v331-commercial` (`verify:commercial`; release exceptions printed by name), `v331-ci-gates`
(WebKit at the keyboard and the French game gate; a Safari offline checklist), `v331-release` (the built game, an SBOM
and an attestation on the GitHub release; the notes list the manual passes, D12).

## v3.4 "Stagecraft" (5 October 2026): picture, scene and Studio

Decided with the maintainer (D10, D11, D13), from Codex's 3.4 plan and its extension, one branch at a time (D9), in
dependency order:

- `v34-asset-graph`: one graph of the files each part of the game needs (title, rooms, map, offline), read by
  preloading, the offline plan, provenance and `npm run weight`; `npm run e2e:weight` checks it against the bytes a
  browser really transfers (a CI gate). Fonts through the bundler, a Latin subset.
- `v34-renderer-contract`: the scene model (`RoomView`) and its painters; the DOM painter is the reference; visual
  baselines for every room (`npm run e2e:visual`).
- `v34-stage-schema`: `RoomDef.stage` (layers, lights, emitters, transition, links' conditions) and the layout's
  geometry; old rooms normalised, nothing to rewrite (UPGRADING §11); 3.x saves unchanged.
- `v34-canvas`: the Canvas 2D painter (D10), the DOM overlay for the interface and accessibility; parity with the DOM
  references; `npm run e2e:perf` (CPU slowed 4×, a CI gate).
- `v34-layers-masks`: parallax, occluders (polygon, mask image, a layer's alpha, feathered or inverted), lights,
  seeded particles, transitions; reduced motion honoured.
- `v34-walk-topology`: walk zones and links (walk, stairs, ladder, jump, teleport), a depth scale and a camera zoom
  per zone; a closed link stops the walk, never the action (lint `walk-link-gate`).
- `v34-stage-physics`: `launch`, `spring`, `path`, `follow`, closed forms of time, presentation only.
- `v34-voice-production`: `npm run voices` (the table per language, CSV out and back, every clip checked with ffmpeg),
  music ducked under voices, captions for the sounds that matter.
- `v34-studio`: structured editing (forms for reactions, conditions, commands and stages, a diff preview, validated
  atomic writes, undo / redo), the stage's geometry in the editor, the Voices tab, `set_value` for AIs.
- `v34-reference`: "The Night Market" (`games/reference`), the second real game, the exit gate.

Exit criteria, as measured (BENCH 3.4): the first visit inside the weight prediction; the sample game's rooms and the
reference's against their baselines; the whole game played by the Canvas painter; 3.0–3.3 golden saves resumed to the
end; the market with 6 layers, parallax and 3 masks at 50 fps with the CPU slowed 4× (47 at 8×); a character crossing
two zones by stairs and two planes by a ladder and a jump; the Studio creating and undoing a stage in a browser; no
layer or link carrying logic (lint and test); the reference proved whole and by chapters and played to the end at the
keyboard in Chromium and WebKit, and in French. Reported, not done by hand (D12, `docs/dev/passes/3.4.0.md`): the
screen reader, testers, a real phone, Safari offline, recorded voices, a signed tag. Left for later: lip-sync markers
in the voice table.

## v3.5 "Score" (5 October 2026): music, workers, inventories

From the plan decided with the maintainer (D11), one branch at a time (D9):

- `v35-music-director`: a track can have a score (`audio.scores`), its stems rendered from the arrangement
  (`npm run audio -- stems`), played sample-locked on Web Audio; the mix follows the game's state (a flag, the room,
  the active character) on the next bar, crossfaded; stingers on the beat; the single mix where the director does not
  fit (Save-Data, a low-end device). The Studio's Music tab. `npm run e2e:music` (CI): 30 minutes without a sample
  of drift, 100 changes without a click, real-time jitter 0.02 ms in Chromium and WebKit.
- `v35-proof-workers`: the frontier expanded in batches by worker threads, merged in the batch's order: the same
  result for 1, 2, 4 and 8 workers, ×2.54 with 4 on a 40 000-state proof. Off unless asked for (`--workers`).
- `v35-inventory-ownership`: the canonical owner pools the items no condition reads while the characters can meet,
  the hand-overs played and checked; audited against the explicit search. The reference chapter 904 → 288 states,
  the open 20 × 2 matrix proved. Witness dominance as an option (it prunes nothing on the bundled games).

Exit criteria, as measured (BENCH.md "3.5"): the director's three gates green in CI; workers identical for 1, 2, 4, 8
and ×2 with 4; the owner never diverging from the explicit search. **Missed, not blocking (D11):** the open matrix of
20 rooms × 3 characters stays truncated at 200 000 states: the owner applies only while every two characters can
meet, and locked doors keep them apart. Reported, not done by hand (D12, `docs/dev/passes/3.5.0.md`): the screen
reader, testers, a real phone, Safari offline, recorded voices, a signed tag.

## v3.5.1 "Cue" (5 October 2026): the review's fixes

- The music director plays only the latest request (a slow score no longer replaces the one asked after it; a stop
  cancels a score still loading).
- A browser that does not tell its memory gets stems only for scores of 128 MB decoded at most (`pcmBytes`).
- A proof worker that stops mid-search leaves the pool, and `stats()` has a timeout. The workers table reports the
  peak RSS: 1.2 GB with 4 workers.
- The weight test no longer depends on an earlier `dist`.

## v3.6 "Production" (5 October 2026): the rest of the 3.5.0 review

- `v36-budgets`: weight budgets for the stems (`backgroundScoreKB`), the full offline warm-up (`offlineTotalKB`) and
  the largest score decoded (`decodedAudioMB`), required by a release.
- `v36-stem-probe`: `validate --release` measures the stem files with ffprobe: rate, channels, exact samples, the loop
  inside, `pcmBytes` right.
- `v36-pcm-cache`: the director keeps at most `audio.maxDecodedMB` of decoded audio, least recently played let go; a
  score larger than that plays as its single mix.
- `v36-transitions`: `audio.transitions` (beat, bar, phrase or a marker, a bridge, a crossfade), measured to the
  sample; a save keeps the music's phase and loading resumes there.
- `v36-solver-structure`: the canonical owner pools by group of characters who can meet; a timer leak of 15 MB a
  search fixed; the audit compares live flags; `npm run audit:corpus`, nightly on 500 seeds.

Exit criteria, as measured (BENCH.md "3.6"): every new budget set and held on both games; the stem probe green on
the demo and red on inconsistent files; transitions and the phase to the sample; 900 random games tried, 549 verdicts compared to
the explicit search without a divergence (351 stopped partial, not compared). **Missed again, not blocking:** the open matrix of 20 rooms × 3 characters stays truncated, now at 600 000 states (40 minutes, 7.6 GB): pooling by group proves 12 and 14 rooms, not 20. Reported, not done by hand (D12, `docs/dev/passes/3.6.0.md`): the screen reader, testers, a
real phone, Safari offline, recorded voices, a signed tag, a listening pass.

## v3.6.1 "Audio truth" (5 October 2026): the 3.6.0 review's fixes

- `v361-director-lifecycle`: the director owns what it schedules. A transition not landed yet is a plan that a stop,
  a restore or a new request cancels (no bridge after them); `restore()`; one duck bus under everything it plays;
  every buffer under the cap (a bridge that does not fit is dropped, two scores that do not fit cut, stingers evict).
- `v361-audio-intents`: `play`, `restore`, `stop`. Loading a save restores its music at its point, even when it is the
  one playing, never through a transition; a fallback to the mix keeps the point.
- `v361-budgets-peak`: `transitionPeakMB` (two scores, a bridge and a stinger decoded at once); `validate` refuses a
  rule an earlier one covers and a marker from `'*'` a score lacks.
- `v361-release`: the nightly keeps its counts (tried, compared, partial, diverged) as an artifact; README screenshots
  of 3.6; the corpus claims say "tried" and "compared".

Exit criteria, as measured: the 9 lifecycle cases fail on 3.6.0 and pass; `npm run e2e:music` loads a save while its
score plays on and comes back to within 0.1 s of the saved point. Reported (D12, `docs/dev/passes/3.6.1.md`): the
same human passes, and a signed tag (no key on this machine).

## v3.7 "Field Proof" (5 October 2026): what can be proved without a person

- `v37-own-theme`: the sample game's theme written for the project (Swan Lake's oboe theme, public domain, with its
  own harmony and arrangement): no release exception left, `verify:commercial` green on both games.
- `v37-reference-scores`: the reference market's own score and two bridges; `e2e:music --only=reference` in CI
  (handover, restore before a landing, stop while waiting, the decoded peak under `transitionPeakMB`).
- `v37-corpus-shards`: the nightly corpus in four jobs, added up by a fifth.

Exit criteria, as measured: `npm run verify:commercial` green on the demo and the reference; the reference scenario
green in Chromium (bridge 5.47 s, restore within 0.1 s, peak 130 MB for a budget of 150). Not done, the human part of
"Field Proof" (D12, `docs/dev/passes/3.7.0.md`): an iPhone/Safari and an Android/Chrome pass, VoiceOver or TalkBack,
five external players, Safari offline, recorded voices on a full dialogue, a listening pass on both scores and their
bridges, a signed tag.

## v3.7.1 "Artifact Truth" (5 October 2026): the review of 3.7.0

- `fix/stinger-cap`: a stinger that does not fit beside the score is streamed, never decoded over the cap.
- `fix/dist-inventory`: the build holds this game's files only, with `licenses/`; `npm run verify:dist` accounts for
  every file.
- `fix/playtest-quotas`: `--strict` honest about zero sessions; `verify:field` with its quotas.
- `fix/workflows`: topic branches by kind, releases from the tested SHA and never replaced, exact nightly shards.
- `fix/repo-hygiene`: the README's release line held to `package.json`; no tracked bytecode.
- `feature/player-split` (merged early): zod/mini, minigames on demand, `initialJsKB`, the engine's layers checked.

Exit criterion, as measured: `inventory(dist)` = code + locked assets + named data + fonts + icons + licences, on the
demo (242 files) and the reference (225); the four-shard nightly on 501 seeds of each kind (910 compared, 0 diverged).

## The way to 4.0 (planned with the 3.7.0 review, LOG #91)

- **3.8 "Human Proof"** (shipped 5 October 2026), the machine part: the two-score scenario in WebKit, the field kit (`docs/en/FIELD.md`, near
  misses, `?fps`). The seven human passes stay the maintainer's (D12). No large engine primitive.
- **3.9 "Independence"** (shipped 5 October 2026): the engine as a package (`web-scumm`, `create-web-scumm`, the `web-scumm` command), a game
  outside the repository built from the packed template (The Lighthouse), `npm run fresh-install` in CI.
- **4.0 "Stable Platform"** (shipped 5 October 2026): the public API in four entries with its surface held by a test, a support and
  deprecation policy, the save line of 3.x loaded in 4.x, the independent game moved from 3.9 to 4.0.
- Left to research, not a 4.0 gate: exact dominance on relevant items, the 20 × 3 matrix (a criterion only if a real
  game needs it).

## v4.0 "Stable Platform" (5 October 2026)

- `feature/contracts` (in 3.9): the public API in four entries, its surface and the MCP tools' arguments held by a
  test, `docs/en/API.md`, `docs/en/SUPPORT.md`.
- `feature/upgrade-proof`: `npm run upgrade-check`, a game moved from the previous release with its save, in CI.
- The Lighthouse, moved from 3.9.0 to 4.0.0.

Exit criteria, as measured: `fresh-install` and `upgrade` green in CI; the Lighthouse's `release --commercial` green
on 4.0.0 and its 3.9.0 save played to the end; one save per release from 3.0.0 to 4.0.0 reaching the ending.
Reported, not done (D12): the seven field passes (`docs/en/FIELD.md`), a game by someone else, publishing to npm, a
signed tag, GitHub's immutable releases setting.

## After 4.0 (not planned yet)

- The field passes, then what they find (D12).
- Publishing `web-scumm` and `create-web-scumm` on npm; The Lighthouse in a public repository.
- Translations loaded on demand (the second language is ~10% of the first visit's JavaScript): a change to the game
  module's contract, so a minor with a deprecation, not a patch.
- The open matrix of three characters: exact dominance by the relevance of items and positions, audited against the
  explicit search on the corpus.
- Lip-sync markers in the voice table (left from 3.4).

## Out of scope (explicit decisions)

- No Phaser, no general physics engine (D10). Canvas 2D is allowed from 3.4 as a second scene renderer, the DOM staying
  the reference until they agree; WebGL only for an effect Canvas 2D measurably cannot hold.
- No dialogue format parallel to the DSL.
- No npm package before a second person asks for it (unchanged).

## Verification (every milestone)

1. `npm run validate && npm run solve && npm test && npm run build` green, CI green, asset audit green.
2. The demo uses every new primitive at least once and the e2e goes through it (844 × 390 captures).
3. A save made with the previous version of the demo loads after migration (a unit test on a JSON frozen per milestone).
4. Copy of `src/engine` into the private game: its tests, solver and e2e unchanged.
5. MCP: `npm run -s mcp` lists the updated tools; a fresh AI session adds a script / event to the demo following only CONTENT_GUIDE.
6. Tagged release with notes; the README's "Releases" table updated.
