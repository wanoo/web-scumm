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
