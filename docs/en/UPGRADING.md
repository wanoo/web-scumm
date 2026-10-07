# Upgrading a game from v2 to v3

v3 deliberately breaks the authoring contract once so saves can become durable afterwards. Migrate on a branch, keep
a representative v2 save, and do not change prose or reorder content until the ids below have been assigned.

## 1. Establish the baseline

On the last v2 commit, export saves at important checkpoints and keep one complete session. Record:

```bash
GAME=<id> npm run validate
GAME=<id> npm run solve
GAME=<id> npm test
```

Do not commit private game material or exported player saves to this public repository.

## 2. Opt into the v3 schema

Add `schemaVersion: 3` to `defineGame({...})`. `compileGame` clones and normalises the source; the compiled v3 value is
frozen, so integrations must not rely on `engine.game === source` or mutate it after construction.

Let the tool write the ids, then review them:

```bash
npm run ids                  # dry run: what would be written, what must be done by hand
npm run ids -- --write --map # writes the ids into rooms/*.ts, rules.ts, game.ts; renames locales/*.json keys;
                             # writes ids.migration.json (renameSeen / renameCounter) and ids.paths.json
```

It names things after their content (`house.open-pantry`, `house.grandma.where-is-the-key`,
`house.open-pantry.once`, `clock.wait`), uniquely across the game, deterministically. What it needs on every room
and game `Rule`, `TalkTopic`, `Choice`, `EventRule`, `once` / `nth` / `cycle` / `random` block: an `id`; on every
script: one `stepIds` entry per top-level command. Lists built by code (a spread, a `.map(...)`) are skipped and
reported with the id the engine expects: add it in the generator. Then the three lines by hand in `game.ts`:
`schemaVersion: 3`, `saveVersion` + 1, `migrations: [idsMigration]` with `import idsMigration from
'./ids.migration.json'`. `npm run validate` refuses a v3 game with a missing or duplicate id; `npm run ids` can run
again at any time (it never renames twice). Generated exit rules receive deterministic ids automatically.

## 3. Migrate saves deliberately

The browser stores a `web-scumm-save` envelope with schema 3 in IndexedDB. The first v3 run imports the legacy
`<game>.save` localStorage autosave once and removes it only after a verified write. Manual slots (`saves.slots`) live
in the same database, as envelopes, verified the same way; the v2 `<game>.slot.<n>` entries are imported once too. A
file imported from the save menu also lands in the first free slot.

Increase `saveVersion` for a state change and supply one `Migration` per integer step. Besides v2 fields, v3 supports:

```ts
migrations: [{
  from: 2,
  renameCounter: { 'house:on3.0': 'pantry.first_open' },
  renameSeen: { 'topic.house/grandma[0]': 'topic.grandma.ask_key' },
  renameScript: { old_clock: 'clock' },
  renameScriptStep: { clock: { 'step.1': 'chime' } },
  renamePlayer: { kid: 'laverne' },
  renameCharacter: { old_grandma: 'grandma' },
  dropCounter: ['temporary_gag'],
  dropSeen: ['removed_choice'],
  dropScript: ['removed_patrol'],
}],
```

Map positional v2 counter/topic/script keys only when the old content and its meaning are known. There is no universal
safe conversion after content has already been reordered or translated. An unmapped stale optional reference is
pruned with a player-visible warning; malformed JSON, a foreign game, a missing current room or an unknown active
player is rejected without replacing the current session.

## 4. Update translations and minigames

In v3 the translation paths name things by id (`room:house/on.house.open-pantry.do[1]`, `talk.grandma.<id>.topic`,
`.choice.<id>.text`, `events.<id>.do`); `npm run ids -- --write` renamed the existing tables (`ids.paths.json` holds
the map). Run `npm run i18n -- extract --lang <xx>` for every shipped language. v3 also extracts verb labels/join words and the
text paths declared by each minigame's `textParams`. Then run `npm run i18n -- status` and translate every new entry.

Custom minigames should declare `required` and `textParams` so validation and translation tools understand their
parameters. Asset ids keep the existing `sheet/cell` convention and are discovered by the asset tools.

## 5. Update development and CI commands

- `npm run dev` and `npm run studio` are loopback-only.
- Use `dev:lan` / `studio:lan` for a phone and open the printed token URL.
- `npm test` is the Node suite; `npm run test:assets` is the Python-backed asset suite.
- `npm run build` requires validation and a winning witness, but not an unbounded state-space proof.
- `npm run prove:game` proves global and chapter state graphs and fails on softlocks or truncation.
- `npm run release-check` includes prerequisites, build, exhaustive proof and dependency audit.

Do not enable a partial-order reduction in proof mode until equivalence with the reference exploration is demonstrated
for the relevant game class.

## 6. Verify the migrated game

```bash
GAME=<id> npm run doctor
GAME=<id> npm run build
GAME=<id> npm run prove:game
GAME=<id> npm run e2e -- http://127.0.0.1:5173/ --prod
```

Load every representative v2 save and verify its room, active player, inventories, persistent choices and script step.
Reorder one rule, topic, choice and script step in a test fixture; the same v3 save must retain its meaning. Finally,
test the production PWA online, offline in a room never visited (`npm run e2e:pwa` does it), and through an update.
The whole game is cached after the first visit unless the game says `offline: 'nearby'` (decision D5).

## 7. At a glance

**What migrates on its own.** The v2 autosave is imported into IndexedDB on the first v3 launch and verified before
the old key goes. A save that names something the content no longer has is pruned with one toast (`ui.saveAdjusted`),
never refused. Without an `id`, a `once` / `nth` / `cycle` / `random` block keeps its positional v2 key, so v2 counters
survive. The solver's witness is unchanged (the private reference game: 59 actions, 355 states, 0.3 s on both).

| v2 | v3 |
|---|---|
| `npm run dev` listens on the network | `npm run dev` listens on 127.0.0.1; `npm run dev:lan` / `studio:lan` print a one-session token URL for the phone |
| `npm test` runs everything | `npm test` = Node tests; `npm run test:assets` = the Python-backed image tests; `npm run check` = tsc + Node tests |
| `npm run build` = tsc + tests + vite | `npm run build` = `check` + `test:assets` + `verify:game` (validate, solve, `--chapters`, i18n status) + vite + spoilers + asset audit |
| — | `npm run prove:game` = `--prove` and `--prove --chapters`, the exhaustive softlock gate, run by `release-check`, never by `build` |
| `npm run audit` | `npm run audit` (assets, private names) + `npm run audit:deps` (npm audit, production deps) |
| — | `npm run doctor`, `npm run e2e:smoke`, `npm run e2e:pwa`, `npm run release-check` |

**Solver exit codes.** `0` solved and no broken invariant; `1` unsolved, softlocks, errors or a broken invariant;
`2` truncated. `--json` gains `status`, `mode`, `softlocks`, `assumptions`; the human output gains one line after the
verdict (`Witness status:` / `Proof status:`), everything else is unchanged.

| Where | Field | Used by |
|---|---|---|
| a rule in `on` (room or game) | `id` | saves, the puzzle graph, the solver's heatmap (`rule:<id>`) |
| a `choice` option | `id` | `once` choices in saves, translations, voice files |
| a talk topic | `id` | `seen` topics in saves, translations |
| a listener in `events` | `id` | `once` listeners in saves |
| `once` / `nth` / `cycle` / `random` | `id` | their counters in saves (v2 `key` still read, deprecated) |
| a script | `stepIds`, one per command of `do` | a save resumes at the named step after a reorder |

**New `ui` keys** (English defaults when absent): `saveFailed`, `saveAdjusted`, `updateAvailable`, `updateNow`, `advance`, `offlineStatus`, `offlineComplete`, `offlineRetry` (3.1.1: the pause menu's offline row)
(3.1, the "tap to continue" marker for screen readers), `shareSession` (3.1, the playtest row of the pause menu).

## 8. A game that embeds the engine (a copy of `src/engine`)

Your `src/main.ts` no longer copies the bootstrap: it calls `bootGame` (`src/engine/boot.ts`) and says only what is
specific to your build:

```ts
import { bootGame } from '@engine/boot';
import { game, layouts, manifest, minigames, commands, locales } from '@game';

void bootGame({
  game, layouts, manifest, minigames, commands, locales, version: __ASSETS_VERSION__,
  dev: { enabled: (q) => import.meta.env.DEV && (q.has('dev') || q.has('edit')) },
  sw: { register: () => import('virtual:pwa-register') },   // or `sw: false` without vite-plugin-pwa
});
```

`bootGame` picks the language (`?lang=`, the player's saved choice, the browser), waits for the fonts, opens the
verified IndexedDB store (its early errors reach the App once it exists; without IndexedDB the verified
`localStorage` adapter takes over), builds the `App`, exposes `window.__game` for the e2e drivers, starts the dev
tools when `dev.enabled` says so (`dev.patch` can replace the game, the layouts and the store first, as the Studio
demo does), shows the title, and registers the service worker through the module you inject, with the update offered
only after a verified save. The pieces are exported on their own (`pickLanguage`, `waitFonts`, `openStore`) when a
game needs a different order.

What else your build keeps: `vite.config.ts` with `server.host` on `127.0.0.1` unless `WEB_SCUMM_LAN=1`, the layout
writer and every `/__studio` route behind `authorizeStudioRequest` (`tools/studio/security.ts`), and VitePWA with
`registerType: 'prompt'`, `injectRegister: false`, `skipWaiting: false` (mandatory with the update prompt);
`package.json` with the scripts of section 7 (`tools/doctor.ts`, `tools/serve.ts`, `scripts/e2e-pwa.mjs`);
`scripts/e2e/lib.mjs` (`E2E_BROWSER`, `--prod`; a script that reads the human output of `npm run solve` keeps working);
`env.d.ts` with `/// <reference types="vite-plugin-pwa/client" />`. The engine's `game` is a compiled clone
(`compileGame`), frozen when `schemaVersion` is 3: a tool that mutated the object it passed to `Engine` must go
through the engine's API.

## 9. Line ids (3.2): translations and voices that survive an insertion

Every `say`, `toast` and `guide` can carry a stable `id` (`house.open-door.l-just-a-door`: its owner, then the
start of its text). A translation table and a voice clip are then keyed by it: inserting, moving or deleting a line
never shifts the others. `npm run ids -- --lines --write --map` gives the ids to the objects that lack them and renames
the keys of `locales/*.json` (a second pass renames from the current paths, nothing already recorded in
`ids.migration.json` / `ids.paths.json` is lost); `--lines=all` first turns every plain string line into
`{ say: ['hero', text], id }`: required for a game that ships a language other than its own (`game.lang`, default
`en`) or has voices; the sample game did it in 3.2.1. `audio.voices[<line id>]` plays without writing `voice` on the
line. `npm run validate -- --release` reports a line without an id (an error, plain strings included, in a translated
or voiced game: run `--lines=all` once; a warning otherwise);
`npm run i18n -- voices` lists the lines with an id and no clip, and the clips no line claims.

## 10. List lines (3.3): looks, hints, fallback answers and reactions by kind

The lines the engine draws from a list (a look list, a hint's lines, `rules.fallbacks.<verb>`) can be `{ id, text }`
instead of a plain string, a hint can carry an `id`, and so can a reaction by kind (`rules.kinds[i]`). Their
translations are then keyed by the id (`room:house/look.pantry.<id>`, `room:house/hints.<hint id>.lines.<id>`,
`item:key/look.<id>`, `rules/fallbacks.look.<id>`, `rules/kinds.<id>.say`), and `audio.voices[<id>]` voices them.
`npm run ids -- --lines=all --write --map` converts the plain strings of lists in `rooms/*.ts`, `items.ts`,
`rules.ts` and `game.ts`, names hints and kinds, and renames the keys of `locales/*.json` (`--lines` alone only adds
ids to the objects that have none). A single look line (`look: { door: '…' }`) is keyed by its owner already and
stays a string. A translated or voiced release requires them, like `say` lines (`validate -- --release`). The Studio
edits a `{ id, text }` line at the same path as a plain one (`look.pantry[1]`). The sample game: 109 ids, 91
translation keys renamed per language, French still 400/400.

## 11. The stage (3.4): nothing to rewrite

A room's `decor` is its backdrop layer and its layout's `walk` is the walk zone `main` (`stageOf`, src/engine/core/
stage.ts): an old room keeps its picture (`npm run e2e:visual`) and its saves (a stage adds nothing to the state).
Layers, occluders, lights, particles, several walk zones and their links are added when a room needs them (CONTENT_GUIDE
"The stage"). A layout with both `walk` and `walkZones` keeps the zones (`validate` warns).


## 10. From 3.x to 4.0

4.0 changes no format: the authoring schema stays 3, the save envelope stays schema 3, and every 3.x save loads.
What changes is what is promised (`docs/en/SUPPORT.md`):

1. **Import from the public API.** `web-scumm/content` (`defineGame`, `defineRoom`, every content type),
   `web-scumm/player` (`bootGame`, `AssetManifest`), `web-scumm/minigames` (`Minigame`), `web-scumm/testing` (`Engine`,
   `solve`, `parseSave`…). The `@engine/*` paths keep working but are internal. In a game of this repository:
   `sed -i.bak -E "s#'@engine/core/(types|define|custom)'#'web-scumm/content'#" games/<id>/*.ts games/<id>/rooms/*.ts`, then the others by
   hand (`docs/en/API.md` says which name is in which entry).
2. **A game in its own project** (`docs/en/PACKAGE.md`): `npx create-web-scumm`, move `games/<id>/*` into `game/`,
   `npm install`, `npx web-scumm verify`.
3. **`RevealDef`** is deprecated: use `EndingDef` (removed in 5.0).
4. `npx web-scumm migrate --check` (or `npm run migrate -- --check` here) says whether anything is due.

## 12. From 4.0 to 4.1 "Clarity"

Nothing to change in a game. The content format, the save envelope, the four public entries and the MCP tools are
those of 4.0.0 (`tests/api-surface.json` is the same); `npm install` of the new package is the whole upgrade, and a
4.0 save loads. In this repository: `npm run lint` is now `npm run lint:content` (the alias stays through 4.x), and
`npm run quality` adds Biome and the stricter TypeScript to what CI checks.

## 13. From 4.1.0 to 4.1.1 "Reality Bridge"

Nothing to change: every addition is optional. A game that wants signals from outside declares `reality`
(`docs/en/REALITY.md`), adds scenarios under `reality/scenarios/`, and runs a Bridge (`web-scumm bridge`, or the
package `web-scumm-bridge`). A 4.1.0 save loads; it gets a `reality` state only when a signal is applied.

## 14. From 4.1.1 to 4.1.2 "Reliable Bridge"

Nothing to change in a game. For a Bridge: a 4.1.1 `config.json` still serves and still grants (`grant` reads the
root key from it until `init` writes a `root.key`); behind a reverse proxy, start `serve --trust-proxy` so the limits
per address see the client's address; `doctor` reads the journal, `compact` shrinks it with the Bridge stopped. The
package `web-scumm-bridge` runs on Node alone now (no `tsx`). A 4.1.1 save loads; it gets its player id on the next
signal.

## 15. From 4.1.2 to 4.1.3 "Honest Gates"

Nothing to change in a game or a Bridge. In this repository: `npm test` no longer runs the CPU-bound solver tests
(`npm run test:heavy` does, nightly); `npm run build:game` builds a game without the unit suite; `release-check` is
longer (coverage, the Rust cross-check, mutation of the core). Contributions to `main` go through a pull request.

## 16. From 4.1.3 to 4.1.4 "Honest Engine"

Nothing to change in a game. A host that embeds the engine or the player gains `destroy()` to end them, `onError` to
hear what fails, and `beforeSave` / `onLoad` where it used to replace `store.save` or `engine.load` (do that no
more: the hooks compose). Fallback, kind and give lines may use `{item}`, `{target}`, `{name}`; `{objet}`,
`{cible}`, `{nom}` still work. A 4.1.3 save loads unchanged.

## 17. From 4.1.4 to 4.1.5 "Real Core"

Nothing to change in a game, and nothing in a host that uses the public API: `engine.session`, `begin`, `choose`,
`rand`, `destroy`, the hooks are where they were. A host that reached the engine's `@internal` fields `feed`, `open`
or `sessionT0` finds them on `engine.sessions` (`feed`, `open`, `t0`); one that reached the room view's `toScreen`,
`toLogical`, `setCamera`, `followHero`, `onCamera` or `cam` finds them on `view.camera`, and `walkTo`, `motion` and
`clampFloor` (now `clamp`) on `view.walker`. A 4.1.4 save loads unchanged.

## 18. From 4.1.5 to 4.1.6 "Studio Tool"

Nothing to change in a game. In a checkout, tsconfig.json's `@game` paths look through `.cache/game`, the link `npm run
game` makes (`dev`, `check` and `build` make it too), and fall back to `games/demo` when there is none; a
`package.json` whose `config.game` named a game still counts, after the link and `GAME`. `npm run build` no longer runs the pixel tests (`npm test` and CI
do). `npm run doctor` exits 0 when only Python, ffmpeg or WebKit are missing. `requirements.txt` pins its modules:
`pip install -r requirements.txt` again if yours are older. A 4.1.5 save loads unchanged.

## 19. From 4.1.6 to 4.1.7 "Docs for a Studio"

Nothing to change in a game or a host: 4.1.7 changes documentation, tests and the repository's templates, no code a
game runs. A 4.1.6 save loads unchanged. If you keep a fork of `AGENTS.md`, its rule 14 and the "Working in pairs"
section are gone; `docs/en/TUTORIAL.md` is the page to hand a newcomer.

## 20. From 4.1.7 to 4.1.8 "Foundation Reset"

A 4.1.7 save loads unchanged. A project's `tsconfig.json` written by `create-web-scumm` before 4.1.8 has `baseUrl: "."`
and non-relative `paths`, which TypeScript 7 refuses (TS5102, TS5090): `web-scumm migrate` rewrites it (the same
configuration, said relative to the file; a comment the file had is not kept), `--check` says when it is due. The engine's type checks run on TypeScript 7
(`npm run tsc`); a tool of yours that imports the compiler API (`import ts from 'typescript'`) finds no API in
`typescript@7` and imports `@typescript/typescript6` instead until 7.1 (docs/dev/MIGRATION-4.1.8.md). Vite 8 and
Vitest 5 need Node 22.12 or newer. The service worker claims the page at its first activation (`clientsClaim`), so a
first visit's warm-up fills the caches; an update still waits for the banner, after a durable save. Every name of
`web-scumm/{content,player,minigames,testing,reality}` carries `@public` or `@extension` in `docs/en/API.md`: what
`src/engine` exports without an entry re-exporting it is internal, and about eighty such exports were un-exported or
removed (none of the five entries changed; `tests/api-surface.json` is identical). `npm run doctor -- --release`
requires Python, its modules and ffmpeg; `npm run quality:baseline` writes the READMEs' three figures with the JSON,
so a new test is followed by that command. A signal delivered and not acknowledged is delivered again from the
durable cursor: a custom transport implementing `WorldSignalPort` keeps the acknowledged sequence, not the received
one (`docs/en/REALITY.md`).

## 21. From 4.1.8 to 4.1.9 "Gateways"

A 4.1.8 save loads unchanged; no public name of the five entries moved (`tests/api-surface.json` identical). A game
may declare `reality.connectors` (the words its connectors may propose: optional, validated). The connectors are a
fourth package, `web-scumm-connectors`, installed beside the Bridge on a server, never in the player: `npm run build`
now refuses a game's JavaScript that carries server code (`verify:dist`). `ssh2`'s install script attempts a native
build and fails for lack of headers: no `.node` file results, and `--ignore-scripts` is the documented install
(`docs/en/CONNECTORS.md`). A contributor writes `changes/<slug>.md` instead of editing the CHANGELOG (`changes/README.md`).

## 22. From 4.1.9 to 4.1.10 "Constellation"

A 4.1.9 save, game and Bridge configuration keep working. **The player** accepts `WorldSignalV1` and the new
`WorldSignalV2` (ADR 0010: the signal names its tenant, environment, origin, link and key; `verifySignal` refuses a
V2 signed for another context with `audience-mismatch`, and a `keyId` other than the header's with `key`). A custom
verifier or transport that reads the payload sees `schema: 2` from a multi-tenant Bridge or from the Studio's
simulator, which signs V2 by default (`signalVersion: 1` keeps V1). `verifySignal`'s expectation takes `versions`,
`tenantId`, `environment`, `audience` and `sessionId`; `RealityClient` takes them as `context` and checks the page's
origin by default. **Announced break (4.1.12):** a single-tenant Bridge signs V1 by default during 4.1.10 and
4.1.11 (`init --signal-version=2` opts in); from 4.1.12 every Bridge signs V2 and the player accepts V2 only. A game
on 4.1.10 or later handles both, so upgrade the game before the Bridge.

**The Bridge** reads and writes through `RealityStore` (ADR 0009): code that called `Bridge` methods directly awaits
them now (`startPairing`, `claimPairing`, `revoke`, `forgetPlayer`, `exportPlayer`, `ack`, `unlink`, `subscribe`,
`streamAlive`, `playerOf`); the HTTP routes `/v1/*` are unchanged. `Bridge.start` accepts a 4.1.9 `BridgeStore` (as
the tenant `default`) or a `RealityStore`. The capability is drawn when the player claims its code (the claim also
returns the link's `sessionId`). A 4.1.9 `config.json` serves from its journal as before; `npm run bridge -- migrate
--from=jsonl --to=sqlite` (the Bridge stopped) moves it into SQLite, which needs Node 22.13 (`node:sqlite`).
`--trust-proxy` alone now trusts the loopback only; name other proxies with `--trust-proxy=<addresses or networks>`. **Behind a proxy that is not on the loopback (a PaaS's router, a load balancer on another host), every client now
falls into the proxy's one rate bucket** (60 anonymous requests a minute for everyone) until `--trust-proxy=<its
network>` names it.
Several tenants and several instances: `docs/en/REALITY-OPS.md`.

## 23. From 4.1.10 to 4.1.11 "Viewport"

A 4.1.10 save loads unchanged; the five entries' names are additive (`SceneFrame`, `Renderer`, `Intent` on
`web-scumm/player` as `@extension`; `SemanticEvent`, `SemanticJournal` on `web-scumm/testing`; `Engine.journal`,
`Engine.sessionSeq`). What moved: the page's test hook `window.__game.inventory(…)` is
`window.__game.presenter.inventory(…)` (an e2e script of your own that called it changes one line); a session file now
carries the semantic journal and `npm run replay` exits 1 when the replay's differs (a session longer than 10 000
events is exported with `journalTruncated: true` and no journal); `npm run validate` refuses a layout whose occlusion
mask polygon closes no surface (collinear points, crossing edges) or whose room has a walk zone no link joins, where
4.1.10 accepted it: fix the layout in the Studio's Rooms tab (layers, masks, zones, portals) or by hand. The first
visit's JavaScript is 122 KB gzipped (120 in 4.1.10).
