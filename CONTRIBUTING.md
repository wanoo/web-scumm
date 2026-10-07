# Contributing to web-scumm

Use Node.js 22.12 or newer. Asset tests also need Python 3 with `requirements.txt`; audio authoring needs ffmpeg. Run `npm run doctor` for an exact local report.

Everyone here follows `CODE_OF_CONDUCT.md`. A pull request starts from `.github/PULL_REQUEST_TEMPLATE.md`; a request for
something new starts from the feature issue template, after `docs/en/CLASSICS.md` (most mechanics are combinations of
what exists).

Before opening a pull request:

1. Keep gameplay declarative in `games/<id>/`; geometry belongs in `layout/*.json`.
2. Add stable IDs to all schema-v3 rules, choices, topics, listeners, persistent blocks and script steps.
3. Run `npm run quality` (Biome formatting and lint, TypeScript with `tsconfig.json` and with every index access
   checked in `src/` by `tsconfig.strictest.json`, the content lint), `npm run check`, `npm run test:assets`, and
   `npm run verify:game`. `npm run format` writes the formatting; a change that only reformats is its own commit,
   listed in `.git-blame-ignore-revs`. A game's content (`games/`) is linted, never reformatted: the Studio writes it.
4. For browser or visual changes, run the production build and `npm run e2e:smoke -- http://127.0.0.1:5173/`; inspect the screenshots.
5. Never add private source assets or material with unclear commercial rights.

Keep changes small and include a regression test for bug fixes. Public DSL, save and plugin contracts follow SemVer from v3 onward, except on the 4.1.8–4.1.15 incubation line (`docs/en/SUPPORT.md`: a break is documented, with a migration); internal modules are not compatibility promises unless documented otherwise.

## Reading the code

Start with `docs/en/ARCHITECTURE.md` (the layers, the life of an action, what is public), then walk
`docs/en/CODE_TOUR.md` (half an hour). `src/engine/BOUNDARIES.md` says what each folder may import and where each
responsibility of the engine, the player and the solver lives; `docs/dev/adr/` explains the decisions that look
surprising. A behaviour-preserving change keeps `npm run quality:baseline -- --check` green: the same witnesses,
proofs, golden saves and public surface. A new test or a lighter bundle is a ratchet: run `npm run quality:baseline`,
which rewrites the JSON and the READMEs' figures with it, and commit them.

## Changing a command, end to end

A command (`Cmd`) is read by the engine, the validator, the solver, the puzzle graph, the texts, the Studio and the
MCP. Touch each in this order, and the type check or a test refuses what you forget:

1. **Type**: the variant of `Cmd` in `src/engine/core/types/content.ts`, with a doc comment.
2. **Catalogue**: its key in `CMD_KEYS` (`src/engine/core/cmds.ts`); in `CHANGES` if it changes the state (the solver
   and the no-op memo read it), in `CONTAINERS` / `subLists` if it holds command lists, in `TEXTS` if it carries a line.
3. **Engine**: its branch in `step` (`src/engine/core/command-runtime.ts`), the screen through a `Presenter` method
   (`src/engine/core/ports.ts`, implemented by `App` and `FakePresenter`), and what it reads and writes recorded
   (`Engine.reads` / `writes`) if it touches the state.
4. **Validator**: its references and values checked in `src/engine/tools/validate.ts`.
5. **Solver and puzzle graph**: nothing to do if the catalogue is right; a command that branches or waits needs a look at
   `src/engine/tools/puzzle.ts` and `src/engine/tools/solve/expansion.ts`.
6. **Texts**: a command carrying a line is walked by `src/engine/tools/i18n.ts` (extraction, locales).
7. **Studio**: its form in `src/studio/schema.ts`; the MCP reads the same schemas (`docs/en/MCP.md`).
8. **Tests**: an example in the table of `tests/cmds.test.ts` (every key must have one), a behaviour test in
   `tests/core.test.ts`, and a validator case.
9. **Docs**: `docs/en/CONTENT_GUIDE.md` and `docs/fr/CONTENT_GUIDE.md`, the CHANGELOG.

**Worked example: `{ shake: ms }`**, the screen shaking for a moment. The type is `| { shake: number }` in
`core/types/content.ts`; `'shake'` is in `CMD_KEYS` but not in `CHANGES` (it changes nothing the solver keys on, so a
shake is a no-op for a proof); `step` calls `ui.shake(ms)` unless a cutscene is being skipped (`core/command-runtime.ts`), which `App` draws with a CSS
animation and `FakePresenter` ignores; the validator accepts it inside a looping animation's frame events, with
`sfx`, and nothing else (`tools/validate.ts`); the Studio offers it as "Shake (ms)", 0 to 5000 (`src/studio/schema.ts`);
`tests/cmds.test.ts` holds `shake: { shake: 2 }`. A review of such a change reads these files in this order.
