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
npm run dev        # dev server, also reachable from a phone on the local network
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
npm run solve      # proves the game can be finished; lists dead ends and items never used
npm run solve -- --from=<checkpoint> --max=50000
npm test           # engine tests on tests/fixture (core, minigames, tools), then the sample game's own tests
npm run e2e        # a playthrough in Chromium, phone landscape (dev server already running)
```

`validate` and `solve` exit with an error (code 1) when there is a blocking problem.

```bash
npm run solve -- --chapters        # one bounded search per checkpoint with `goals`, then from the last one to the ending
npm run validate -- --report       # the content profiler: rooms, items, characters, what is thin (Markdown)
npm run page:world                 # the map of the world as a page (exits, gotos, unreachable rooms, DOT source)
npm run page:puzzles               # the puzzle graph as a page: what every rule needs and changes, a card per item / flag
npm run bench -- --rooms=40        # a generated game of that size, every tool timed on it (docs/en/BENCH.md)
npm run i18n -- extract [--lang xx]   # translation tables (games/<id>/locales/<xx>.json); `status` for the coverage
```

`solve` also reports **invariants** (`GameDef.invariants`) that became true, with the path. The validator warns about
rooms nothing leads to and declared exits with no way back.
`validate` also checks each minigame's required parameters (`required`), the images cited in their `params`,
every `skin` id (manifest images, `audio` sounds) and `ending.scratch`.
`games/demo/e2e.mjs` is the example of a game-specific `npm run e2e` script: it starts from the title screen, plays the pipes and pick minigames and the sealed ending's scratch ticket for real instead of skipping them, then checks the final card.

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
