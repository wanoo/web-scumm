# 0002 · Content is data; code a game needs is trusted and named

**Context.** A game must be validated, saved, translated, diffed, edited by the Studio and an assistant, and proved
finishable by a machine. A function inside the content can do none of that.

**Decision.** `games/<id>/` holds data only: the `GameDef` (`src/engine/core/types.ts`) and layouts. What needs code
(a custom command, a minigame) is trusted code beside the content, reached by name, with declared effects the solver
can apply without running it (`src/engine/core/custom.ts`, `src/engine/minigames/`). `compileGame` freezes the data
and gives it stable ids (`src/engine/core/define.ts`).

**Cost.** Some ideas take a custom command instead of three lines of code, and the DSL grows slowly, one primitive
per real need.

**Would change it.** Nothing short of giving up the validator, the solver and the Studio.
