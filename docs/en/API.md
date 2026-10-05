# Public API

Since 4.0 a game, a host page and a game's tests use four entry modules and the `web-scumm` command. Their names are
the contract: `tests/api-surface.json` lists them, `tests/api-surface.test.ts` fails when one changes without this
page, and `docs/en/SUPPORT.md` says how a change is made (announced, then removed at the next major). Everything else
under `src/engine` is internal and may change in any release; the `@engine/*` alias still reaches it, without that
promise.

In a game project the entries are `web-scumm/content`, `web-scumm/player`, `web-scumm/minigames` and
`web-scumm/testing` (the package's `exports`); in this repository the same names resolve to `src/engine/api/`.

## web-scumm/content: writing a game

| Name | What |
|---|---|
| `defineGame` | declares the game (`GameDef`); with `schemaVersion: 3`, compiled and frozen |
| `defineRoom` | declares a room (`RoomDef`) |
| `compileGame` | the compiled, frozen game a host or a tool runs (`defineGame` already calls it for schema 3) |
| `GameSource` · `CompiledGame` | a game as written, and as compiled |
| `EMPTY_LAYOUT` · `FLOOR` · `NEAR` | the layout of a room nobody placed yet, the default floor line, the default "near" distance |
| `GameDef` | the whole game: verbs, characters, items, rooms, rules, audio, skin, budgets, migrations, texts |
| `RoomDef` | a room: backdrop or stage, props, hotspots, actors, exits, reactions, hints, scripts |
| `Id` · `Value` · `Point` | an id, a flag's value, a point of the 640 × 400 scene |
| `Cond` | a condition (`'flag'`, `'!flag'`, `{ has }`, `{ flag, eq }`, `{ not }`, `{ all }`, `{ any }`…) |
| `Cmd` | a command of a reaction or a script (`say`, `set`, `gain`, `goto`, `minigame`…) |
| `Who` · `WalkTarget` · `ListLine` | who speaks, where to walk, a line of a list the engine draws from |
| `Choice` · `TalkTopic` | a dialogue choice, a conversation topic |
| `VerbId` · `VerbDef` | a verb's id, a verb as the interface shows it |
| `Rule` · `KindRule` · `EventRule` | a written reaction, a reaction by kind, a listener on an emitted event |
| `Action` | a player action: verb, a, b |
| `CharacterDef` · `SpriteSet` · `MouthSet` | a character, its poses, its mouths |
| `ItemDef` | an inventory item |
| `PropDef` · `PropAnim` · `ActorDef` · `HotspotDef` · `ExitDef` | what a room holds (each may name the `defaultVerb` of a double tap, 4.0) |
| `HintDef` · `ScriptDef` | a room's hints, a script of the world |
| `StageDef` · `StageLayer` · `LightDef` · `EmitterDef` · `TransitionKind` | the staged room (layers, lights, particles, transitions) |
| `MapDef` · `MapRegion` · `PlaceDef` | the travel map |
| `GameRules` | rules shared by every room |
| `AudioDef` · `ScoreDef` · `ScoreState` | music, sounds, voices; a score's stems and which sound when |
| `EndingDef` | the sealed ending |
| `RevealDef` | **deprecated** (4.0): the old name of `EndingDef`; removed in 5.0 |
| `SkinDef` · `UiTexts` | the interface's images and sounds, its texts |
| `Migration` | one step of save migration (renames, drops) |
| `Layout` | a room's geometry, written by the placement editor |
| `GameState` · `Session` · `SessionEntry` | the state a save holds, a replayable session and its inputs |
| `CustomCommand` · `CustomCommands` · `CustomContext` | a game's own commands (`{ custom }`), the escape hatch, and what they receive |

## web-scumm/player: starting the game in a page

| Name | What |
|---|---|
| `bootGame` | starts the game in the page (`BootOptions`: the game module, the root element, the service worker) |
| `BootOptions` · `SwModule` | its options, the service worker's registration module |
| `Locales` · `pickLanguage` | the translations a game ships, which one a visit gets |
| `openStore` · `StoreOpener` | the save store a page opens (IndexedDB, else localStorage), and how to supply another |
| `SaveStore` · `SlotStore` | the autosave store and the manual slots a host may provide |
| `Presenter` | what the engine asks of a front end (a line said, a choice, a walk, a minigame) |
| `AssetManifest` | `assets.gen.json`: the images, their sizes, the audio files |
| `SceneRenderer` | the painter contract (the DOM and canvas painters implement it) |
| `SpriteSpec` · `LayerSpec` · `OccluderSpec` · `LightSpec` · `EmitterSpec` · `StageSpec` | what a painter is given to draw |

## web-scumm/minigames: minigames as plugins

| Name | What |
|---|---|
| `Minigame` | the contract: `run(ctx)`, and what the validator reads (`required`, `textParams`, `bindings`) |
| `MinigameCtx` | what a minigame is given: its zone, images, sounds, parameters, labels, an abort signal |
| `minigames` | the built-in ones (pipes, stroke, pick, hide, runner, scratch, cables), each loaded when it starts |
| `MINIGAME_CSS` | their shared style |

A game adds its own in its module's `minigames` (same contract): that is the plugin format.

## web-scumm/testing: a game's own tests

| Name | What |
|---|---|
| `Engine` | the engine without a page |
| `FakePresenter` · `MemoryStore` | a front end that answers by script, a save store in memory |
| `solve` · `SolveOptions` · `SolveResult` | the solver: a way to the end, softlocks with `prove` |
| `parseSave` · `saveEnvelope` · `SaveEnvelopeV3` | a save's envelope: write it, read it back (migrations applied) |

## Beside the modules

- **Authoring schema**: `schemaVersion: 3` in `defineGame`; `web-scumm migrate` brings an older game to it.
- **Saves**: the envelope `web-scumm-save` schema 3; every save of the 3.x line loads in 4.x (`tests/save-v3.test.ts`
  keeps one per release).
- **Studio and MCP**: the tools of `npm run mcp` are described by their schemas (`docs/en/MCP.md`); their names and
  their required and optional arguments are in `tests/api-surface.json` (`mcp`): a tool removed or a required argument
  added is an API change like any other.
- **Command line**: `web-scumm <command>` and its options (`docs/en/PACKAGE.md`).
