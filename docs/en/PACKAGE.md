# The engine as a package

Since 3.9 a game does not have to live in this repository. The engine is packed as `web-scumm` (the engine, its
pages, its tools and the `web-scumm` command, the game template) and `create-web-scumm` (`npx create-web-scumm`).

## A new game

Until the packages are on npm, take the tarball a release attaches (`T=https://github.com/wanoo/web-scumm/releases/download/v<version>/web-scumm-<version>.tgz`):
`npx --package=$T web-scumm create my-game "My Game" --engine=$T`. Once published:

```bash
npx create-web-scumm my-game "My Game"     # or: npx web-scumm create my-game "My Game"
cd my-game
npm install
npm run assets      # art/ and audio/ into public/assets (Python 3 with Pillow: pip install -r node_modules/web-scumm/requirements.txt)
npm run dev         # open the URL on a phone, landscape; ?edit=start places things
```

The project:

| Path | What |
|---|---|
| `game/` | the game: `game.ts`, `rooms/`, `cast.ts`, `items.ts`, `rules.ts`, `layout/`, `locales/`, `art/`, `audio/`, `provenance.json` |
| `public/` | the page's icons, the full font; `public/assets` is written by `npm run assets` (not committed) |
| `dist/` | the build, with `licenses/` (`npm run build`) |
| `tsconfig.json` | `@engine/*` points into `node_modules/web-scumm/src/engine` |

The template's art is a placeholder drawn from shapes (`tools/placeholder-art.py`): `provenance.json` says so, and a
release refuses it until each file is replaced and reviewed.

## Commands

`npx web-scumm help` lists them. The project's `package.json` names the usual ones:

| Command | What |
|---|---|
| `web-scumm dev` / `studio` | the game, the Studio |
| `web-scumm assets` | art and audio into `public/assets` |
| `web-scumm verify` | validate, solve, translations, lint, playtests |
| `web-scumm build` | assets, verify, the build, every file of `dist/` accounted for (`docs/en/TOOLS.md`, "What the archive holds") |
| `web-scumm release [--commercial]` | build, then the release gates: provenance lock, budgets, translations, voices, strict playtests, the proof |
| `web-scumm validate`, `solve`, `lint`, `i18n`, `weight`, `provenance`, `playtests`, `voices`, `prompts` | each tool, with its options (`docs/en/TOOLS.md`) |
| `web-scumm migrate` | bring the game's sources to the installed engine's format (`docs/en/UPGRADING.md`) |

They run with the project as their working folder (`WEB_SCUMM_PROJECT`): the engine in `node_modules/web-scumm` is
read, never written.

## Upgrading

`npm install web-scumm@<version>`, then `npx web-scumm migrate`, then `npm run verify`. `docs/en/UPGRADING.md` says
what each version changes; `docs/en/SUPPORT.md` which versions are supported and how long a deprecation lasts.

## How it is checked

`npm run fresh-install` (a CI job): packs the engine (`npm run pack`), creates a game from the packed template in an
empty folder outside the repository, installs the tarball, runs `assets`, `verify` and `build`, and plays the game to
its ending in Chromium. A file of the new project that names the repository fails it. Each release attaches both
tarballs; publishing them to npm is the maintainer's (a token, the package names).
