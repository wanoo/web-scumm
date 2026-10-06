# Architecture

How web-scumm is put together, for someone reading its code for the first time (4.1.0). `docs/en/CODE_TOUR.md` is
the same map walked in order, half an hour with the code open; `docs/dev/adr/` explains the decisions that look
surprising without their context.

## The layers

```text
games/<id>/          content: data only (rooms, rules, lines, layouts, assets)
   │ defineGame / compileGame
   ▼
src/engine/core/     the engine: state, rules, commands, scripts, sessions, saves — no DOM, runs anywhere
   ▲            ▲
   │            └──── src/engine/tools/   validator, solver, replay, lint, weight, provenance (Node, workers, tests)
src/engine/dom/      the player: App (the Presenter), the room view, audio, input, menus, offline
src/studio/, tools/  the Studio (browser UI, its server and MCP), the command line
```

What each folder may import is written in `src/engine/BOUNDARIES.md` and checked by `tests/boundaries.test.ts`:
the core imports neither the DOM nor the tools; the player never imports the solver, the validator or the Studio
statically; the tools never import the DOM; no cycle of static imports anywhere. The public API is the four entries of
`src/engine/api/` (`docs/en/API.md`); everything else is internal and may move between minor versions.

## A game is data

A game is a `GameDef` (`src/engine/core/types.ts`, split by subject in `src/engine/core/types/`): rooms, verbs,
items, characters, rules (`{ verb, a, b, if, do }`), scripts, listeners, dialogues, a map, an ending. There is no
function in it, so it can be validated (`src/engine/tools/validate.ts`), saved, diffed and solved. Code a game needs
(a custom command, a minigame) is trusted code declared beside the content and reached by name (`core/custom.ts`,
`src/engine/minigames/`). `compileGame` (`src/engine/core/define.ts`) freezes the content and gives every rule,
choice, topic, listener and script step a stable id: saves, sessions and the solver speak in those ids.

## The life of an action

1. **Input.** A tap on the scene or the inventory (`src/engine/dom/input.ts`) becomes an `Action` `{ verb, a, b }`; a
   double tap picks the verb a player means (`src/engine/core/default-verb.ts`).
2. **Engine.** `Engine.act` (`src/engine/core/engine.ts`) walks the hero there, opens a session entry
   (`core/session-runtime.ts`) and asks `resolve` (`core/interactions.ts`) for the answer: a written rule, else a
   kind, else a refusal or a fallback line.
3. **Commands.** The rule's `do` list runs through `exec` (`core/command-runtime.ts`), one `Cmd` at a time: set a
   flag, give an item, say a line, walk, play a sound, emit an event (`core/event-runtime.ts`), start a script
   (`core/script-runtime.ts`). Every effect on screen is a call to the `Presenter` (`src/engine/core/ports.ts`).
4. **State.** Commands only change `engine.state`, a `GameState` (`core/types/state.ts`) of plain JSON: room,
   inventory, flags, props, counters, what was seen.
5. **Autosave.** When the engine is idle again, `Engine.save` hands the state to the `SaveStore`: in the browser
   `IndexedDbSaveStore` (`src/engine/dom/save-store.ts`), which writes a versioned envelope (`core/save.ts`) and reads
   it back before saying it is saved.
6. **Render.** `App` (`src/engine/dom/app.ts`) is the `Presenter`: the room view (`dom/room.ts`, painted by the DOM
   or, on demand, Canvas renderer), speech (`dom/speech.ts`), the inventory, music (`dom/director.ts`, `dom/audio.ts`).

## Trusted content, untrusted input

Content and engine code are trusted; everything that comes from outside is not and starts as `unknown`: a save
(`parseSave`, a zod schema), a session file (`parseSessionFile`), a storyboard (`storyboardProblems`), a layout
import, an assistant provider's response, a Studio request (`tools/studio/security.ts`). The same invalid input gives
the same diagnostic in the command line, the Studio and the MCP (`tests/diagnostics-parity.test.ts`).

## Storage, sessions and replay

Saves are envelopes `{ format, schema: 3, gameId, gameSaveVersion, state }`; an old save is migrated by the game's
`migrations` (`core/migrate.ts`) and one save per release since 3.0 is loaded by `tests/save-v3.test.ts`. Every input
is also an entry of the engine's **session**, with the answers given while it ran (choices, random draws) and the
digest of the state after it: `replay` (`src/engine/tools/replay.ts`) plays a session again and names the first entry
whose state differs. A bug report is a session file.

## The solver runs the real engine

`solve` (`src/engine/tools/solve/`) explores the game from "New game" with the same `Engine` and a silent presenter
(`FakePresenter`): whatever it finds, a player can do. A witness search finds one path to the ending; a proof explores
every reachable state and names the softlocks. The search keys a state only on what can still matter
(`solve/abstractions.ts`); each abstraction is audited against the explicit search (`--audit-abstractions`, the
corpus of `npm run audit:corpus`). The path from `solve()` to a verdict is in `src/engine/BOUNDARIES.md`, "Inside the
solver".

## Public and internal

Public: `web-scumm/content` (the types and `defineGame`), `web-scumm/player` (boot), `web-scumm/minigames`,
`web-scumm/testing` (`Engine`, the fakes, the save envelope, `solve`), the content format, the save envelope and the
MCP tools, held by `tests/api-surface.json` and `docs/en/SUPPORT.md`. Internal: the modules behind the
`Engine` and `App` facades (their members marked `@internal`), the solver's modules, the tools' code.
