# The engine

A SCUMM-style point-and-click engine for the browser, built for phones in landscape.
It knows nothing about any particular game: a game is a content folder (`games/<id>/`) that the engine reads. The current
game is picked with `GAME=<id>` (otherwise `package.json` → `"config": { "game" }`, otherwise `demo`): see `TOOLS.md`.

## Layout of the code

```
src/engine/
  core/         pure logic (no DOM): state, conditions, reactions, scripts, conversations, hints
    types.ts      the content format, commented (the reference)
    engine.ts     the Engine class: player actions, resolution, command interpreter
    ports.ts      the Presenter interface (what the core asks of the display) + FakePresenter for node
    cond.ts       condition evaluation
    define.ts     defineGame / defineRoom, stable keys for once/nth/cycle/random blocks
  dom/          the browser display (implements Presenter)
    app.ts        landscape layout, verbs, inventory, lines, menus, map, minigames, sealed ending, title screen
    fonts.ts      default fonts (DotGothic16, Press Start 2P), overridden by `skin.fonts`
    room.ts       the scene: background, props, characters, depth sorting, walking, poses
    walk.ts       walkable area (earcut triangulation + navmesh paths), scale by depth
    audio.ts      music (fade, stack, one-off track) and sound effects, via Howler
    assets.ts     images and sounds prepared by `npm run assets`
  minigames/    minigames (DOM plugins): pipes, stroke, pick, hide, runner, scratch, cables; all their images come from `params`
  ending/       the sealed ending (optional): seal.ts (AES-GCM), card.ts (the final card), index.ts (decryption, ticket, confetti)
  tools/        validator and solver (node)
  dev/          debug overlay and placement editor (dev only)
```

Rule: `src/engine/` never imports from `games/` and never names a single image, sound, or interface text:
- texts come from `GameDef.ui`;
- icons, sounds, fonts and default heights come from `GameDef.skin` (see `CONTENT_GUIDE.md`, "The skin");
- minigame images come from their `params`;
- the sealed ending comes from `GameDef.ending`.

A game is a folder `games/<id>/` whose `index.ts` exports `{ game, layouts, manifest, minigames?, extraImages? }`.
`src/main.ts` imports `@game` (an alias for `games/<GAME>/index.ts`) and knows nothing else about the game.

Geometry constants: the logical scene measures 640 × 400; the floor goes no lower than `Layout.floor` (default 395, `FLOOR`
in `core/define.ts`); an approach point recorded more than 150 units from its target (`NEAR`) is considered stale and recomputed.

Verbs: ids are free (the game's `verbs`). Four of them have a meaning for the engine: `look` (Look texts), `talk`
(conversations, hints), `give` and `use` (two terms: inventory item then target; tapping an inventory item with no verb
selected picks `use`).

## Bootstrap

`src/engine/boot.ts` `bootGame({ game, layouts, manifest, minigames, commands, locales, version, dev, sw })` is
what a page does to start a game: language, fonts, the verified save store (early errors kept until the App can show
them), the `App`, `window.__game`, the dev tools, the title, the service worker. `src/main.ts` calls it; a game that
embeds the engine calls it too (docs/en/UPGRADING.md §8). `pickLanguage`, `waitFonts` and `openStore` are exported
for a page that needs another order.

## Saves: what is guaranteed

- The autosave and the manual slots live in IndexedDB (`dom/save-store.ts`), each write read back and verified; a
  browser without IndexedDB (a private window, a locked profile) gets the localStorage store, announced once.
- Every operation says what it did: `save()` reports a refused write through the store's failure callback and
  `whenIdle()` rejects; `clear()` and `clearSlot()` return `false` when the browser refused the deletion (the save is
  still there, the page keeps showing it). The App acts on it: "Restart" keeps the current game when the autosave
  cannot be cleared, "New game" from the title continues the saved game instead, a file import never loads over the
  current game when its copy into a free slot was refused. Each case shows `ui.saveFailed`.
- Tests: refused writes and deletions with a fake IndexedDB (`tests/save-store.test.ts`), one golden save per
  release (`tests/fixtures/saves/demo-<version>.json`: loads, migrates, reaches the ending), and in a real browser
  `npm run e2e -- --save` (a manual save survives a reload) and `--save --no-indexeddb` (the fallback does too).
- An older save is upgraded by the real build, in Chromium and WebKit (`npm run e2e:a11y`, its storage part, a CI
  gate since 3.3): the v2 localStorage autosave and slot are copied into IndexedDB and removed only after the copy is
  verified, a 3.1.0 envelope already in IndexedDB is migrated, the title's Continue resumes it, and a manual save then
  survives a reload.

## Accessibility

The whole game plays at the keyboard: Tab reaches the verbs (arrows move inside the grid, `aria-pressed` says which
one is chosen), the scene's targets (one hidden button per visible hotspot, prop or actor, in the scene's order), the
inventory and the tools; a conversation's choices and the map's places take the focus when they appear (arrows,
Enter); Space or Enter advances a line of dialogue; Escape closes what is on top (a menu, the map, a transcript, a
cutscene's or minigame's Skip) and otherwise opens the pause menu, whose focus stays inside. A live region announces
the room, each line and each item gained. `ui.advance` names the "tap to continue" marker for screen readers.
`npm run e2e -- --generic --keyboard` replays the solver's solution at the keyboard.

The bundled minigames play to their end at the keyboard, not only skip: `pick` and `hide` (the options and the
hiding spots are named buttons, the arrows move, Enter picks), `pipes` (the arrows walk the grid, Enter turns a
tile), `runner` (▲ / W jumps, ▼ / S ducks), `stroke` (◀ ▶ in turn at a calm rhythm; holding a key is "too fast"),
`scratch` (the arrows move a coin over the silver layer, the revealed text is announced) and `cables` (Enter on a
plug picks it up, Enter on a socket plugs it in). The minigame takes the focus on its first control, Skip keeps it
otherwise. `tests/dom/minigames-keyboard.test.ts` plays five of them to the end with key events.

**What is checked, and what is not.** `npm run e2e -- --axe` runs axe-core on the title, a room, the pause menu and
the ending, and `npm run e2e:a11y` on a conversation menu, the map, the save and load slots, the overwrite and
restart confirmations and every bundled minigame as it opens. `npm run e2e:a11y` also wins each bundled minigame in
a real browser with key presses only (no tap, no state written by the test), reading the page as a player does:
the option images, the hiding spots' and plugs' names, the help highlight of `pipes`; a win is a minigame that ended
without its Skip button (`App.minigameLog`, fed by the `mg-skip` event), and Skip is reached with Tab once. On
macOS, WebKit moves Tab between buttons only with Option held (the system's own setting): the check presses
Option+Tab there. On each of these screens, a `serious` or `critical` violation fails the run (`AXE_ACCEPTED` in `scripts/e2e/lib.mjs` lists the
accepted rules: none today). Images are decorative unless named (the scene is reached through its targets, an
item by its name), an empty inventory slot is out of the accessibility tree. CI: the Chromium keyboard row
(keyboard, axe, a save round trip without IndexedDB, `e2e:a11y`) gates, and so does `e2e:a11y` in the WebKit row;
the whole game at the keyboard in WebKit gates too (since 3.3.1). axe does not prove WCAG conformance: a screen-reader
pass (VoiceOver on iOS, TalkBack on Android: the title, a conversation, an item, the map, a minigame) stays a manual
check before a release, with the checklist in `docs/dev/SCREEN-READER.md` and the result in `docs/dev/passes/`. What
the engine can claim is therefore "tested at the keyboard, no serious or critical axe violation on the screens
checked", not "WCAG AA".

## Two layouts

- **Phone (touchscreen), landscape**: the scene on the left; on the right, a column with the 9 verbs in a 3×3 grid, the
  inventory over 3 columns, and the Map / Pause / Sound icons. The sentence shows at the bottom of the scene.
- **Desktop (mouse, screen at least 720 × 450)**: the classic SCUMM layout. The scene takes the top; the sentence sits
  just below it; bottom left, the 9 verbs; on the right, the inventory (4 × 2, arrows on the left); far right, the 3
  icons in a column. Conversation choices and the place list take the spot of the verbs and the inventory.

The choice is made automatically (`App.layout`), and redone whenever the window is resized.

## The scene: a model and a painter

`dom/room.ts` (`RoomView`) is the scene model of a room: who is where, which image of which pose, depth, walking,
mouths and blinks, fades, the camera, and the hit test (the smallest visible target under the finger). It hands each
entity to a painter as a finished sprite (`SpriteSpec` in `dom/renderer.ts`: image, feet position, size, depth,
mirror, rotation, opacity, glow, shadow) and never asks the painter anything back, so two painters cannot disagree on
what a tap touches. `dom/render-dom.ts` is the DOM painter, the reference (D10): an `<img>` per sprite, the z-index for
depth, a CSS translation for the camera. `RoomView.still()` stops every animation on a fixed picture (first frames,
mouths closed, the camera at rest): `npm run e2e:visual` compares each room of the sample game, still, with its
reference in `tests/visual/demo/` (a CI gate; `--update` rewrites them after a wanted change).

`dom/render-canvas.ts` is the Canvas 2D painter: one `<canvas>` the size of the viewport, held in place while the room
under it moves with the camera, repainted on the next frame after a change; the backdrop and the still backdrop layers
are pre-rendered once over the whole room and copied each frame; depth is the draw order, a sprite pivots on its feet,
an upright sprite is snapped to device pixels in the room as the DOM's layout does (the camera's translation keeps its
fractions, like the DOM room's), sprites off screen are skipped, the backdrop covers the room like `object-fit: cover`.
It draws the whole stage (`RoomDef.stage`): layers at their depth with their parallax, blend and opacity; occluders
(the backdrop's pixels, or a layer's, through a polygon, a black-and-white mask or a layer's alpha, feathered or
inverted, composited once) at theirs; the foreground; lights (radial and ambient, `screen` or `multiply`, falling on
the foreground too); particles (seeded per emitter, on the presentation clock, never the engine's dice); effect layers.
The DOM painter draws layers, parallax and polygon occluders (the backdrop clipped at the occluder's depth). The model
evaluates every stage condition and gives the stage again when one changes; a room's `transition` fades or wipes the
painter's surface; reduced motion (the setting or the system's) turns off parallax, particles and transitions. A room chooses it with `renderer: 'canvas'` (or the game for every room); `?renderer=canvas|dom`
forces one for every room. The UI, the dialogue and every accessible target stay in the DOM, above the canvas. Measured
on the sample game: its rooms within 0.31% of the DOM references, the whole game played to the end by it, 60 frames
per second with the CPU slowed 4× (`npm run e2e:perf`), all in the CI's `chromium / canvas` row.

## Walking and motions

`dom/walk.ts` walks a character over its room's walk zones (`walkZones`, one polygon with holes each, its own depth
scale and camera zoom) and the links between them (`walkLinks`: walk, stairs, ladder, jump, teleport, with a duration,
an animation and a facing): the fewest links first, then the shortest path inside each zone. A link's condition is DSL
(`RoomDef.stage.links[id].if`), read when the walk is planned; a closed link stops the walk at its foot with its
`locked` line, and the action that asked for the walk still runs (`npm run lint` warns, `walk-link-gate`, when a rule
behind such a walk does not check the condition itself). `core/motion.ts` gives `launch`, `spring`, `path` and
`follow` as closed forms of time: the same flight at any frame rate, nothing simulated, nothing logical inside; a
character keeps where its motion ends, like `place`.

## Assets: one graph

`src/engine/core/asset-graph.ts` says which files each part of the game needs, from the content: the title (backdrop,
logo, music, video, the column's icons, the bag at the start), each room (backdrop; props in every state and animation
frame; every character who can stand there, its actors, the playable characters who can reach it from their start
through exits, the map or commands, characters moved there, with variants, mouths and portrait; its music; what its
commands can play or show), the map, what game-wide rules can play, and `offline` (every file the game ships). The
renderer preloads a room's subset for who is actually there, the background warm-up reads the current and neighbouring
rooms' scopes, the full offline plan is the `offline` scope, provenance covers it, and `npm run weight` budgets it; a
file one of them knows cannot escape the others. A room's scope over-approximates one visit (every variant, every
character who could be there), never the other way: `npm run e2e:weight` fails on a request outside the prediction.

The default fonts go through the bundler, with hashed names, so the service worker's precache takes them from the HTTP
cache instead of downloading them again. The interface font is a Latin subset (118 KB, `tools/subset-font.py`); the
full DotGothic16 (2 MB, mostly Japanese) is a second face whose `unicode-range` covers only the rest, so a browser
fetches it, and caches it, only for a character outside the subset.

## Music: a director and its stems

`dom/director.ts` plays a score (`audio.scores`, 3.5) on Web Audio from decoded buffers: every stem starts at the same
instant of the audio clock and loops over the same window, so they stay sample-locked; a change of the game's state
moves stem gains on the next bar (or beat), crossfaded, scheduled ahead on the audio thread. `core/score.ts` decides
what and when, without a sound card: the mix per state, the grid through the loop, the ramps. `dom/audio.ts` hands a
scored track to the director where it fits (Web Audio, no Save-Data, more than 2 GB and 2 cores; a browser that does
not tell its memory, Safari, only when the scores decode to 128 MB at most, `pcmBytes`; `?music=mix|stems` forces one) and plays the single mix with Howler elsewhere; voices and one-off tracks duck the score like the mix.
`npm run e2e:music` renders thirty minutes offline (0 samples of drift), 100 changes of mix (no click; a hard switch
is caught), and measures the real-time jitter in Chromium and WebKit (0.02 ms), all in CI. Only the latest request
plays (3.5.1): a score whose stems finish decoding after another score was asked for, or after a stop, is dropped
(`tests/director.test.ts`). The decoded audio it keeps is capped (3.6, `audio.maxDecodedMB`, default 160): past it, the
scores least recently played are let go, and a score that alone is larger plays as its single mix (by its
`pcmBytes`, before any download). From one score to another, `audio.transitions` lands the new one on the old one's
beat, bar, phrase or marker, after a bridge if any (3.6, `core/score.ts` `landing`); `npm run e2e:music` checks both to
the sample, and a save's phase (`state.music`, written by the app, never read by the engine) resumes where it was.
The music has three intents (3.6.1): `play` (the story's, with its transitions), `restore` (a loaded save: whatever
plays stops at once and the saved track starts at its point, even when it is the one playing; no transition or bridge
until the save is in place) and `stop`. The director owns what it schedules: a transition not landed yet is a plan
(the old score, the bridge, the new score) that a stop, a restore or a new request cancels, so no bridge sounds after
them; the old score is stopped by a timer, never by a stop scheduled up front. Voices duck one bus under everything it
plays (bridges and stingers too), never the fades. The cap counts every buffer: a bridge that does not fit is dropped,
two scores that do not fit become a cut, stingers evict like scores; a stinger that does not fit beside the score is
streamed, not decoded (3.7.1), so the cap holds after every operation. A score that falls back to its mix keeps the
saved point.

## Cache and responsiveness

- A **service worker** (vite-plugin-pwa / Workbox) keeps the app shell cached from the first visit. Images and sounds
  are kept on first use, then served without the network. Music is served in chunks (range requests) from the cache.
- From the title screen and after each room change, the engine **warms in the background** the current room, directly
  reachable rooms and their audio, in batches sized by `GameDef.assetBudgets`. Then, once per page, **the rest of the
  game** (`GameDef.offline`, default `full`): every image, effect, voice, music track and video, batch by batch during
  idle time, paused while the page is hidden; nothing on a "save data" or 2G connection, music and video wait for
  better than 3G. `offline: 'nearby'` keeps only the room-scoped warm-up.
- Every image or sound address carries `?v=<hash>`: the hash changes as soon as a file in `public/assets` changes, which
  bypasses the old cache. The sealed ending's file (`data/`) is always requested from the network first.
- After the first visit the whole game plays offline, and the game says whether that is true: the warm-up returns a
  status (`App.offlineStatus`, `offlineReady`): `complete` only when every file of the plan is in the cache; `partial`
  with its reason (`network` and the failed files, `save-data`, `slow`, `quota` when the browser reports less than
  64 MB free before starting), `skipped` when nothing was tried, `off` with `offline: 'nearby'`. The pause menu shows
  it (`ui.offlineStatus`: "312/400", "whole game cached", "312/400 ⚠ tap to retry"); a tap retries a partial warm-up,
  and a file already in the Cache API is never fetched twice, so the warm-up resumes across reloads with no state of
  its own. `npm run e2e:pwa` requires `complete`, then checks every file of the plan against the cache offline and
  renders a room never visited (Chromium; WebKit cannot navigate offline under automation and reports "skipped",
  exit 3, accepted only by the CI's `--allow-skip`). With `offline: 'nearby'`, a room never visited or warmed may still
  need the network.

## The action cycle

1. The player picks a verb, then taps something (or an inventory item, then a target).
2. `App` calls `engine.act({ verb, a, b })`.
3. The engine walks the hero to the approach point (layout), turns them toward the target.
4. `resolve` looks for the reaction: room rule → game rule → Look → Talk (hints, conversation) → kind → refusal → fallback.
5. The commands run one by one; each calls the Presenter (speak, walk, change a prop, play a sound…).
6. At the end, the state is saved (verified IndexedDB autosave; the manual slots live in the same database, as
   envelopes, verified too; localStorage is the compatibility fallback). All of the
   state is JSON: `GameState` in `types.ts`.
7. In the gaps between actions, the world's **scripts** advance one command each (`ScriptDef`, `Engine.advance`): NPC
   strolls, ambient gags, a character that `moveActor`s to another room when an `emit`ted event wakes its `waitEvent`.
   Their position lives in the state too, so a save resumes them, and the solver plays them as actions ("Script <id>": the script runs up to its next `wait`, so a patrol is seen room by room). The solver also tries every option of a `choice` prompt (the path then reads `Talk x: "topic" › "reply"`), and keeps the exact value of a counter that is ever lowered or set to a number. It leaves out of the state whatever
   cannot change the outcome (the puzzle graph tells: a flag read by nothing but its own setter, a clock script nobody
   reads, a walker nobody waits for), so a decorative world costs it nothing. It also records what every action read
   (`Engine.reads`) and what answered (`SessionEntry.ran`): the profile (`--profile`) says what the states are made
   of, and the partial-order reduction (`--por`, `src/engine/tools/por.ts`) skips the orders of actions that commute.
8. Every input is **recorded** (`Engine.session`: actions, map, switches, script steps, with the choices, map picks
   and random draws they met), so a session exported from the game replays on a silent engine (`replay()`,
   `npm run replay`) and lands on the same state; the solver's solution is such a session (`SolveResult.steps`).

## Why these choices

- **DOM rendering rather than Phaser.** The validated mockups are in DOM (positioned images, crisp text, CSS for layout).
  An adventure scene holds about twenty images: the DOM handles that easily, and the interface (verbs, inventory, menus)
  stays in CSS. The core doesn't depend on the renderer: another Presenter (Phaser, canvas) could replace it without
  touching the content.
- **Libraries**: Howler (audio, iOS unlock), earcut + navmesh (paths), Tweakpane (dev tools), Vite, Vitest, Playwright.
- **Content as data**: no functions in the content, so it can be validated (`npm run validate`), solved (`npm run solve`),
  and saved.

See also: [CONTENT_GUIDE.md](CONTENT_GUIDE.md) to write a game, [TOOLS.md](TOOLS.md) for the commands and the editor,
[PROMPTS.md](PROMPTS.md) for the prompts that generate consistent art.
