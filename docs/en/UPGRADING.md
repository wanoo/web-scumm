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
`<game>.save` localStorage autosave once and removes it only after a verified write. Manual slots remain importable.

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

**New `ui` keys** (English defaults when absent): `saveFailed`, `saveAdjusted`, `updateAvailable`, `updateNow`.

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
