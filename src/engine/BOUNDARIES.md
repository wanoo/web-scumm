# The engine's layers

What each folder of `src/engine` may import (3.9). `tests/boundaries.test.ts` checks it on every run.

| Layer | Folder | May import | Never |
|---|---|---|---|
| Core | `core/` | itself, plain packages (`zod/mini`) | the DOM, tools, dev, minigames, the Studio |
| Player | `dom/`, `minigames/`, `ending/`, `boot.ts` | core, each other; `tools/i18n` (locales at boot); `tools/replay` and `dev/` only through `import()` | the solver, the validator, the linter, any other tool, the Studio, tweakpane |
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
| `core/engine-shared.ts` | the context of a command, the journal's entry, small helpers |
| `core/types/*.ts` | the content format by subject; `core/types.ts` re-exports every name |

The modules import `Engine` as a type only; `tests/core-runtime.test.ts` calls each directly.

