# Contributing to web-scumm

Use Node.js 22 or newer. Asset tests also need Python 3 with `requirements.txt`; audio authoring needs ffmpeg. Run `npm run doctor` for an exact local report.

Before opening a pull request:

1. Keep gameplay declarative in `games/<id>/`; geometry belongs in `layout/*.json`.
2. Add stable IDs to all schema-v3 rules, choices, topics, listeners, persistent blocks and script steps.
3. Run `npm run quality` (Biome formatting and lint, TypeScript with `tsconfig.json` and with every index access
   checked in `src/` by `tsconfig.strictest.json`, the content lint), `npm run check`, `npm run test:assets`, and
   `npm run verify:game`. `npm run format` writes the formatting; a change that only reformats is its own commit,
   listed in `.git-blame-ignore-revs`. A game's content (`games/`) is linted, never reformatted: the Studio writes it.
4. For browser or visual changes, run the production build and `npm run e2e:smoke -- http://127.0.0.1:5173/`; inspect the screenshots.
5. Never add private source assets or material with unclear commercial rights.

Keep changes small and include a regression test for bug fixes. Public DSL, save and plugin contracts follow SemVer from v3 onward; internal modules are not compatibility promises unless documented otherwise.
