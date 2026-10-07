
- **The first visit's JavaScript goes from 125 to 136 KB gzipped, and the reference chapter's witness changes
  (4.1.15)**: the save envelope pulls the world's compiler into the main chunk (the budget, `initialJsKB` 140, holds;
  the lazy chunk for Remix is the next lot's work), and the reference chapter's content moved (the password and the
  wheel are optional puzzles, the seller's round varies): the baseline moved on purpose, every golden save still loads.
- **The French locales of the two bundled games say « vendeur » where the Remix lines said a word the asset audit
  blocks (4.1.15)**: `npm run audit:assets` is part of `build:game`, and CI refused the build.

### Breaking

- **The save envelope v4 (4.1.15, ADR 0018).** A save is written as `SaveEnvelopeV4` (`schema: 4`): the v3 envelope
  and the `WorldVariant` the game was played in. `parseSave` reads v3 and v4; a v3 save migrates to the story world
  (`upgradeEnvelope`) and loads as before, and the golden saves of 3.0.0 to 4.1.9 still reach the ending. A save from
  another world is refused with `SaveWorldMismatch`, which names the world to rebuild. A host that wrote or checked
  `schema: 3` itself sees `schema: 4` and a `variant` field (UPGRADING §27); a 4.1.15 save does not load on 4.1.14.

### Changes

- **Remix: several worlds of one game (4.1.15, ADR 0018).** A game may declare a variation manifest (`remix`) and
  tagged anchors in its rooms: an item among anchors, a character's starting room, his round among scripts, a code
  coupled with its hint (`{code:<id>}`, `{hint:<id>}` in every language), an order of puzzle groups, alternative lines,
  images, palettes or minigame parameters. A seed (`WS-XXXX-XXXX`, with a check symbol) makes the same world and the
  same hash (tested in Node; the cross-runtime check `npm run e2e:remix` is written, not yet run); the world is plain data (reserved flags `remix.*` the content reads with `{ flag, eq }`),
  so the engine, the solver and the replay need nothing new. An impossible manifest is a build error; a malformed seed
  an explicit error. The sample game hides the pantry key under the oranges or in the lantern; the reference chapter
  moves the seller and his round, lets Lou hand the board before the lights, and draws a festival password with
  Grandma's riddle, in English and French.
- **Every world proved (4.1.15, D25).** `npm run verify:variants` validates and solves each world of a catalogue mode
  (`--prove`: no softlock), and a generator's published sample, with coverage per dimension and pair, values never
  chosen and dominant ones; it runs in `verify:game`, and a release publishes the bundled games' reports. `npm run
  remix -- --seed|--preview` shows a world. Measured: `demo` 3 worlds, `reference` 24 worlds per mode, all proved.
- **Remix in the player (4.1.15).** The title screen's **Remix** offers the story, a new world, a typed seed or the
  daily challenge; the pause menu shows the world's code to copy, or "hidden until the end" in a masked mode; links
  `?seed=`, `?daily=`, `?world=` name a world. Sessions record their world and a replay rebuilds it; speedrun
  categories Story, Fixed, Random, Mystery and Daily keep their leaderboards apart.
- **The daily challenge and Mystery seeds (4.1.15, D26).** A new Bridge module signs the day's seed and rules and
  commits to a Mystery seed before revealing it; the player verifies both offline with the key the game's manifest
  names. The Bridge never chooses a seed after seeing actions.
- **The code wheel (4.1.15).** "The Extremely Legitimate Pirate Check", a playful reconstruction of 1990s code wheels
  drawn from the game's characters (never DRM): the minigame `code-wheel` (parody by default), seeded by the world,
  accessible by buttons, keys, gamepad and a text list, and `npm run code-wheel` prints it (SVG, PDF with Pillow). The
  reference chapter has one on Lou's map.
- **The Studio's Remix tab (4.1.15).** Preview a seed, lock and reroll, compare, coverage and bias, anchors from the
  scene, play or export a frozen world.
- **The DSL and the IR are frozen (4.1.15, D28).** 4.1.15 is the release candidate of 4.2: `docs/dev/DSL-STABILITY.md`
  lists everything frozen, Remix's additions included. `Math.random` is forbidden in `src/engine/core` and
  `src/engine/minigames` by the linter; the minigames draw from the run's `minigame:<id>` stream (`MinigameCtx.random`).
- **After the second reading (4.1.15).** A link to another world never replaces a saved game silently: the page starts
  in the saved game's world and the title asks before the link's world replaces it; the stores keep a save of another
  world instead of writing over it. A stored or linked world is checked value by value against the game whatever its
  hash says (integrity is not authenticity). A generator backtracks instead of dead-ending; a presentation value cannot
  touch a minigame parameter that decides a win; Mystery commits are limited per client and a Mystery run must start
  within a minute of its reveal; seed codes refuse non-ASCII lookalikes; `newSeed` throws without WebCrypto.
