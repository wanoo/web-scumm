# The engine's layers

What each folder of `src/engine` may import (3.9). `tests/boundaries.test.ts` checks it on every run.

| Layer | Folder | May import | Never |
|---|---|---|---|
| Core | `core/` | itself, plain packages (`zod/mini`) | the DOM, tools, dev, minigames, the Studio |
| Player | `dom/`, `minigames/`, `ending/`, `boot.ts` | core, each other; `tools/i18n` (locales at boot); `tools/replay` and `dev/` only through `import()` | the solver, the validator, the linter, any other tool, the Studio, tweakpane |
| Reality | `reality/` (4.1.1) | core, plain packages (`zod/mini`); WebCrypto | the DOM, tools, dev, the Studio, the Bridge (`bridge/`) |
| Tools | `tools/` | core | the DOM (they run in Node, workers and tests) |
| Dev | `dev/` | anything | being imported statically by the player |

The player's first visit is held to `assetBudgets.initialJsKB` (`npm run verify:dist`): the minigames load when one
starts (`minigames/meta.ts` keeps what the tools read of them), the dev panel and the Studio on demand.

No cycle of static imports anywhere in `src/engine` (4.1.0): a module never imports itself back. Types (`import type`)
are erased and do not count.

## Inside the core (4.1.0 "Clarity")

`Engine` (`core/engine.ts`) is the facade: its state, its lifecycle (new game, load, checkpoint) and one forwarding
method per operation, in the same order of effects as before the split. What each operation does lives in a module
of its own, a function taking the engine as its first argument:

| Module | What it does |
|---|---|
| `core/session-runtime.ts` | the session: entries opened and closed, the answers recorded, digests, replay's feed |
| `core/event-runtime.ts` | `emit`: scripts waiting for the event, then the room's listeners, then the game's |
| `core/script-runtime.ts` | scripts: their state, one step, loops, the scheduler |
| `core/interactions.ts` | the rule, kind or fallback that answers an action; lines, hints, the talk loop |
| `core/command-runtime.ts` | `exec` and `step`: running `Cmd`s; where a command points in the room |
| `core/world-queries.ts` | names, kinds, visibility, prop states, targets, approach points |
| `core/players.ts` | several playable characters: who is where, switch, swap, transfer |
| `core/movement.ts` | walking, entering a room, the map and its travel, a teleport (4.1.1) |
| `core/reality-runtime.ts` | a signal from outside: applied at most once, the cursor, the session entry (4.1.1) |
| `core/engine-shared.ts` | the context of a command, the journal's entry, small helpers |
| `core/types/*.ts` | the content format by subject; `core/types.ts` re-exports every name |

The modules import `Engine` as a type only; `tests/core-runtime.test.ts` calls each directly.

## Inside the player (4.1.0 "Clarity")

`App` (`dom/app.ts`) is the `Presenter` and the orchestration: its state, the constructor, the small presenter calls
(walk, pose, music, toast…), the minigame and the ending. The rest lives in modules called through forwarding methods,
as in the core:

| Module | What it does |
|---|---|
| `dom/shell.ts` | the shell's elements, their layout for the screen, the accessible targets |
| `dom/input.ts` | verbs, the inventory bar, taps and double taps (`verbFor`, `nearMiss`), the keyboard, the action line |
| `dom/speech.ts` | lines with their voice, the transcript, phone calls, the choice of responses |
| `dom/map-view.ts` | the map and the travel animation |
| `dom/menus.ts` | title, pause (and the session export, through `import()`), save slots, restart, credits |
| `dom/settings.ts` | the player's preferences, their defaults and menu |
| `dom/update.ts` | the offline warm-ups and status, the update offered after a verified save |
| `dom/storage.ts` | the localStorage autosave and slots (when IndexedDB is missing) |
| `dom/app-shared.ts` | small helpers (element factory, tap timings, the FPS meter) |

## Inside the solver (4.1.0 "Clarity")

`tools/solve.ts` re-exports what it exported before; the solver lives in `tools/solve/`:

| Module | What it does |
|---|---|
| `tools/solve/search.ts` | `solve()`: the frontier, the proof workers, termination and the verdict |
| `tools/solve/expansion.ts` | `makeExpander`: every action worth trying from a state, run on the real engine; the no-op memo |
| `tools/solve/abstractions.ts` | what a state is made of (dimensions), the canonical forms (players, mobility, ownership), dominance |
| `tools/solve/model.ts` | options, `SearchNode`, `Expansion` and a transition (`TryRecord`), with their invariants |
| `tools/solve/report.ts` | the result, its profile, paths as labels and as session entries |

The path of a proof reads `solve()` → `solveOnce()` (search) → `makeExpander()` (expansion) → the engine's `act()` →
a `TryRecord` merged into the frontier → the verdict. No file of `src/` is over 800 lines but the exceptions
`tests/file-size.test.ts` lists with their reason, capped at their size.

