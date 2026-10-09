# Remix: several worlds of one game (4.1.15)

Remix lets one game produce several games that are really different (where an item is, where a character starts and
which round he walks, a code and its hint, the order of two puzzle groups, a line of the same intent) without turning
the story into random content. Every variation is declared by the author, finite, deterministic from a seed, and
understood by the validator, the solver, the saves, the replay, the Studio and the speedrun tools. The design is
ADR 0018 (`docs/dev/adr/0018-variation-manifest-and-world-variant.md`); the decisions are D25 to D28.

## What varies, and what never does

A dimension varies one thing among values the author lists, each with its **story** value (the world as written).
`item-placement` puts an item at one of several tagged anchors; `actor-start` starts a character in one of several
rooms; `actor-route` picks one of several scripts as his round; `coupled` draws a code and its hint together;
`puzzle-order` picks an order of puzzle groups that keeps the author's edges; `presentation` picks a line, an image, a
palette or a minigame parameter. Remix never reorders the rules (their order can carry meaning), never writes a text,
never invents a dependency: the author writes each branch with the conditions the DSL already has.

## Declaring a manifest

The manifest is `remix` in `game.ts`. The sample game's (`games/demo/game.ts`) moves the pantry key:

```ts
remix: {
  schema: 1, algorithm: 'web-scumm-remix-1',
  modes: [
    { id: 'story', strategy: 'catalogue', dimensions: [] },
    { id: 'remix', strategy: 'catalogue', dimensions: ['key-spot', 'oranges-line'] },
  ],
  dimensions: [
    { id: 'key-spot', kind: 'item-placement', item: 'key', logical: true,
      anchors: [{ room: 'market', anchor: 'stall' }, { room: 'market', anchor: 'oranges' }, { room: 'market', anchor: 'lantern' }],
      story: { room: 'market', anchor: 'stall' } },
    { id: 'oranges-line', kind: 'presentation', target: 'line:market.take-oranges.l-oranges-are-not', logical: false, story: 0,
      values: [{ en: 'Oranges are not sardines…', fr: '…' }, { en: 'An orange. Round, bright…', fr: '…' }] },
  ],
  constraints: [{ kind: 'not-behind', item: 'key', action: 'house.use-key-pantry' }],
},
```

A logical value away from its story value writes the reserved flag `remix.<dimension>` when the game starts
(`remix.key-spot` = `market.oranges`); the content reads it with `{ flag: 'remix.key-spot', eq: 'market.oranges' }`.
The story world writes no flag, so every condition is written for the other values and the story keeps its own text:
`games/demo/rooms/market.ts` hands the key over in the story, says where it is hidden otherwise, and lets Pixel take
it under the oranges or inside the lantern. The validator warns about a value no condition reads.

## Anchors and item placement

An anchor is a tagged spot of a room, `anchors` in `rooms/<room>.ts`: `at` (the prop or hotspot it stands on),
`visible`, `reachableBy` (what it takes to reach it), `capacity` (default 1: two items never share it unless it says
so) and `phase` (a label the Studio groups by). The validator refuses an anchor on nothing, an anchor in a room the
start cannot reach, and an anchor reached only with the item placed there; the constraint `not-behind` removes the
anchors behind a rule that needs the item. `exclusive` keeps dimensions apart; `requires` (`a=x` requires `b=y`)
ties two values.

## Characters, codes and orders

`actor-start` moves the character's starting `room` (each candidate room must declare an actor for it), and the
solver proves the character is where each world needs him. `actor-route` names scripts: each script's `while` reads
the flag (`games/reference/game.ts`, `seller_rounds` and `seller_rounds_late`). `coupled` pairs a hint (a text, or one
per language) with an answer: `{code:<id>}` in any text becomes the answer and `{hint:<id>}` the hint, in every
language at once, after the translation; the content accepts the answer through the flag
(`games/reference/rooms/hall.ts`, the festival password, and Grandma's riddle in `kitchen.ts`). `puzzle-order` writes
each group's position (`remix.festival-order.board` = 0 when the board comes first).

## Presentation variance

A `presentation` dimension's target is `line:<line id>`, `prop-img:<room>.<prop>`, `palette:<character>` or
`minigame:<rule id>:<param>` (a minigame's text or backdrop only: a parameter that could decide a win, such as a
wheel's answers or a difficulty, is refused, since a proof is keyed by the logical world). It draws from the `cosmetic` stream, writes no flag, takes no constraint, and stays out
of the solver's space (D27): two worlds that differ only by presentation share their proof. Adding a presentation
dimension moves no logical draw.

## Seeds and worlds

A seed is `story` or a code `WS-XXXX-XXXX`: seven Crockford base32 symbols and a check symbol. Typing forgives case,
`I`, `L` and `O`; a wrong symbol is an explicit error, never another world. The same game, manifest, seed and algorithm
version give the same `WorldVariant` (seed, algorithm and version, the manifest's hash, the mode, one value per
dimension, a SHA-256); it is tested in Node, and the check on Chromium, WebKit and Firefox (`npm run e2e:remix`) is
written but has not run yet. The draws come from the seeded generator only, one stream
per dimension; `Math.random` is forbidden in `src/engine/core` by the linter and by a test. A code says nothing about
the player (`docs/dev/threat-models/remix-seed.md`).

## Strategies per mode

Each mode says how its worlds are backed (D25). A **catalogue** enumerates every logical world (at most 10 000) and
each is validated and solved: each one is a release gate. A **generator** builds a world by construction; its
invariants are tested by properties and its published sample of seeds is solved: it is never said that every seed is
proved. The bundled games use catalogues only. Measured on 7 October 2026 with `npm run verify:variants -- --prove
--max=200000` (exhaustive proof per logical world, no softlock): `demo`, story 1 and remix 3 worlds; `reference`,
story 1 and remix, daily and mystery 24 worlds each. The generator path is exercised by a test fixture
(`tests/fixtures/remix-extension.ts`, 527 280 logical worlds): 10 000 seeds give valid worlds (property test), none is
claimed proved.

## Tools

`npm run remix -- --seed <code>` prints a world and its hash (`--json` the whole `WorldVariant`, `--mode`);
`--preview <code>` adds `validate` and a solver witness on that world; `--record=20` records the playtest seeds.
`npm run verify:variants` checks every mode: a catalogue's every world, a generator's sample (`--sample`), with the
coverage per dimension and per pair, the values never chosen, the dominant ones over 1 000 seeds (`--draws`), and a
certificate per logical world in `.cache/proofs/variants/`; `--prove` runs the exhaustive proof, `--out` writes the
report the release publishes. `npm run e2e:remix` compares 50 seeds' worlds and code wheels across the four runtimes.

## Saves, replays and speedruns

A save is the envelope v4 (`SaveEnvelopeV4`): the v3 envelope and the world. A save made before 4.1.15 receives the
story world. A save is never loaded into another world: `SaveWorldMismatch` names the world to rebuild. The session
records the world (`Session.variant`), and a replay rebuilds it from the stored assignment, never from the seed with a
newer generator. The speedrun categories are Story, Fixed (a published seed), Random (drawn at the start and shown),
Mystery and Daily; Fixed and Daily rank each seed apart (`leaderboardKey`), and `worldVerdict` checks a run's world
against what its category allows.

## The daily challenge and Mystery

The Bridge's daily module (`bridge/src/daily.ts`) signs the day's seed and rules for 24 hours (`GET /v1/daily`); the
player verifies the token offline with the public key in `remix.daily`. Mystery is a commitment: `POST /v1/commit`
publishes the signed hash of a seed and a nonce before the run, `GET /v1/reveal/:id` the seed afterwards. The day's
seed depends on the day alone and a Mystery seed is fixed before its commitment is signed: the Bridge never picks a
seed after seeing actions (D26). The reference's daily key is a published test key, so its challenges show the
mechanism, not trust. `bridge serve` mounts it from a configuration's `daily` section (4.1.16), and the player's Remix
menu has a Daily and (4.1.17) a Mystery entry when the game names its Bridge.

## The code wheel

"The Extremely Legitimate Pirate Check" is a minigame, `code-wheel`: two discs drawn from the game's characters,
symbols and answers; turn the small disc until a symbol sits under a character and read its window. The seed draws it
from the `copy-protection` stream, so the same seed gives the same wheel everywhere; the validator checks each wheel
has one solution; the solver treats it as winnable. Modes: `parody` (the default: three wrong answers and it lets you
through), `story`, `strict`, `cosmetic`, `disabled`, `daily`. It turns with buttons, the arrow keys and a gamepad,
announces each turn, lists the whole wheel as text, and does not animate under reduced motion. `npm run code-wheel --
--game <id> --format svg|pdf` prints the discs, cut marks, the centre hole and a booklet, in colour and economy (PDF
with Pillow). It is a playful reconstruction, never DRM; the art direction is the game's own.

Since 4.1.16 its outcome counts. The wheel ends `won`, `passed` (a parody's mercy), `skipped`, `failed` (a `story`
wheel lost after its tries: the story goes on with it) or `disabled`. The engine records the result in the session
(the entry's `mg`, fed back on a replay like a choice) and writes it in the reserved flag `minigame.code-wheel`, which
the story reads with `{ flag: 'minigame.code-wheel', eq: 'failed' }` and the journal reports as `flagChanged`. A
command never sets a `minigame.*` flag (the validator refuses it). Every minigame reports how it ended in the player
(skipped, else won); one that reports nothing (the solver, a replay of a 4.1.15 session) records nothing. A speedrun
category says what it allows of the wheel in `world.codeWheel`: `skip: false` wants it won, `enabled: false` wants it
not played (skipped or disabled), and `medium` (on screen, printed, either) is the player's word, not checked. The whole wheel
plays by keyboard (the arrows turn it, Tab and Enter answer, Escape skips) and by gamepad (left and right turn, up and
down choose an answer, A confirms, B skips), and the focus returns to the game when it closes. A recorded result is the player's word, as the
medium is: the replay checks it was recorded and replays it, not that it was earned; and the solver, whose minigames
report nothing, does not explore the branches a story hangs on `minigame.*` (they are not searched).

## The player and the Studio

The title screen gains **Remix** (after New game and Continue): the story, a new world, a typed seed or the daily
challenge. The page starts again in the chosen world. The pause menu shows the code to copy, or "hidden until the end"
in a masked mode. Accessibility options never touch the seed. A link names a world (`?seed=`, `?daily=`, `?world=`).
The Studio's **Remix** tab lists the dimensions, previews a seed, locks dimensions and rerolls the others, compares two
worlds, draws a puzzle order, counts coverage and bias, lists the anchors and adds one from the Rooms tab's
selection, and plays or exports a world.
