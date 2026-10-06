# web-scumm

**Build a complete point-and-click adventure with an AI, and prove it can be finished.**

A SCUMM-style engine made for phones, a visual Studio to produce the game, and a pipeline that checks it, proves it and
ships it as a web game that works offline. It started as the engine of a 9-room family game, written and shipped in a
single day with an AI assistant.

*[Version française](README.fr.md)*

| | |
|---|---|
| 🎮 **Play** | [The Pantry Key](https://wanoo.github.io/web-scumm/), the sample game: phone in landscape, or desktop |
| 🛠 **Studio** | [Open the Studio](https://wanoo.github.io/web-scumm/studio.html) in demo mode: your edits stay in your browser |
| 🚀 **Start** | [Make your own game](#make-your-own-game) in a few commands |
| 📚 **Docs** | [The method](docs/en/WORKFLOW.md) · [the content format](docs/en/CONTENT_GUIDE.md) · [all the docs](#documentation) |

![The Pantry Key: Grandma's house, nine verbs, the bag](docs/img/v36-hero.webp)

**New in v4.1.5 "Real Core":** nothing in the content, everything in who owns what inside the engine. `step()` is
a table of handlers, one function per command; the script loops, the session and the room's camera and walking
have owners of their own (`ScriptScheduler`, `SessionLog`, `Camera`, `Walker`) instead of fields on the engine or the
view that functions mutated; the keyboard targets and the inventory are diffed, not rebuilt, on a state change, and
the stage is re-sent only when one of its conditions changes; `dom/room.ts` is under the 800-line limit without an
exception. Behaviour identical: the quality baseline, the visual baselines and the frame-rate gate are the same before
and after each step ([CHANGELOG](CHANGELOG.md)).

**New in v4.1.4 "Honest Engine":** nothing in the content, everything in how the engine behaves when things end or
fail. `Engine.destroy()` and `App.destroy()` leave no loop, listener, frame or blob URL behind; `Engine.onError` hears
a script that threw (stopped and marked so in the save, where 4.1.3 left it looking alive); time comes from the
injected clock alone; `beforeSave` and `onLoad` replace the player's patching of the engine's methods; `waitUntil`
wakes on the change that satisfies it; the state's keys are built in one place; `{item}`, `{target}`, `{name}` are
the placeholders, their 4.0 names kept ([CHANGELOG](CHANGELOG.md)).

**New in v4.1.3 "Honest Gates":** nothing in the game, everything in what guards it. The workflows read only, cancel
what a newer push supersedes, stop after a deadline, run on a named image and pin every action to a commit; the unit
suite runs once per push and the CPU-bound solver tests run every night; a tool names a coverage floor the tests
left behind, the frozen baseline says what a rewrite moves; `release-check` runs what CI runs; `main` is protected by
a ruleset and merges by pull request ([CHANGELOG](CHANGELOG.md)).

**New in v4.1.2 "Reliable Bridge":** the Reality Bridge after an outside review of 4.1.1, checked against the code:
proposals are taken one at a time per player (no shared sequence, one acceptance per `dedupeKey`); a save is bound
to its player, and one under another link is neither changed nor acknowledged; a rotation signs what waits again
under the current key and a client asks for the keys once; five minutes of clock tolerance; streams bounded and
closed on revocation; codes in memory, limits per address, a longest life for a link, "Unlink" that revokes; a
journal that survives a torn line, `doctor` and `compact`; a required signal's fallback proved by the closed witness;
mutation testing and random properties on what a signal rests on; the package `web-scumm-bridge` compiled, installed
and started by CI from its tarball. Nothing to change in a game ([CHANGELOG](CHANGELOG.md)).

**v4.1.1 "Reality Bridge":** a game can react to a fact from the world outside (an email answered, a webhook
called) without its content touching the network. A separate Bridge (`web-scumm bridge`, or the package
`web-scumm-bridge`) turns the fact into a short signed signal the game declares; the player verifies it, applies it at
most once, saves, then acknowledges; a session replays it offline; the solver proves the game without the outside,
under each scenario, and against any order of signals. Pair a game from its pause menu, try signals in the Studio's
simulated Bridge, run the sample `games/signals` ([REALITY](docs/en/REALITY.md), [REALITY-OPS](docs/en/REALITY-OPS.md)).
A game without signals pays nothing.

**v4.1 "Clarity":** a maintenance release that makes web-scumm easier to read, review and contribute to. It
changes no gameplay and no public contract: the engine, the player and the solver are split into modules of one
responsibility each, every index access in `src/` is checked, data from outside starts as `unknown`, the code is
formatted and linted by Biome, and the behaviour of 4.0.0 (witnesses, proofs, golden saves, the public surface) is
frozen by `npm run quality:baseline`. Coverage floors, property tests and mutation testing say how strong the tests
are. A newcomer starts with [ARCHITECTURE](docs/en/ARCHITECTURE.md) and the half-hour [CODE_TOUR](docs/en/CODE_TOUR.md).

**v4.0 "Stable Platform":** the engine is a package with a public API it promises to keep. A game lives in
its own project (`web-scumm create`, then `npm run dev`, `verify`, `build`, `release`), imports four entries
(`web-scumm/content`, `/player`, `/minigames`, `/testing`), and moves to a new release with `web-scumm migrate`: CI
creates a game on the previous release, saves in it, upgrades it and plays the old save to the end. What a release
ships is exactly its files and their licences, built from the commit CI tested and never replaced
([API](docs/en/API.md), [SUPPORT](docs/en/SUPPORT.md), [PACKAGE](docs/en/PACKAGE.md)). On the way: 3.7 made the sample
game sellable, 3.8 wrote down the field passes people still have to make ([FIELD](docs/en/FIELD.md)), 3.9 made the
first game outside the repository, "The Lighthouse". And for players: a double tap acts with the verb they mean
(through a door, talk to someone, look at the rest), and an item from the bag is given or used, whichever fits.

**v3.6 "Production":** the music director is held to budgets of its own (stems, offline, decoded audio, a
cap on what it keeps), its stem files are measured before a release, and one score hands over to another on a beat,
a bar, a phrase or a marker, through a bridge; a save keeps where the music was. The proof pools items per group of
characters who can meet, so open chains with three characters are proved where 3.5 gave up
([the measures](docs/en/BENCH.md#36-pooling-by-group-a-leak-and-a-corpus-5-october-2026)), and random games of three
kinds are checked against the explicit search every night (counted as tried, compared and partial).

**v3.5 "Score":** music that follows the game. A track is cut into stems that play in sync; the mix changes
with the room, the active character or a flag, on the next bar, without a click. The proof runs on several cores
with the same result, and pools the items the characters can hand each other, so two-character games with items
moving freely are proved
([how it is measured](docs/en/BENCH.md#35-proof-workers-5-october-2026)). It is an adaptive stem mixer with
transitions, not iMUSE: no tempo changes, no branches inside a score. 3.4 "Stagecraft" brought scenes with depth:
a Canvas painter, layers, masks, lights, walk zones and stairs, the structured Studio, and a second game, "The Night
Market".

## More than an engine

| Step | What web-scumm gives you |
|---|---|
| **Write** | A storyboard first, then rooms, dialogue with choices, hints and rules, all as plain data. |
| **Build** | Rooms placed by dragging, characters cut from generated sprite sheets, prompts for every image, chip-tune music and sound effects. |
| **Check** | Broken references, untranslated lines, the licence of every shipped file, what a phone has to download. |
| **Prove** | A path to the ending, every state where the ending is lost and why, saves that load across versions, real browsers. |
| **Ship** | A static web game that installs on a phone, plays offline, on touch, mouse or keyboard. |

## v4.0 in numbers

| What | Result |
|---|---|
| A new game outside the repository: packed, created, installed, verified, built, played to its end | a CI job on every push (`npm run fresh-install`) |
| A game made on the previous release, upgraded, its save played to the end on 4.0 | a CI job on every push (`npm run upgrade-check`) |
| "The Lighthouse", the independent game: 5 places, English and French | `release --commercial` green: proof over 85 states, 202 texts per language, 62 locked files |
| The public API | 92 names in 4 entries, 23 Studio/MCP tools, held by `tests/api-surface.test.ts` |
| Saves | one per release from 3.0.0 to 4.1.5 loads and reaches the ending |
| The player's first visit | 122 KB of JavaScript, gzipped (153 in 3.7.0), held by `initialJsKB` |
| The archive | every file accounted for: code, locked assets, fonts, icons, `licenses/` |
| The nightly corpus | 1 503 random games in four shards, 910 compared to the explicit search, 0 divergences |

## v3.6 in numbers

Measured on the release, proof cache off ([BENCH.md](docs/en/BENCH.md)):

| What | Result |
|---|---|
| "The Night Market", 8 rooms, 2 playable characters | proved in 288 states, 1.2 s; the abstractions audited against 83 672 explicit states |
| An open chain of 20 rooms, 2 characters, 12 items moving freely | proved in 14 002 states, 19 s (out of reach before 3.5) |
| An open chain of 14 rooms, 3 characters, items moving freely | proved in 93 480 states, 166 s (out of reach before 3.6) |
| 900 random games, abstractions against the explicit search | 549 verdicts compared, no divergence (351 stopped partial) |
| A 40 000-state proof on 4 worker threads | ×2.54 faster, the same result as on 1 |
| The music director, rendered offline for 30 minutes | 0 samples of drift; 100 changes of mix without a click; 0.02 ms jitter live |
| Its staged market: 6 layers, parallax, 3 masks, two floors | 50 frames per second with the CPU slowed 4× (Canvas) |
| A first visit | every byte the browser fetched was predicted by the asset graph |
| Reference game, 40 rooms × 3 characters, structured by eras | proved in 578 states, 4.1 s |
| The sample game, every reachable state | proved in 2.5 s, then 0.17 s from the proof cache |
| The sample game, chapter by chapter | proved in 3.7 s |
| The 7 bundled minigames | each one won with the keyboard alone, in Chromium and WebKit |
| Accessibility | tested at the keyboard, no serious or critical axe-core violation on any screen checked (not a WCAG claim) |
| Shipped assets | every file's hash and licence locked after review; weight budgets per room and chapter |

The proof explores the game as the engine plays it and assumes the minigames are won. The reference game keeps each
character in their own era. When items can move freely between three characters, the search still stops before the
end, and BENCH.md says so.

## What the player gets

<table>
<tr><td width="50%" valign="top"><img src="docs/img/v36-player-scene.webp" alt="Talking to Grandma: her topics in the side column" width="100%"><br><sub>Conversations with topics, choices and a transcript</sub></td><td width="50%" valign="top"><img src="docs/img/v36-player-minigame.webp" alt="The pipes minigame: bring the water to the mushrooms" width="100%"><br><sub>Minigames, playable by touch or keyboard</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/v36-player-map.webp" alt="The world map with characters pinned on it" width="100%"><br><sub>A world map, characters who move between places</sub></td><td width="50%" valign="top"><img src="docs/img/v36-player-ending.webp" alt="The final card: Pixel found the sardines" width="100%"><br><sub>An ending that remembers what the player guessed</sub></td></tr>
</table>

Nine classic verbs and a bag, dialogue, hints from a character, cutscenes and phone calls, rooms wider than the screen,
several playable characters with their own bags, scripts and events, seven minigames, an optional sealed ending,
autosave and save slots, translations, settings, touch, mouse and keyboard, and the whole game offline after the first
visit.

## What the author gets

<table>
<tr><td width="50%" valign="top"><img src="docs/img/v36-studio-rooms.webp" alt="Studio, Rooms tab: the pantry selected, its look lines and reactions editable" width="100%"><br><sub><b>Rooms</b>: the real engine, a placement editor on top, every line editable in place</sub></td><td width="50%" valign="top"><img src="docs/img/v36-studio-storyboard.webp" alt="Studio, Storyboard tab: boards and panels, 100% implemented" width="100%"><br><sub><b>Storyboard</b>: the story panel by panel, checked against the game</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/img/v36-studio-assets.webp" alt="Studio, Assets tab: Pixel's sprite sheet, cell by cell, with where each cell is used" width="100%"><br><sub><b>Assets</b>: every sheet and cell, where it is used, the prompt to make it</sub></td><td width="50%" valign="top"><img src="docs/img/v36-studio-check.webp" alt="Studio, Check tab: validator, solver path and solver health" width="100%"><br><sub><b>Check</b>: the validator and the solver, run again after every save</sub></td></tr>
</table>

<img src="docs/img/v36-proof-graph.webp" alt="The puzzle graph with the critical path and the solver's heat" width="420" align="right">

The puzzle graph shows what each item, flag and room leads to. With **Critical path** on, what does not lead to the
end fades. With **Heat**, the rules the solver went through most turn red. The Studio also has a Play tab with a rule
explainer and session replay, shared notes with the AI, and an Assistant that works with any model.

<br clear="right">

## Make your own game

Needs Node 22+, Python 3 for the art tools (`pip install -r requirements.txt`) and ffmpeg for sound.

**In its own project** (3.9, [PACKAGE](docs/en/PACKAGE.md)): the engine installs from a release's tarball (npm
publishing to come, then `npx create-web-scumm my-game`):

```bash
T=https://github.com/wanoo/web-scumm/releases/download/v4.1.5/web-scumm-4.1.5.tgz
npx --package=$T web-scumm create my-game "My Game" --engine=$T
cd my-game && npm install
npm run assets && npm run dev        # then npm run verify, npm run build, npm run release
```

**In this repository**, beside the sample games:

```bash
npm install
npm run doctor                       # checks Node, Python modules, ffmpeg and the test browsers
npm run new-game my-game "My Game"   # games/my-game from the template, set as the current game
npm run assets                       # prepares the placeholder art
npm run studio                       # the Studio: rooms, story, assets, checks, play
```

Then, before anyone plays it:

```bash
npm run verify:game   # validation, a path to the ending, chapters, translations, lint, playtests
npm run prove:game    # every reachable state: softlocks and truncation fail
npm run build         # tests, bundle and audits, into dist/ for any static host
```

`npm run dev` plays your game on this computer, `npm run dev:lan` on your phone. Write the story in
`storyboard.json` first, then the rooms with [CONTENT_GUIDE](docs/en/CONTENT_GUIDE.md) open.
[WORKFLOW](docs/en/WORKFLOW.md) is the whole method, step by step.

## How a game is written

Everything is data: rooms, props with states, characters, items, rules, topics, hints, scripts, events. There is no
code in the content, so every tool can read it, check it and play it.

```ts
export const garden: RoomDef = {
  id: 'garden', name: 'The garden', decor: 'garden',
  props: { tank: { name: 'water tank', states: { full: 'tank_full', empty: 'tank_empty' } } },
  actors: { grandpa: { char: 'grandpa' } },
  exits: { back_door: { name: 'back door', to: 'house', entry: 'garden' } },
  on: [
    { verb: 'use', a: 'pipe', b: 'tank', if: '!tank_drained',
      do: [{ minigame: 'pipes', params: { /* see games/demo */ } }, { lose: 'pipe' }, { set: 'tank_drained' }, { prop: ['tank', 'empty'] }] },
  ],
  talk: { grandpa: [{ topic: 'Where is the key?', if: '!tank_drained', do: [{ say: ['grandpa', 'It fell in the tank. Plop.'] }] }] },
  hints: [{ until: 'tank_drained', lines: ['Use the pipe on the water tank.'] }],
};
```

A rule is a verb, a target, a condition and a list of commands. [CLASSICS](docs/en/CLASSICS.md) writes twenty famous
mechanics of the genre with it: insult sword fighting, a nurse on patrol, a tree planted in the past.

## Why an AI can really work on it

- The content is declarative, so an assistant reads and writes it like any other file.
- Every operation is a command, and the same operations are MCP tools for Claude Code, Cursor, Codex, Gemini CLI or
  any MCP client ([MCP](docs/en/MCP.md)). The Studio's Assistant gives them to any model.
- After each change the assistant can validate, solve, replay and take a screenshot, so it sees its own mistakes.
- Every result stays reviewable by a person, in the Studio and in Git. `CLAUDE.md` and `AGENTS.md` hold the rules.

## Art and sound

`npm run prompts` writes ready-to-paste image prompts for every character sheet, object, background and piece of
furniture, all in one style. `npm run assets` cuts the generated sheets into sprites ([PROMPTS](docs/en/PROMPTS.md)).
`npm run audio` arranges a MIDI for Mega Drive chips and renders the sound effects from the same palette
([AUDIO](docs/en/AUDIO.md)).

## Documentation

| Read | For |
|---|---|
| [WORKFLOW](docs/en/WORKFLOW.md) | the method, from the first idea to the release |
| [CONTENT_GUIDE](docs/en/CONTENT_GUIDE.md) · [CLASSICS](docs/en/CLASSICS.md) · [DESIGN](docs/en/DESIGN.md) | writing content, famous mechanics, making it a good game |
| [STUDIO](docs/en/STUDIO.md) · [TOOLS](docs/en/TOOLS.md) · [MCP](docs/en/MCP.md) | the Studio, every command, the AI tools |
| [ENGINE](docs/en/ENGINE.md) · [BENCH](docs/en/BENCH.md) · [FIELD](docs/en/FIELD.md) | how the engine works, what the proof can and cannot do, what only people and real devices check |
| [PROMPTS](docs/en/PROMPTS.md) · [AUDIO](docs/en/AUDIO.md) · [PAGES](docs/en/PAGES.md) | images, sound, the review pages |
| [PACKAGE](docs/en/PACKAGE.md) · [API](docs/en/API.md) · [SUPPORT](docs/en/SUPPORT.md) | a game in its own project (`npx create-web-scumm`), the public API, what stays stable |
| [ARCHITECTURE](docs/en/ARCHITECTURE.md) · [CODE_TOUR](docs/en/CODE_TOUR.md) · [CONTRIBUTING](CONTRIBUTING.md) | how the code is put together, a half-hour tour of it, how to change it (and the decisions in `docs/dev/adr/`) |
| [ROADMAP](docs/en/ROADMAP.md) · [CHANGELOG](CHANGELOG.md) · [UPGRADING](docs/en/UPGRADING.md) | where it comes from, every release, moving to a new version |

Every page also exists in French under `docs/fr/`. `docs/dev/` holds the log of the work with the other assistant.

## Releases

Current release: [v4.1.5 "Real Core"](https://github.com/wanoo/web-scumm/releases/tag/v4.1.5): the split that
4.1.0 announced, done: `step()` as a table, owners for the script loops, the session, the camera and the walking,
rendering diffed instead of rebuilt, `room.ts` under the limit; behaviour identical to 4.1.4. The
story from v1.3 to v4.1 is in the [ROADMAP](docs/en/ROADMAP.md), every change in the [CHANGELOG](CHANGELOG.md).

## Repository map

```
src/engine/      core (the DSL, the engine), tools (validate, solve, lint, i18n…), dom (the renderer), minigames
games/demo/      the sample game: rooms, layouts, art, audio, locales, storyboard
games/_template/ copied by npm run new-game
tools/           the commands, the Studio, the MCP server, the art pipeline
scripts/         the browser tests, the sealed ending, new-game, the README screenshots
docs/en docs/fr  the documentation; docs/dev: the work log
```

The images of this page come from the production bundle and the Studio, taken by `npm run docs:screenshots`.

## Licences

Code: MIT. Sample artwork, sound effects and theme: CC BY 4.0 (attribution "Wano"); the theme is Tchaikovsky's *Swan
Lake* (public domain), written out and arranged for the project, so the sample game passes `npm run verify:commercial`
(3.7). Fonts: SIL OFL. See `CREDITS.md`.
