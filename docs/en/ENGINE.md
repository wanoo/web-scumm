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

## Two layouts

- **Phone (touchscreen), landscape**: the scene on the left; on the right, a column with the 9 verbs in a 3×3 grid, the
  inventory over 3 columns, and the Map / Pause / Sound icons. The sentence shows at the bottom of the scene.
- **Desktop (mouse, screen at least 720 × 450)**: the classic SCUMM layout. The scene takes the top; the sentence sits
  just below it; bottom left, the 9 verbs; on the right, the inventory (4 × 2, arrows on the left); far right, the 3
  icons in a column. Conversation choices and the place list take the spot of the verbs and the inventory.

The choice is made automatically (`App.layout`), and redone whenever the window is resized.

## Cache and responsiveness

- A **service worker** (vite-plugin-pwa / Workbox) keeps the app cached from the first visit. Images and sounds are kept
  on first use, then served without the network. Music is served in chunks (range requests) from the cache.
- From the title screen, the engine **preloads in the background** every image, every sound effect, then every music
  track (the save's room and the unlocked places first). Nothing is preloaded in "data saver" mode.
- Every image or sound address carries `?v=<hash>`: the hash changes as soon as a file in `public/assets` changes, which
  bypasses the old cache. The sealed ending's file (`data/`) is always requested from the network first.
- Once everything is loaded, the game works offline.

## The action cycle

1. The player picks a verb, then taps something (or an inventory item, then a target).
2. `App` calls `engine.act({ verb, a, b })`.
3. The engine walks the hero to the approach point (layout), turns them toward the target.
4. `resolve` looks for the reaction: room rule → game rule → Look → Talk (hints, conversation) → kind → refusal → fallback.
5. The commands run one by one; each calls the Presenter (speak, walk, change a prop, play a sound…).
6. At the end, the state is saved (localStorage). All of the state is JSON: `GameState` in `types.ts`.
7. In the gaps between actions, the world's **scripts** advance one command each (`ScriptDef`, `Engine.advance`): NPC
   strolls, ambient gags, a character that `moveActor`s to another room when an `emit`ted event wakes its `waitEvent`.
   Their position lives in the state too, so a save resumes them, and the solver plays them as actions ("Script <id>": the script runs up to its next `wait`, so a patrol is seen room by room). The solver also tries every option of a `choice` prompt (the path then reads `Talk x: "topic" › "reply"`), and keeps the exact value of a counter that is ever lowered or set to a number. It leaves out of the state whatever
   cannot change the outcome (the puzzle graph tells: a flag read by nothing but its own setter, a clock script nobody
   reads, a walker nobody waits for), so a decorative world costs it nothing.

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
