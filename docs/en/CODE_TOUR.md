# Code tour

Half an hour with the code open (4.1.0). Each step names the files to read and the test that shows them at work;
`docs/en/ARCHITECTURE.md` is the same map seen from above. Run the tests of a step with `npx vitest run <file>`.

## 1. Declare a small game

Read `tests/fixtures/classics.ts`: five tiny games after the classics, each a `GameDef` of a few rooms and rules.
A rule is `{ verb, a, b, if, do }`; `do` is a list of commands (`src/engine/core/types/content.ts`, `Cmd`). The
types of a whole game are in `src/engine/core/types/game.ts`. The demo, written the same way but larger, is
`games/demo/`. Test: `tests/classics.test.ts`.

## 2. Compile and freeze it

`compileGame` in `src/engine/core/define.ts` clones the content, fills the defaults, freezes it and gives each rule,
choice, topic, listener and script step a stable id (`src/engine/core/content-ids.ts`). Saves and sessions speak in
those ids, so renaming a line does not break a save. Test: `tests/compile.test.ts`, `tests/stable-ids.test.ts`.

## 3. Start a game

`new Engine(game, layouts, presenter, store)` then `newGame()` (`src/engine/core/engine.ts`). In the tests the
presenter is `FakePresenter` and the store `MemoryStore` (`src/engine/core/ports.ts`); in the browser `App`
(`src/engine/dom/app.ts`) is the presenter and `bootGame` (`src/engine/boot.ts`) wires everything. Test:
`tests/core.test.ts` ("fixture game").

## 4. Run an action

`Engine.act` walks there, opens a session entry and calls `resolve` (`src/engine/core/interactions.ts`): the rule
`findRule` picks, else a kind, else a fallback. Its commands run in `exec` / `step`
(`src/engine/core/command-runtime.ts`); events and scripts in `src/engine/core/event-runtime.ts` and
`src/engine/core/script-runtime.ts`. Each module is called on its own in `tests/core-runtime.test.ts`.

## 5. Save, load and replay

`saveEnvelope` and `parseSave` (`src/engine/core/save.ts`) write and check a save; `migrate`
(`src/engine/core/migrate.ts`) carries an old one forward; `tests/save-v3.test.ts` loads one save per release since
3.0 and plays it to the ending. The session (`src/engine/core/session-runtime.ts`) records every input with a digest
of the state after it; `replay` (`src/engine/tools/replay.ts`) plays it again and names the first entry that differs.
Test: `tests/replay.test.ts` ("a recorded session").

## 6. The same action in the solver

`solve` (`src/engine/tools/solve/search.ts`) takes a state from the frontier; `makeExpander`
(`src/engine/tools/solve/expansion.ts`) runs every action worth trying on a real `Engine`, records each transition
(`TryRecord`, `src/engine/tools/solve/model.ts`) and what it read and wrote; the search merges them and gives its
verdict. What a state is made of for the search is in `src/engine/tools/solve/abstractions.ts`. Tests:
`tests/solver-contract.test.ts`, `tests/memo.test.ts`, and the behaviour of every game frozen by
`tests/quality-baseline.json` (`npm run quality:baseline -- --check`).

## 7. Find the test of a thing

A command: grep its key in `tests/cmds.test.ts` and `tests/core.test.ts`. A layer rule: `tests/boundaries.test.ts`.
The public names: `tests/api-surface.json`. A browser behaviour: the scripts of `scripts/e2e*.mjs` (`npm run e2e`,
`e2e:taps`, `e2e:pwa`, `e2e:a11y`), run by CI in Chromium and WebKit. To change a command end to end, follow the
checklist of `CONTRIBUTING.md`.
