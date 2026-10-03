# web-scumm

A SCUMM-style point-and-click adventure engine for phones, with the authoring tools and the AI-assisted workflow that
shipped a complete 9-room family game in a single day. Write your story as data, place things by dragging, prove the
game can be finished, play it in landscape on any phone, offline after the first visit.

*[Version française](README.fr.md)*

| | |
|---|---|
| 🎮 **Play the sample game** | https://wanoo.github.io/web-scumm/ (phone in landscape, or desktop) |
| 🛠 **Try the Studio** | https://wanoo.github.io/web-scumm/studio.html (demo mode: edits stay in your browser) |
| 📦 **Source** | https://github.com/wanoo/web-scumm · release v2.2.0 · [release notes](docs/en/ROADMAP.md) |

![Three rooms of the sample game](docs/img/banner.jpg)

## The game

What players get: nine classic verbs, an inventory, dialogue with a transcript, hints from a character, a world map
with vehicles, cutscenes, two-voice phone calls, minigames (pipes, cable tangle, pick, hide and seek, runner, petting,
scratch ticket), rooms wider than the screen, several playable characters, an optional sealed ending (AES-encrypted,
revealed in play), autosave plus save slots with export / import, settings, translations, touch and mouse, phone and
desktop layouts, offline after the first visit.

<table>
<tr><td width="50%" valign="top"><img src="docs/img/title.jpg" alt="Title screen, phone in landscape" width="100%"><br><sub>Title screen, phone in landscape</sub></td><td width="50%" valign="top"><img src="docs/img/room-garden.jpg" alt="A room: nine verbs, the bag, the scene" width="100%"><br><sub>A room: nine verbs, the bag, the scene</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/dialogue.jpg" alt="Talk topics, transcript, a colour per character" width="100%"><br><sub>Talk topics, transcript, a colour per character</sub></td><td width="50%" valign="top"><img src="docs/img/phone-call.jpg" alt="A two-voice phone call" width="100%"><br><sub>A two-voice phone call</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/wide-room.jpg" alt="A room wider than the screen: the camera follows the hero" width="100%"><br><sub>A room wider than the screen: the camera follows the hero</sub></td><td width="50%" valign="top"><img src="docs/img/players.jpg" alt="Two playable characters: the button at the bottom switches, each has their own bag" width="100%"><br><sub>Two playable characters: the button at the bottom switches, each has their own bag</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/map.jpg" alt="The world map, with vehicles and “news” markers" width="100%"><br><sub>The world map, with vehicles and “news” markers</sub></td><td width="50%" valign="top"><img src="docs/img/minigame-pipes.jpg" alt="A minigame (pipes), the hint voice on top" width="100%"><br><sub>A minigame (pipes), the hint voice on top</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/minigame-pick.jpg" alt="Pick the right flower" width="100%"><br><sub>Pick the right flower</sub></td><td width="50%" valign="top"><img src="docs/img/ending-scratch.jpg" alt="The sealed ending: a ticket to scratch" width="100%"><br><sub>The sealed ending: a ticket to scratch</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/ending-card.jpg" alt="The final card judges the player's guess" width="100%"><br><sub>The final card judges the player's guess</sub></td><td width="50%" valign="top"><img src="docs/img/french.jpg" alt="The same game in French: one JSON file, a Language setting" width="100%"><br><sub>The same game in French: one JSON file, a Language setting</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/settings.jpg" alt="Settings: text speed and size, reduced motion, readable font, volumes" width="100%"><br><sub>Settings: text speed and size, reduced motion, readable font, volumes</sub></td><td width="50%" valign="top"><img src="docs/img/save-slots.jpg" alt="Save slots, export to a file, import" width="100%"><br><sub>Save slots, export to a file, import</sub></td></tr>
</table>

## The Studio

`npm run studio` opens a local creation environment on the game's files; `studio.html` on the demo site is the same
in demo mode (edits stay in your browser). Each tab is one job, in the order you do them: write the story, place the
rooms, generate the art, check, play, take notes with the AI. See `docs/en/STUDIO.md`.

<table>
<tr><td width="50%" valign="top"><img src="docs/img/studio-rooms.jpg" alt="<b>Rooms</b>: the room rendered by the real engine, the placement editor on top; select anything and edit its lines, reactions and topics in place" width="100%"><br><sub><b>Rooms</b>: the room rendered by the real engine, the placement editor on top; select anything and edit its lines, reactions and topics in place</sub></td><td width="50%" valign="top"><img src="docs/img/studio-dialogue-tree.jpg" alt="<b>Dialogue tree</b>: a character's topics as a tree (lines, choices, branches, conditions), derived from the content; tap a node to jump to its editor" width="100%"><br><sub><b>Dialogue tree</b>: a character's topics as a tree (lines, choices, branches, conditions), derived from the content; tap a node to jump to its editor</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/studio-storyboard.jpg" alt="<b>Storyboard</b>: the story panel by panel, lines, preview, notes; the first thing to write" width="100%"><br><sub><b>Storyboard</b>: the story panel by panel, lines, preview, notes; the first thing to write</sub></td><td width="50%" valign="top"><img src="docs/img/studio-assets.jpg" alt="<b>Assets</b>: every sheet and cell, where it is used, the art prompt to paste into an image model, uploads cut automatically" width="100%"><br><sub><b>Assets</b>: every sheet and cell, where it is used, the art prompt to paste into an image model, uploads cut automatically</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/studio-assets-decor.jpg" alt="<b>A background</b> with its hotspots, props and floor band overlaid" width="100%"><br><sub><b>A background</b> with its hotspots, props and floor band overlaid</sub></td><td width="50%" valign="top"><img src="docs/img/studio-check.jpg" alt="<b>Check</b>: validator, solver path, world map, puzzle graph and content report, re-run after every save" width="100%"><br><sub><b>Check</b>: validator, solver path, world map, puzzle graph and content report, re-run after every save</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/studio-puzzles.jpg" alt="<b>Puzzles</b>: tap an item or a flag for its card: where it comes from, what needs it, what it unlocks" width="100%"><br><sub><b>Puzzles</b>: tap an item or a flag for its card: where it comes from, what needs it, what it unlocks</sub></td><td width="50%" valign="top"><img src="docs/img/studio-play.jpg" alt="<b>Play</b>: the game beside its live state, a rule explainer (every condition ✓ / ✗) and the journal" width="100%"><br><sub><b>Play</b>: the game beside its live state, a rule explainer (every condition ✓ / ✗) and the journal</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/studio-notes.jpg" alt="<b>Notes</b>: the shared log between you and the AI, about a panel, a room or an element" width="100%"><br><sub><b>Notes</b>: the shared log between you and the AI, about a panel, a room or an element</sub></td><td width="50%" valign="top"><img src="docs/img/studio-assistant.jpg" alt="<b>Assistant</b>: any AI model with the same tools as the MCP server, about the selected element" width="100%"><br><sub><b>Assistant</b>: any AI model with the same tools as the MCP server, about the selected element</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/editor.jpg" alt="<b>The placement editor</b> in the game itself (<code>?edit=house</code>)" width="100%"><br><sub><b>The placement editor</b> in the game itself (<code>?edit=house</code>)</sub></td><td width="50%" valign="top"><img src="docs/img/placement-page.jpg" alt="<b>The placement page</b>: place things from a phone, export the layout" width="100%"><br><sub><b>The placement page</b>: place things from a phone, export the layout</sub></td></tr>
</table>

![Puzzle graph](docs/img/puzzles-page.jpg)
<sub>The puzzle graph (`npm run page:puzzles`, also in Check): coloured things, white actions; grey arrows for what an
action needs, green for what it produces, red for what it consumes. Tap a thing for its card.</sub>

## Quick start

Needs Node 22+. For the art tools: Python 3 with `pip install -r requirements.txt` (Pillow, NumPy, SciPy) and ffmpeg.

```bash
npm install
npm run dev          # the sample game; open the URL on your phone (same Wi-Fi), hold it in landscape
npm run studio       # the Studio at /__studio/: rooms, texts, storyboard, assets, checks, play, notes
npm test             # 154 tests: engine, tools, the sample game's walkthrough
```

Make your own game:

```bash
npm run new-game my-game "My Game"   # games/my-game from the template, set as the current game
npm run assets                       # prepares the placeholder art
npm run dev                          # ?edit=start places things, ?dev&at=start jumps to a checkpoint
```

Then write `games/my-game/rooms/*.ts` with `docs/en/CONTENT_GUIDE.md` open. The story goes in `storyboard.json`
first; `docs/en/WORKFLOW.md` is the whole method, step by step; `docs/en/DESIGN.md` is how to make it a good game.

## How a game is written

Everything is data: rooms, props with states, characters, items, rules, talk topics, hints, scripts, events. No code in
the content, so every tool can read it, check it and play it.

```ts
export const garden: RoomDef = {
  id: 'garden', name: 'The garden', decor: 'garden',
  props: { tank: { name: 'water tank', states: { full: 'tank_full', empty: 'tank_empty' } } },
  actors: { grandpa: { char: 'grandpa' } },
  exits: { back_door: { name: 'back door', to: 'house', entry: 'garden' } },
  look: { tank: ['A big water tank. Full to the top.', 'Something is at the bottom.'] },
  on: [
    { verb: 'use', a: 'pipe', b: 'tank', if: '!tank_drained',
      do: [{ minigame: 'pipes', params: { /* its tiles: see games/demo */ } }, { lose: 'pipe' }, { set: 'tank_drained' }, { prop: ['tank', 'empty'] }, { show: 'sock' }] },
  ],
  talk: { grandpa: [{ topic: 'Where is the key?', if: '!tank_drained', do: [{ say: ['grandpa', 'It fell in the tank. Plop.'] }] }] },
  scripts: [{ id: 'grandpa_naps', loop: true, do: [{ wait: 7000 }, { anim: ['grandpa', 'snore'], ms: 1200 }] }],
  hints: [{ until: 'tank_drained', lines: ['Use the pipe on the water tank.'] }],
};
```

A rule is a verb, a target, a condition and a list of commands. Topics branch with `choice` and `if`. Scripts run
between the player's actions; events (`emit` / `events`) let one room react to another. Characters move between
rooms, several of them can be playable, rooms can be wider than the screen. The whole vocabulary is
`src/engine/core/types.ts`; `docs/en/CLASSICS.md` shows twenty famous mechanics (insult sword fighting, a mug that
melts, a nurse on patrol, haggling, a tree planted in the past) written with it.

## Check it before anyone plays it

```bash
npm run validate                   # broken references, missing look lines, flags never set, scripts that never wait…
npm run validate -- --report       # the content profiler: what each room, item and character amounts to
npm run solve                      # plays every action from "New game" and prints a path to the ending
npm run solve -- --chapters        # one bounded proof per chapter (checkpoints with goals), then to the ending
npm run page:puzzles               # the puzzle graph as a page (also in the Studio's Check tab)
npm run page:world                 # the map of the world: exits, gotos, unreachable rooms
```

The solver uses the real engine with a silent screen, so what it finds a player can do. It tries every reply of a
choice, switches playable characters, lets scripts advance one wait at a time, and leaves out of the state whatever
cannot change the outcome (a flag only its setter reads, a clock nobody looks at), so a world full of decoration costs
nothing: a generated 100-room, 5-player game is proven in eight seconds (`docs/en/BENCH.md`). It reports dead ends,
items never used, **invariants** that became true, and the path that got there.

## The art

`npm run prompts` writes ready-to-paste prompts for every character sheet (walk, talk, seated, the poses your rooms
use), every object sheet with its states, every background and furniture piece, all sharing one style block and the
colour rules (four tones per material, flat areas, one outline). `artStyle: "pixel"` in `site.json` switches prompts,
cutter and rendering to true pixel art. `npm run assets` cuts the generated sheets into sprites and prepares
backgrounds, sounds and voice clips (`docs/en/PROMPTS.md`, `docs/en/TOOLS.md`).

## With an AI assistant

The content is data and every tool is a command, so an assistant can write a room, check it, solve it, look at it and
fix it without you. `CLAUDE.md` and `AGENTS.md` carry the rules; `.claude/skills/` the recipes (a new room, a sheet to
cut); `npm run -s mcp` exposes the same operations as 19 MCP tools to Claude Code, Cursor, Codex, Gemini CLI or any
MCP client (`docs/en/MCP.md`); the Studio's Assistant tab connects any model with those tools; `docs/en/WORKFLOW.md`
is the method, `docs/en/PRODUCTION.template.md` the plan for parallel sub-agents.

```bash
npm run i18n -- extract --lang fr    # a translation table (games/<id>/locales/fr.json) that survives refactors
npm run bench -- --rooms=40          # a generated game of that size, every tool timed on it
npm run e2e                          # the sample game played in Chromium, phone landscape, with screenshots
npm run build                        # type-check, tests, bundle, spoiler check, private-name audit → dist/
```

`npm run build` produces a static `dist/`; the CI deploys it to GitHub Pages on every push to `main`, with the Studio
in demo mode at `studio.html`. Any static host works. `GAME=<id> npm run build` builds another game.

## Releases

| Version | What it added |
|---|---|
| v2.2 Studio | Dialogue tree (Rooms tab, MCP `dialogue_tree`); the engine's journal (Play tab, dev panel). |
| v2.1 Proof | The classics (`CLASSICS.md`); the puzzle graph; a solver that enumerates choices, keeps counters exact, plays scripts a wait at a time and prunes what cannot matter; the stress bench; one catalogue of the commands checked by `tsc`; loops with frame sounds; translations that follow moved texts. |
| v2.0 Open | Custom commands with declared effects; translations by extraction; the Play tab with its rule explainer; fixtures per primitive. |
| v1.6 Cast | Several playable characters (`players`, `switchPlayer`, `transfer`). |
| v1.5 Picture | Wide rooms and camera; prop animations with frame events; voice clips; the Settings menu. |
| v1.4 Scale | Declared exits and the world map; chapters and invariants; save slots and data-only migrations; the content profiler. |
| v1.3 World | Scripts, events, characters that move between rooms. |

The reasoning behind each milestone is in `docs/en/ROADMAP.md`.

## Repository map

```
src/engine/      core (DSL, engine, commands catalogue), tools (validate, solve, puzzle, graph, report, i18n, stress), dom (renderer), minigames, ending, dev (editor)
games/demo/      the sample game: game.ts, rooms/, layout/, art/, audio/, locales/, storyboard.json, site.json
games/_template/ copied by npm run new-game
tools/           CLIs (validate, solve, i18n, bench, prompts), pages/, studio/, mcp/, assets.py, cut-sheet.py
scripts/         e2e harness, seal (sealed ending), gen-icons, new-game
docs/en docs/fr  CONTENT_GUIDE, CLASSICS, DESIGN, ENGINE, TOOLS, STUDIO, MCP, PAGES, PROMPTS, WORKFLOW, BENCH, ROADMAP
```

## Licences

Code: MIT. Sample artwork: CC BY 4.0 (attribution "Wano"). Sound effects: Kenney, CC0. Fonts: SIL OFL. See `CREDITS.md`.
