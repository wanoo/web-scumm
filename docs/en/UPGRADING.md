# Upgrading a game from v2 to v3

*French version: [docs/fr/UPGRADING.md](../fr/UPGRADING.md). What v3 is and why: `docs/en/ROADMAP.md`, the v3 section;
the detailed changes: `CHANGELOG.md`.*

v3 breaks v2 on purpose (decision D1 in `docs/dev/DECISIONS.md`): the content schema gains stable ids, the save gets an
envelope and a verified store, the solver gets a proof mode with honest exit codes, the dev server stops listening on
the network by default. A v2 game keeps running on v3 as "legacy v2 content" during the beta; this page is the list of
what to do to be a v3 game, in the order that costs the least.

## 1. Nothing to do: what migrates on its own

- **Autosaves.** The first launch on v3 reads the v2 autosave from `localStorage`, writes it to IndexedDB inside a
  v3 envelope, verifies the copy, then removes the old key. Manual slots and exported files are read in both formats.
- **Stale references.** A save that names a room, prop, item, script or place the content no longer has is pruned,
  not refused: the player keeps Continue, the game shows one toast (`ui.saveAdjusted`) listing what was dropped. Only
  structural corruption and an unknown *current* room or active player reject a save.
- **Persistence keys of `once` / `nth` / `cycle` / `random`.** Without an `id`, the key is still the command's position,
  as in v2, so v2 saves keep their counters.
- **The solver's witness.** `npm run solve` finds the same path as v2 (the private reference game: 59 actions, 355
  states, 0.3 s in both).

## 2. Scripts and commands

| v2 | v3 |
|---|---|
| `npm run dev` listens on the network | `npm run dev` listens on 127.0.0.1; `npm run dev:lan` / `studio:lan` for the phone, with a one-session token printed at start (`?token=…` on the Studio and editor URLs) |
| `npm test` runs everything | `npm test` = Node tests; `npm run test:assets` = the Python-backed image tests; `npm run check` = tsc + Node tests |
| `npm run build` = tsc + tests + vite | `npm run build` = `check` + `test:assets` + `verify:game` (validate, solve, `--chapters`, i18n status) + vite + spoilers + asset audit. The exhaustive proof is `npm run prove:game` (`--prove`, `--prove --chapters`), run by `release-check`, never by `build` |
| `npm run audit` | `npm run audit` (assets and private names) + `npm run audit:deps` (npm audit, production deps) |
| — | `npm run doctor`: Node, Python, ffmpeg, Playwright browsers, with the fix for each |
| — | `npm run e2e:smoke` (generic solver walkthrough on a production build), `npm run e2e:pwa` (service worker installs, the game opens offline), `npm run release-check` |

**Solver exit codes.** `0` solved (and no broken invariant), `1` unsolved, softlocks found, errors or a broken
invariant, `2` truncated (the state budget ran out before the answer). `npm run solve -- --json` gains `status`,
`mode`, `softlocks`, `assumptions`. The human output gains one line after the verdict, `Witness status: …` or
`Proof status: …`; everything else is unchanged, scripts that read it keep working.

**Proof mode.** `npm run solve -- --prove` explores the whole reachable graph and lists the states from which the
ending can no longer be reached. It is exhaustive, so it is expensive on a big game (see `docs/en/BENCH.md`), and the
partial-order reduction is off in that mode: give it `--max=<states>` and run it where you can afford it.

## 3. The content: `schemaVersion: 3`

A v3 game declares `schemaVersion: 3` in `game.ts`. From then on `npm run validate` requires a **stable id** on
everything that is persisted, translated or named by the tools, and refuses duplicates:

| Where | Field | Used by |
|---|---|---|
| a rule in `on` (room or game) | `id` | saves, the puzzle graph, the solver's heatmap (`rule:<id>`) |
| a `choice` option | `id` | `once` choices in saves, translations, voice files |
| a talk topic | `id` | `seen` topics in saves, translations |
| a listener in `events` | `id` | `once` listeners in saves |
| `once` / `nth` / `cycle` / `random` | `id` | their counters in saves (v2 `key` still read, deprecated) |
| a script | `stepIds: [...]`, one per command of `do` | a save resumes at the named step after you reorder the script |

The ids are free strings, unique across the game; `games/_template` shows a naming (`start.take-bucket`,
`start.first-arrival`). The engine, the solver and the puzzle graph name a rule by its id when it has one, by its
position otherwise (`src/engine/core/content-ids.ts`), so a game can migrate room by room.

What this buys: a save survives reordered rules, reordered or translated topics and choices, and reordered script
steps; the Studio and the translation tables name the same thing by the same id.

**Migrations.** `migrations[]` gains `renameCounter`, `renameSeen`, `renameScript`, `renameScriptStep`,
`renamePlayer`, `renameCharacter`, `dropCounter`, `dropSeen`, `dropScript`, for the keys the stable ids introduce.

**Texts.** New `ui` keys, with English defaults when absent: `saveFailed`, `saveAdjusted`, `updateAvailable`,
`updateNow`. The translation tables (`npm run i18n -- extract`) gain the verbs (`verb:<id>/label`, `/join`) and the
minigames' player-visible params (`….params.intro`, `….params.rounds[0].prompt`…); a custom minigame declares its own
with `textParams`.

## 4. A game that embeds the engine (a copy of `src/engine`)

Besides copying `src/engine/`, update your own entry and config:

- `src/main.ts`: open the store with `IndexedDbSaveStore.open(game, onError)` and pass it to `App` (fallback to the
  verified `localStorage` adapter when IndexedDB is unavailable); call `app.reportStorageError` on errors; register
  the service worker yourself with `registerSW({ immediate: true, onNeedRefresh })` and `app.offerUpdate(...)`, because
  the PWA plugin now uses `registerType: 'prompt'` and `injectRegister: false` (the update waits for a verified save
  instead of reloading under the player); pass the minigames to `applyLocale(game, table, minigames)`.
- `vite.config.ts`: `server.host` is `127.0.0.1` unless `WEB_SCUMM_LAN=1`; the layout writer and every `/__studio`
  route go through `authorizeStudioRequest` (`tools/studio/security.ts`); the PWA options above.
- `package.json`: the scripts of section 2 (`tools/doctor.ts`, `tools/serve.ts`, `scripts/e2e-pwa.mjs`).
- Your e2e: `scripts/e2e/lib.mjs` takes `E2E_BROWSER=chromium|webkit|firefox` and `--prod` (no `?dev`, no debug layer).
- Your `tsconfig`/`env.d.ts`: `/// <reference types="vite-plugin-pwa/client" />`.
- The engine's `game` is now a compiled clone (`compileGame`), frozen when `schemaVersion` is 3: a tool that mutated
  the object it passed to `Engine` and expected the engine to see it must go through the engine's own API.

## 5. Check

```bash
npm run doctor
npm run check && npm run test:assets
npm run verify:game            # validate, solve, chapters, i18n status
npm run build                  # then: npm run preview, and npm run e2e -- http://127.0.0.1:4173/ --prod
npm run prove:game             # the exhaustive proof, when you can afford it (release-check runs it)
```

For a long game, run `--prove` on a chapter at a time (`--prove --chapters`) before running it on the whole game.
