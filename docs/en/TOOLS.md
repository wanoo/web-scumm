# Engine tools

All commands are run from the project root.

## Choosing the game (`GAME`)

The repo can hold several games, each in `games/<id>/`. The current game is, in order:

1. the `GAME` environment variable (`GAME=demo npm run dev`);
2. else `package.json` → `"config": { "game": "demo" }`;
3. else `demo`.

The rule is coded once, in `tools/game.ts`, and read by `vite.config.ts` (the `@game` alias → `games/<GAME>/index.ts`,
the editor's layouts written to `games/<GAME>/layout/`), `tools/validate.ts`, `tools/solve.ts`, `tools/refs.ts`; `tools/assets.py` does the same reading in Python.

`tsconfig.json` cannot read an environment variable: `npm run game` (`tools/select-game.ts`) rewrites its two `@game` and `@game/*` paths
to the current game. `npm run dev` and `npm run build` run it first; after a `GAME=… npm run build`, `tsconfig.json` points at that game
(reset to the default game with `npm run game`). Vite and Vitest don't need it: they resolve the alias in `vite.config.ts`.

Tests don't depend on the current game: the engine's tests run on `tests/fixture/` (a tiny game), a game's own tests import
its files directly (`tests/demo.test.ts`, `tests/walkthrough.test.ts`).

## Playing and debugging

```bash
npm run dev        # loopback-only dev server
npm run dev:lan    # explicit LAN mode for a phone; prints a one-session capability-token URL
npm run studio     # loopback-only Studio
npm run studio:lan # token-protected Studio on the LAN
```

URL parameters, dev server only (they are ignored in the production build):

| URL | Effect |
|---|---|
| `/` | The normal game: title screen, New Game / Continue. |
| `/?dev` | Starts on the first checkpoint, with the debug layer and the DEV panel. |
| `/?dev&at=<checkpoint>` | Starts on this checkpoint (defined in the game's `checkpoints`). |
| `/?edit=<room>` | The room's placement editor. |
| `/?edit=<room>&at=<checkpoint>` | Same thing, in that checkpoint's state (useful to place a prop in a given state). |

### The layer and the DEV panel (`?dev`)

- **Layer**, drawn over the scene:
  - clickable zones in blue, props in purple, characters in green;
  - the walkable zone in green, holes (furniture) in red;
  - depth-scale lines in orange, entry points in pink;
  - approach points: filled if set in the layout, hollow if computed.
- **Show or hide the layer**: the **D** key, or the **DEV** button in the bottom left (on a phone).
- **Panel**:
  - current room and "busy" state (a script is running);
  - **Checkpoints**: load a ready state, or start a New Game;
  - **Rooms**: go to any room, without playing its arrival script;
  - **Bag**: check or uncheck an item;
  - **Flags**: edit existing flags, or set a flag name / value (`true`, `false`, a number or text);
  - **Map**: unlock a place, or **Unlock all**;
  - **World**: the room of each moving character (change it to `moveActor` them);
  - **Scripts**: the position of each script in scope (`next command / length`, done, stopped), with a stop / restart button;
  - **Journal**: the last ten entries of the engine's journal (what answered, events, script steps, moves, switches; the Studio's Play tab shows it whole), and **Export session**: the inputs since the game started, for `npm run replay`;
  - **Edit this room**: opens the editor on the room shown.

### The placement editor (`?edit=<room>`)

On start, the editor loads the first checkpoint located in that room. If there is none, it starts from a fresh state, without playing an arrival script. All coordinates are logical (640 × 400).

| Gesture | Effect |
|---|---|
| Drag a zone | Move it, with its approach point. |
| Drag a corner | Resize the zone. |
| Drag a foot point (circle) | Move a prop or a character, with its approach point. |
| Drag the square above the foot, or scroll | Set the height. |
| Drag a small circle (filled or hollow) | Place the approach point: where the hero goes before acting. |
| Drag a vertex of the walkable zone or a hole | Move it. |
| Double-click an edge of the walkable zone | Add a vertex. |
| Alt-click a vertex | Delete it. On a hole reduced to 3 vertices, deletes the hole. |
| Drag an orange depth-scale line | Change its depth (y). The scale factor is set in the panel. |
| Drag a pink triangle | Move an entry point. |

The editor's panel holds:

- **Save the layout**: writes `games/<GAME>/layout/<room>.json`, coordinates rounded to the unit. The page then reloads with the saved file.
- **Reload (undo)**: discards unsaved changes.
- **hidden zones**: also shows zones and props whose visibility condition is false (dashed).
- **Selection**: the touched element and its values.
- **To place**: one button per hotspot, prop or actor defined in the room but missing from the layout. It creates it at the center, ready to be moved.
- **Walkable zone**: create the zone, add a hole.
- **Depth scale**: create the scale, set the back and front factors.
- **Entries**: add an entry point by name (`default` is the one used by default).
- **Room width**: the logical width of a wide room (640 = no scrolling) and a camera slider to look around while placing.

For a prop with a per-state position (`states` in the layout, e.g. a pulled-out stool), the editor edits the variant of the state shown.

Inside the Studio (`/__studio/`, see STUDIO.md) the editor runs in an iframe and talks to the parent page with
`postMessage` (same origin only). It sends `{ source: 'web-scumm-editor', room, type }` messages: `ready` (with
`missing`, the entities that have no place yet), `select` (`key` such as `prop:lamp`, `hs:door`, `actor:grandma`, plus
`kind` and `id` for those three), `dirty` (unsaved changes) and `saved` (`ok`, `error`). It accepts
`{ source: 'web-scumm-studio', type }` messages: `select` (`kind`, `id`), `create` (gives a place to an entity the
room declares but the layout lacks, optionally at `at`) and `save`. In an iframe its panel starts folded.

## Preparing images and sounds

Before `npm run assets`, a generated sheet is cut into keyed sprites with `tools/cut-sheet.py <sheet.png> <sheet-id>`
(and the tools `tools/talk-kit.py`, `tools/talk-apply.py`, `tools/talk-normalize.py` for talking mouths):
see `docs/en/PROMPTS.md`. The prompts themselves come from `npm run prompts` (`--missing` for the sheets not cut yet),
which writes `games/<id>/prompts.md`. With `"artStyle": "pixel"` in `site.json` (or `--pixel`), the cutter also
scales each cell down 4× (`--scale`), limits it to 32 exact colours (`--colors`) and writes indexed PNGs; `npm run
assets` then writes lossless WebP (see PROMPTS.md, "Art style").

```bash
npm run prompts    # one ready-to-paste prompt per sheet + the cut commands → games/<id>/prompts.md
npm run assets     # prepares in public/assets/ the images and sounds cited by the content
```

`tools/refs.ts` lists the images and sounds cited by the content (rooms, characters, items, the map, minigame parameters, `skin`,
the title and credits screens, `ending.scratch`, and `index.ts`'s `extraImages`), then `tools/assets.py` prepares them.
The command writes `games/<GAME>/assets.gen.json` and only reprocesses what changed.

A game's default sources:

| What | Source | Output |
|---|---|---|
| image `sheet/cell` | `games/<id>/art/sheet/cell.png` | `public/assets/img/sheet/cell.webp` (cropped, 420 px at most) |
| decor `decor/<name>` | `games/<id>/art/decor/<name>.png` | `public/assets/img/decor/<name>.webp` (1280 × 800) |
| video | `games/<id>/art/decor/<name>.mp4` | `public/assets/video/<name>.mp4` (720p, muted) |
| music, sfx | `games/<id>/audio/music/<file>`, `games/<id>/audio/sfx/<file>` | `public/assets/audio/{music,sfx}/<file>` |

`games/<id>/sources.json` replaces these patterns (`{id}`, `{name}`, `{file}`). A pattern can be a list of candidates tried in order;
an audio pattern can set its bitrate (`{ "path": …, "rate": "64k" }`). A requested `.mp3` can come from an `.ogg` of the same name;
a sound with no source but already present in `public/assets` is kept as is. `overrides` handles one image apart:

```json
{
  "images": "private/extract/{id}.png",
  "decors": "private/asset/decor_{name}.png",
  "video": "private/asset/decor_{name}.mp4",
  "music": [{ "path": "private/audio/rendered/{file}", "rate": "64k" }, "private/audio/{file}"],
  "sfx": ["private/audio/sfx/{file}", "private/audio/sfx/densif/{file}", "private/audio/{file}"],
  "overrides": {
    "decor/france_map": [
      { "src": "private/asset/decor_france_map.png", "keyed": true, "fit": 1100, "quality": 85 },
      { "src": "private/asset/decor_map.png", "crop": [75, 590, 400, 880], "size": [1100, 982] }
    ],
    "decor/souk_chase": { "src": "private/asset/decor_souk_chase.png", "height": 800 }
  }
}
```

An override's options: `keyed` (a flat background connected to the border made transparent, then bounded to `fit` px at most), `crop` [x0, y0, x1, y1], `size` [w, h],
`height` (proportional width), `quality`. This is the sample game's `sources.json`, whose sources stay in `private/`.

## Checking the content

```bash
npm run validate   # broken references, empty or too-long text, missing Look lines, flags never set or never read
npm run solve      # fast witness: finds one path to the ending
npm run solve -- --prove # exhaustive reachable-state proof: reports states with no path to the ending
npm run solve -- --from=<checkpoint> --max=50000
npm run solve -- --prove --workers=4 [--batch=64] [--time=60]   # proof workers (3.5): the same result for any number of workers; a large proof ×2.5 with 4 (BENCH.md "3.5")
npm run solve -- --prove --ownership=off   # without the canonical owner (who holds a free item, pooled in proofs since 3.5)
npm run solve -- --dominance             # a witness with dominance (3.5; prunes nothing on the bundled games, BENCH.md)
npm test           # Node engine/tool tests and the selected game's tests
npm run test:assets # Python-backed image and asset-pipeline tests
npm run e2e        # a playthrough in Chromium, phone landscape (dev server already running)
```

`validate` and `solve` exit with code 1 for a blocking problem. `solve` exits 2 when its state budget is exhausted:
that is `truncated`, never a proof. `npm run build` requires a winning witness; `npm run prove:game` is the explicit
exhaustive softlock gate, and `npm run release-check` includes it.

```bash
npm run solve -- --chapters        # one bounded search per checkpoint with `goals`, then from the last one to the ending
npm run solve -- --prove --chapters   # the proof by chapters: each chapter proved from EVERY reachable boundary state of the previous one; a checkpoint that matches none is an error
npm run validate -- --report       # the content profiler: rooms, items, characters, what is thin (Markdown)
npm run page:world                 # the map of the world as a page (exits, gotos, unreachable rooms, DOT source)
npm run page:puzzles               # the puzzle graph as a page: what every rule needs and changes, a card per item / flag
npm run bench -- --matrix [--eras] [--max=20000]   # the 3.3 reference table (--eras: characters confined to eras, the reference game): the proof on 20/40 rooms × 1/2/3 characters, where the time goes (BENCH.md)
npm run bench -- --rooms=40 [--prove --v3]   # a generated game of that size, every tool timed on it; --prove adds the exhaustive proof, --v3 generates it with stable ids (docs/en/BENCH.md)
npm run i18n -- extract [--lang xx]   # translation tables (games/<id>/locales/<xx>.json); `status` for the coverage
npm run solve -- --audit-abstractions   # the proof with the abstractions against the explicit search, every memo hit run anyway: 0 same, 1 diverged, 2 the explicit search did not fit --max (BENCH.md "3.3.1")
npm run audit:corpus -- --seeds=500     # the same on random games (plain, free items, three characters), every night in CI (3.6): exit 1 on a divergence
npm run solve -- --profile         # what the states are made of, what the search cost, what each abstraction did (docs/en/BENCH.md)
npm run solve -- --por=stubborn    # partial-order reduction: commuting actions one at a time (fewer states, same proof)
npm run replay -- session.json     # plays a session file on the real engine, prints the journal and the final state
npm run ids [-- --write --map]     # stable ids (schema 3) written into the sources, locales renamed, the save migration step (docs/en/UPGRADING.md)
npm run ids -- --lines [--write --map]   # an id on every say / toast / guide object, list line, hint and kind reaction (--lines=all: plain strings too, required for a translated or voiced release): translations and voices keyed by it (UPGRADING §9, §10)
npm run i18n -- voices             # the lines with an id and no voice clip, the clips no line claims
npm run voices -- status [--lang xx]                 # per language: lines with an id by status (draft, record, recorded, approved), clips, orphans
npm run voices -- export --lang xx [--json] > t.csv  # the table for the actors: id, who, the text in that language, status, file, actor, note
npm run voices -- import t.csv --lang xx             # their statuses, actors and notes back into games/<id>/voices.json (unknown lines refused)
npm run voices -- check [--lang xx] [--release]      # every clip measured with ffmpeg: codec, rate, length for its text, loudness (≈ −16 LUFS), peak; --release: an approved line needs its clip
npm run validate -- --release      # also: provenance, placeholders, and a stable id on every line of a game shipped in another language than its own or voiced
npm run verify:release             # validate --release + weight --release + i18n status + strict playtests: a step of release-check
npm run verify:commercial          # verify:release, then no exception, no placeholder, no NC/ND licence, every source checkable (the sample game fails: its music)
npm run provenance [-- --lock]     # the shipped assets by licence, what changed since the reviewed lock; --lock records the files after a review
npm run weight [-- --release --json --stems]   # what a phone downloads before the first room, per room and per chapter, against assetBudgets (the single mixes; the scores' stems on their own line, --stems counts them)
npm run playtests [-- --strict --out=.cache/playtests]  # the sessions players shared (games/<id>/playtests) replayed and summed up: time per room, stalls, hints, heat map
npm run e2e:perf -- <url> [--renderer=canvas|dom --cpu=4 --min=30 --room=<id>]   # frames per second while the hero walks, CPU slowed (the phone stand-in)
npm run e2e:music -- <url> [--only=offline|live|game --live=chromium|webkit]   # the music director: 30 min offline without drift, 100 changes without a click, real-time jitter, the theme's stems in the game
npm run e2e -- <url> --renderer canvas  # the whole game drawn by the Canvas painter
npm run e2e:visual -- <url> [--update] # every room, still, against tests/visual/<game>/*.png (0.5% of the pixels at most)
npm run e2e -- <url> --lang fr           # the whole game in that language; fails on any visible English default of the engine
npm run e2e:a11y -- <url> [--only=axe,keys,storage] [--allow-skip]   # axe on the conversation, map, slots, confirmations, every minigame; every minigame won at the keyboard; an older save upgraded (E2E_BROWSER=chromium|webkit; exit 3: a check the browser cannot automate)
npm run docs:screenshots [-- --only=game|studio --keep-png]   # the README images from the production bundle and the Studio, as WebP in docs/img/ (needs Python with Pillow)
npm run lint [-- --prove | --static | --json]   # content lint: conditions nothing can satisfy, hidden rules, red herrings, stuck hints, actions never run
npm run doctor                     # checks Node, Python modules, ffmpeg and Playwright browsers
npm run check                      # type-check and Node tests
npm run verify:game                # validation, global/chapter witnesses and translation coverage
npm run prove:game                 # global/chapter exhaustive proof; fails on softlocks or truncation
npm run release-check              # prerequisites, build, proof and production dependency audit
```

**Lint.** `npm run lint` says what `validate` cannot (it checks shapes and references) and what `solve` does not say
loudly (it answers "can it be finished"): from the puzzle graph, a condition nothing sets (`cond-never-true`, an
error), a rule another rule matches first (`rule-shadowed`), an item no rule needs (`item-red-herring`) or nothing
gives (`item-never-gained`), a hint that waits for something nothing sets (`hint-stuck`, an error) or shares its
`until` with an earlier hint (`hint-never-fires`), a dead topic, choice option or listener, a choice with one option,
an exit with a condition and no `locked` line, an action that only changes what nothing live reads (`action-dead`,
info), a target standing behind a walk link a condition closes whose rule does not check that condition
(`walk-link-gate`: the link stops the walk, never the action); after a solver run, a live action the witness never ran and a room it never entered (`rule-never-run`,
`room-never-reached`: info with the witness, warnings with a completed `--prove`; a truncated proof keeps them as
information and says so, it never calls anything unreachable), and a live action that ran without ever changing the
state (`rule-no-effect`, info: a topic that only talks, or a `set` already true). Reachability counts every try the
solver made, whether or not it changed the state. Each finding names its room and path (the one the Rooms tab shows),
its stable id, and what to do. Exit codes: 0 clean, 1 an error that is not ignored, 2 the search was truncated
(`--json` carries `status` and `truncated`). `lint: { ignore: ['code',
'code:<id>', 'code:<room>/<path>'] }` in `game.ts` keeps a red herring on purpose. The Studio's Check tab shows the
same list with links into Rooms; the `lint` MCP tool returns it as Markdown. `verify:game` runs it (so does the CI).

**Proof cache.** A solver run depends only on the engine's code, the game (content, layouts, custom commands, and
the game folder's sources) and the options: `npm run solve` (every mode), `--chapters` and `npm run lint` keep each
result in `.cache/proofs/` and give it back when none of that changed, saying so (`(from the proof cache, key …)`;
`cached` in `--json`). The build, `verify:game`, `prove:game` and `release-check` ask the same questions several
times; on the demo a warm proof takes 0.2 s instead of 2.4 s. `--no-cache` or `PROOF_CACHE=0` runs again;
`PROOF_CACHE_DIR` moves it; an engine error is never kept. Tests call the solver directly and never use it.

**One status.** A solver run and a proof by chapters carry one status, its exit code and its sentence
(`src/engine/tools/status.ts`): `npm run solve` prints the sentence and exits with the code, `--json` carries
`status`, `exit` and `headline`, the Studio's Check tab shows the sentence, the `solve` MCP tool returns all three.
None of them words its own verdict.

| Status | Exit | Meaning |
|---|---|---|
| `solved` | 0 | the ending (or a chapter's goal) is reached; with `--prove`, it stays reachable from every reachable state |
| `softlocks` | 1 | reachable states from which it can no longer be reached (`softlockCount`, `softlockCauses`) |
| `unsolved` | 1 | it is not reached from any state explored |
| `truncated` | 2 | the search stopped at `--max` states: nothing is proved |
| `broken` | 1 | an invariant is true on a reachable state (before 3.3: `solved` with exit 1) |
| `error` | 1 | the engine failed while exploring |
| `checkpoint_mismatch` | 1 | chapters only: every chapter proved, but a checkpoint is none of its reachable boundary states |

**Continuous integration.** Every push to `main`, `v3` or `v3-*` runs `npm run build` (checks, Node and Python tests,
`verify:game`, the bundle, the spoiler and asset audits), `npm run prove:game` on the sample game, `npm run audit:deps`,
then the production e2e in Chromium (the demo's own walkthrough) and WebKit (the generic replay), both gates, the
whole game at the keyboard (Chromium and WebKit) and the whole game in French (Chromium), all gates since 3.3.1. An e2e only passes when the solver's run is `solved` (its exit code, status and steps
are checked) and the engine itself reports the ending (`state.done`): a truncated or unsolved game is a failure, never
"the best path replayed anyway". `main` deploys to Pages. The weekly `prove` workflow (or `workflow_dispatch`) runs
the proof and the bench on a 100-room schema-3 game within a budget and uploads `bench.md`. A `v3.x` tag runs
`npm run release-check` and publishes the GitHub release with the matching `CHANGELOG.md` section
(`scripts/release-notes.mjs`). Dependabot proposes weekly npm and actions updates, monthly pip ones.

**Playtests.** On a phone, the pause menu's **Share session** sends the session as a file (Web Share, else a
download): ids and indices only, no text, no journal. Drop it in `games/<id>/playtests/` (committed; `npm run audit`
covers it). `npm run playtests` replays every file on the current content and sums them up: play time per room (gaps
over a minute are pauses), where players stall (the same action three times without effect), hints shown, minigames
played, where each player stopped, and a heat map keyed like the solver's (`--out` writes `report.md`, `report.json`,
`heat.svg`). A session the content has outgrown is reported as diverged; with `--strict` (the release gate:
`release-check` and the weekly `prove` workflow) it is an error, exit 1: re-record or delete it. `verify:game` runs it
without `--strict`, so the CI replays every committed playtest and a content change never blocks a push. The Studio's Check tab shows the same report and
lets the puzzle graph's heat come from the players; the `playtests` MCP tool returns the Markdown.

**Sessions.** The engine records every input since the game started or a save was loaded (actions, map, switches,
script steps) with the answers given on the way (choices, random draws). The game's save menu, the dev panel and the
Studio's Play tab export it as `<game>-session.json`; `npm run replay` plays it back without a display and exits 1 at
the first entry whose outcome differs from the recording (`--upTo=N` stops earlier, `--json` for scripts). A tester's
bug report is that file and a screenshot. The solver's solution is a session too (`npm run solve -- --json` gives
`steps`), which is what `npm run e2e` taps through.

`solve` also reports **invariants** (`GameDef.invariants`) that became true, with the path. The validator warns about
rooms nothing leads to and declared exits with no way back.
`validate` also checks each minigame's required parameters (`required`), the images cited in their `params`,
every `skin` id (manifest images, `audio` sounds) and `ending.scratch`.
`games/demo/e2e.mjs` is the example of a game-specific `npm run e2e` script: it starts from the title screen, plays the pipes and pick minigames and the sealed ending's scratch ticket for real instead of skipping them, then checks the final card.

## Asset provenance

`games/<id>/provenance.json` says where every shipped asset comes from: entries `{ match, source, licence, author?, url?,
prompt?, status: 'final' | 'placeholder', note? }`, where `match` covers asset keys with `*` (`img:<manifest image
id>`, `sfx:<file>`, `music:<file>`, `voice:<file>`, `video:<file>`). `npm run validate` checks a game that has the
file (every asset covered by exactly one entry: two entries matching the same asset are an error, whatever their
order; every entry complete); `npm run validate -- --release` requires the file, and a placeholder is an error unless
a `releaseExceptions: [{ match, reason }]` entry names that asset (an exception never covers a placeholder added
later). A release also needs a licence policy, `licences: { allow: ['CC BY 4.0', 'own work'] }` (any other licence
fails unless an exception names the asset), and `provenance.lock.json`: `npm run provenance -- --lock` writes, after a
review, each shipped file's SHA-256 and size with the claims its entry made (pattern, licence, status). `validate
--release` then fails on a file that changed, an asset shipped since, a missing file or an entry edited since the
review; a plain `validate` only warns. `npm run provenance` prints the assets by licence and what changed since the
lock (exit 1 when something needs a review). The files are read from `public/assets` (`ASSETS_DIR` for a fixture).
**Weight.** `npm run weight` adds up what a phone downloads, from the built files and the asset graph (ENGINE
"Assets"): before the first room is playable (the app shell the service worker precaches, read from `dist/sw.js`,
compressed as a static host sends it, with the files a first visit pays twice; the title, the column icons, the bag at
the start, the first room), per room (backdrop, props in every state and animation frame, every character who can
stand there with variants, mouths and portrait, its music, and what its commands play or show: effects, music changes,
voice clips, gained items' icons, phone callers, a minigame's images and sounds), and per chapter (every room a player
can be in during it, from the proof by chapters), with the decoded memory of the images (width × height × 4).
`assetBudgets: { initialKB, roomKB, chapterKB }` in `game.ts` are the limits; over one, or a file missing, exits 1.
They count each track's single mix, what every device plays. Since 3.6 the rest has budgets too:
- `backgroundScoreKB`: the scores' stems, downloaded after the room is playable where the director plays them;
- `offlineTotalKB`: everything the full warm-up stores, app shell included;
- `decodedAudioMB`: the largest score decoded in memory (its `pcmBytes`; unknown is over).
`--release` (a step of `verify:release`) also fails when a budget is not set. `--json`. `npm run e2e:weight -- <url>`
(a CI gate since 3.4) checks the prediction against a real first visit in Chromium, the warm-ups off: every request
inside the predicted initial scope, the bytes within 10% of it or below.
`npm run new-game` writes one for the art it borrows from the sample game (all placeholders, CC BY 4.0); the
sample game's file excepts its non-commercial music by name. `npm run verify:release` (validate `--release`,
`i18n -- status`, strict playtests) is a step of `npm run release-check`, so the release workflow runs it. What an
exception lets through is printed by name as accepted, not as a warning to fix.
**A commercial release.** A green `verify:release` does not mean every asset may be sold: an exception is a reason,
not a licence. `npm run verify:commercial` (`verify:release`, then `validate --commercial`) refuses any
`releaseExceptions` entry, any placeholder, any non-commercial or no-derivatives licence (`NC`, `ND`), and any entry
without an `author` or a source that can be checked (a `url`, or a repository file named in `source`). It checks that
the claims are complete and allow a sale, not that they are true. The sample game fails it on purpose (its music is
CC BY-NC 4.0).
Translations: a text identical to the source fails `npm run i18n -- status` unless `i18n: { same: [paths] }` in
`game.ts` lists it (a name, "OK", an arrow).
`npm run audit` is a different check: it keeps names from a private project out of the public repository.

## The sealed ending

```bash
mkdir -p games/<GAME>/private && cp games/<GAME>/ending.config.example.ts games/<GAME>/private/ending.config.ts   # then fill in the texts (fix the import path)
npm run seal -- --outcome=<key>     # one of the `outcomes` keys: encrypts only the chosen outcome
npm run build && npm run check:spoilers   # checks that no outcome's text is in the clear in dist/
```

`outcomes` keys are free-form (`scripts/seal-types.ts`, type `EndingConfig`); the sealed key is compared against the guess flag (`ending.guess.flag`).
Without `games/<GAME>/private/ending.config.ts`, `npm run seal` uses the committed example. The config's password must match `ending.password` in `games/<GAME>/game.ts`.
The dossier's format (`ticket`, `headline`, `message`, `photos`, `lines`, `outcome`) never changes: a dossier.bin already sealed stays valid.

## Deploying

`npm run build` produces a static `dist/` (the game, its assets, the service worker). Any static host works.

**GitHub Pages (built in).** The CI workflow (`.github/workflows/ci.yml`) runs the checks on every push and, on `main`,
deploys `dist/` to Pages. Enable it once in the repository settings: Pages → Source → "GitHub Actions". The site lives
under `https://<user>.github.io/<repo>/`, so the workflow builds with `BASE_PATH=/<repo>/`: every path (assets, fonts,
manifest, service worker, sealed ending file) honours that base. A custom domain at the root needs no `BASE_PATH`.

```bash
BASE_PATH=/my-repo/ npm run build        # same thing locally
```

**Clever Cloud (or any Node host).** `npm start` serves `dist/` with sirv. On Clever Cloud: a Node application with
`CC_NODE_DEV_DEPENDENCIES=install` (Vite is a dev dependency) and `CC_POST_BUILD_HOOK=npm run build:web`, then `clever deploy`.

```bash
npm run assets                           # if images or sounds changed (the generated files are committed)
npm run build                            # local checks: types, tests, build, spoiler check, leak audit
node scripts/e2e.mjs https://<your-site>/   # plays the live version end to end
```

`games/<id>/private/` is never sent: it is excluded by `.gitignore`. **Before sharing a game with a sealed ending**: seal
the real outcome (`npm run seal -- --outcome=…` with `games/<id>/private/ending.config.ts`), then `npm run build`, commit, deploy.
