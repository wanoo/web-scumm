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
  unintended one-way exits (unless `oneWay: true`). `npm run pages -- world`: a clickable graph (DOT / SVG export), also in
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

### M3 — "Picture" (v1.5): staging

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

### M4 — "Cast" (v1.6): several playable characters

Files: `types.ts`, `engine.ts`, state, `dom/app.ts` (inventory, switch button), `solve.ts`, `validate.ts`, `migrate.ts`.

- `GameDef.hero` stays valid (sugar for a single player). New `GameDef.players?: { ids; initial; sharedInventory? }`.
- `GameState.players: Record<Id, { room, inventory, hero: Record<room, Point> }>` + `GameState.active`. The flat
  `room` / `inventory` / `hero` fields become views on the active player (access centralised in `state.ts`). Migration
  provided (`saveVersion` + 1).
- Commands `{ switchPlayer: id }`, `{ transfer: [item, to] }`; condition `{ player: id }`; a switch button in the UI, `ui` texts.
- Solver: switching is an action; the hash includes every player. Validate: an item transferred to a player who can never receive it.
- A dedicated test fixture (see M5); the demo does not need it, a second sample `games/trio` (3 rooms, 2 players) illustrates and tests it end to end.

### M5 — "Open" (v2.0): openness and robustness

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

## Out of scope (explicit decisions)

- No Phaser, no canvas: the DOM Presenter is enough for a few dozen images; a wide room stays a CSS translation.
- No dialogue format parallel to the DSL.
- No npm package before a second person asks for it (unchanged).

## Verification (every milestone)

1. `npm run validate && npm run solve && npm test && npm run build` green, CI green, asset audit green.
2. The demo uses every new primitive at least once and the e2e goes through it (844 × 390 captures).
3. A save made with the previous version of the demo loads after migration (a unit test on a JSON frozen per milestone).
4. Copy of `src/engine` into the private game: its tests, solver and e2e unchanged.
5. MCP: `npm run -s mcp` lists the updated tools; a fresh AI session adds a script / event to the demo following only CONTENT_GUIDE.
6. Tagged release with notes; README "Status" updated.
