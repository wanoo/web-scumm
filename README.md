# web-scumm

A SCUMM-style point-and-click adventure engine for phones, with the authoring tools and the AI-assisted workflow that
shipped a complete 9-room family game in three weeks. Write your story as data, place things by dragging, prove the
game can be finished, play it in landscape on any phone, offline after the first visit.

*[Version française](README.fr.md)* · Sample game: **The Pantry Key** (`games/demo`) → play it on GitHub Pages once the CI has run.

## In pictures

![Three rooms of the sample game](docs/img/banner.jpg)

| | |
|---|---|
| ![Title screen](docs/img/title.jpg) *Title screen, phone in landscape* | ![Dialogue](docs/img/dialogue.jpg) *Talk topics, transcript, speech colours per character* |
| ![Two-voice phone call](docs/img/phone-call.jpg) *A two-voice phone call* | ![World map](docs/img/map.jpg) *The map, with vehicles and "news" markers* |
| ![Pipes minigame](docs/img/minigame-pipes.jpg) *Pipes minigame, hint voice on top* | ![Pick minigame](docs/img/minigame-pick.jpg) *Pick the right flower* |
| ![Scratch ticket](docs/img/ending-scratch.jpg) *The sealed ending: a ticket to scratch* | ![Final card](docs/img/ending-card.jpg) *The final card judges the player's guess* |
| ![Placement editor](docs/img/editor.jpg) *The in-browser placement editor (`?edit=house`)* | ![Placement page](docs/img/placement-page.jpg) *The phone-friendly placement page* |

## Status
- Engine, tools and the sample game: complete and playable end to end (validator, solver, 35 tests, Playwright playthrough).
- Review pages (storyboard, sprite review, placement): working, as local HTML or as claude.ai artifacts.
- **In progress**: a local WYSIWYG Studio (`npm run studio`) to build rooms, texts and the storyboard without any cloud, and an
  MCP server so any AI assistant can plug in. See `docs/en/STUDIO.md`.

## What you get
- **An engine** (`src/engine`, TypeScript, no framework): 9 classic verbs, inventory, dialogue with transcript, hints,
  a world map with vehicles, cutscenes, two-voice phone calls, minigames (pipes, cable tangle, pick, hide and seek,
  runner, petting, scratch ticket), an optional **sealed ending** (AES-encrypted, revealed in play), save/continue,
  touch and mouse, phone and desktop layouts, service worker cache.
- **A content format** that is pure data: rooms, props with states, actors, rules (`verb` + target + condition +
  commands), talk topics, hints. No functions, so the tools can check it.
- **Tools**: a validator, a solver that proves the game finishes, an in-browser placement editor, an asset pipeline
  (AI-generated sheets → cut sprites → webp), a mouth-animation kit, phone-friendly review pages (storyboard, sprite
  review, drag-and-drop placement) that publish as claude.ai artifacts, a Playwright playthrough with screenshots.
- **A workflow for working with an AI assistant** (`docs/en/WORKFLOW.md`), a `CLAUDE.md`, skills for Claude Code,
  and a production-plan template for parallel sub-agents.

## Quick start
```bash
npm install
npm run dev                  # open the URL on your phone (same Wi-Fi), hold it in landscape
npm run studio               # the Studio at /__studio/: rooms WYSIWYG, texts, checks (local, dev only)
npm run validate             # content checks
npm run solve                # proves the game can be finished, prints the path
npm test                     # engine tests + the sample game's walkthrough
npm run build                # type-check, tests, bundle, spoiler check, leak audit → dist/
```

Make your own game:
```bash
npm run new-game my-game "My Game"   # games/my-game from the template, set as current game
npm run assets                       # prepare the placeholder art
npm run dev                          # ?edit=start to place things, ?dev&at=start to jump to a checkpoint
```
Then read `docs/en/CONTENT_GUIDE.md` and write `games/my-game/rooms/*.ts`. The story goes in `storyboard.json`
first; `docs/en/WORKFLOW.md` explains the whole method, `docs/en/PROMPTS.md` how to generate consistent art.

## Repository map
```
src/engine/      core (DSL, engine, solver, validator), dom (renderer), minigames, ending, dev (editor)
games/demo/      the sample game: game.ts, rooms/, layout/, art/, audio/, storyboard.json, site.json
games/_template/ copied by npm run new-game
tools/           validate, solve, refs, assets.py, cut-sheet.py, talk-*.py, pages/, audit-assets
scripts/         e2e harness, seal (sealed ending), gen-icons, new-game
docs/en docs/fr  ENGINE, CONTENT_GUIDE, TOOLS, WORKFLOW, PROMPTS, PAGES, PRODUCTION.template
```

## Deploy
`npm run build` produces a static `dist/`. The CI workflow deploys it to GitHub Pages on every push to `main`.
Any static host works (Clever Cloud, Netlify, a plain nginx). `GAME=<id> npm run build` builds another game.

## Licences
Code: MIT. Sample artwork: CC BY 4.0 (attribution "Wano"). Sound effects: Kenney, CC0. Fonts: SIL OFL. See `CREDITS.md`.
