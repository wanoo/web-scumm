# Surviving mutants, explained

`npm run test:mutation:core` (`tools/mutate.ts`, 4.1.0 "Clarity") mutates the code a save, a session, a condition
and a migration rest on, and runs the tests that judge it against each mutant. Measured on 2026-10-06: **340 of 348
mutants killed**; the 8 below survive because no input the engine can receive tells them from the original. A new
survivor that is not on this list is a missing test.

| Where | Mutant | Why it is equivalent |
|---|---|---|
| `core/save.ts` `props` pruning, `const r = cut > 0 ? …` | `cut > 0` → `true` | Alone, the next line still reads `cut > 0` for the prop and finds none: the key is dropped either way. Mutating both lines together is killed (`critical-save`, "a prop or actor key without its room"). |
| same line | `>` → `>=` | Differs only for a key starting with a dot (`.x`), whose room part is `''`: no room has an empty id (the validator refuses it). |
| `core/save.ts` `props` pruning, `const p = cut > 0 ? …` | `cut > 0` → `true` | Alone, `r` is undefined for a key without a dot, so `p` is too. |
| same line | `>` → `>=` | As above: only for a room id `''`. |
| `core/save.ts` `actors` pruning | `>` → `>=` | As above: only for a room id `''`. |
| `core/migrate.ts` room prefix, `if (i < 0)` | `<` → `<=` | Differs only for a key starting with a dot: its room part `''` is never in `renameRoom`. |
| `core/migrate.ts` script steps, `if (st.step)` | → `true` | With no step, `renameScriptStep[id][undefined]` is looked up and is undefined, so `st.step` stays undefined. |
| `core/migrate.ts` players, `s.active ? …` | → `true` | With no active player, `renamePlayer[undefined]` is undefined and the value stays undefined. |

Stryker was tried first: with Vitest 5 its mutants were never activated (739 of 749 survived, a function emptied
included), so the score meant nothing; `tools/mutate.ts` writes each mutant into the source, runs
`vitest.mutation.config.ts`, and restores the file.
