# Designing a good SCUMM-style game with this engine

A practical, opinionated guide for a solo author working with an AI assistant. The format is in
[CONTENT_GUIDE.md](CONTENT_GUIDE.md), the method in [WORKFLOW.md](WORKFLOW.md). This page is about taste: what to
write so that the game is fun, fair and finished.

The running example is the sample game, *The Pantry Key* (`games/demo/`): Pixel the cat, three rooms (`house`,
`garden`, `market`), about 15 minutes. Every id quoted here exists in that folder.

## 1. What makes these games work

The classic LucasArts adventures (Monkey Island, Day of the Tentacle) settled a few rules. They still hold.

| Rule | What it means here |
|---|---|
| **No death** | The hero never dies and never loses. Minigames cannot be failed (`then` always plays). |
| **No dead ends** | The player can never reach a state where the game cannot be finished. `npm run solve` proves it. |
| **Every action is answered** | Any verb on any thing gets a line. A wrong try is a joke, not a silence. |
| **Humour lives in the failures** | Most of what a player reads is a reaction to a wrong idea. That is where the voice is. |
| **Thinking, not pixel hunting** | Every useful thing is named, visible and has a Look line. The puzzle is in the head, not in the hitbox. |
| **A small cast with strong voices** | Four or five characters you can tell apart from one line. |
| **One goal per room** | The player always knows what they want here. The storyboard says it in `goal`. |
| **10 to 20 minutes per room** | Long enough to explore, short enough to finish on a bus. |

The demo follows all of them. Pixel cannot fail. Pulling Biscuit gives "Never pull a cat. Cat law, article one."
The key is never hidden in a corner: it is in a tank that a character tells you about.

## 2. Story first

Write the story before any room file. Four answers, one line each:

| Question | The demo |
|---|---|
| Premise in one sentence | Grandma locked the sardines in the pantry and lost the key. |
| The hero's want | Pixel wants the sardines. |
| The obstacle per room | House: nobody knows where the key is. Garden: it fell in a tank with a stuck tap. Market: it is a deposit for a lantern. |
| The ending | The pantry opens, two cats share one tin, the sealed card judges the player's guess. |

If you cannot fill this table, do not open the editor yet.

### Write it as the storyboard

`games/<id>/storyboard.json` is the source of truth for every text ([schema](../../tools/pages/storyboard-schema.md)).

- **One board per room**, in play order, with its `goal`. The demo has `opening`, `house`, `garden`, `market`, `finale`.
- **One panel per beat.** A beat is something that changes: an item gained, a door opened, a revelation.
- **Each panel names the player `action`** that triggers it: `garden-1` "Pick up pipe", `garden-3` "Use pipe with
  water tank → minigame pipes", `garden-5` "Look at sock". If you cannot write the action, the beat is not a puzzle yet.
- **`talks`, `reactions` and `hints`** sit on the board. Reactions are the optional gags; hints go vague to precise.

Review it on a phone (`npm run page:storyboard`) until the author says it is final. Only then write rooms.

### The rhythm of repeated looks

A `look` list cycles, one line per look. Use the rhythm **normal, normal, normal, absurd**: three useful or plain
lines, then a joke that rewards the player who keeps clicking. The demo's pantry:

```ts
pantry: ['The pantry cupboard. The sardines live in there.',
  'Locked. I can hear the sardines. (Sardines are silent. I hear them anyway.)',
  'Still locked. Still sardines.', 'I could stare at it all day. I might.'],
```

Two lines are fine for decor (`gnome`: "He has seen things." then "He never blinks. Respect."). Never put the
solution only in the fourth line.

## 3. Puzzle design with this engine

### The five shapes the DSL handles well

| Shape | How it is written | In the demo |
|---|---|---|
| **Fetch and give** | `give` rule with `a` = item, `b` = actor | `bouquet` → `seller` gives the `key` |
| **Combine two items** (or item on a thing) | `use` rule with `a` and `b`; in `rules.on` if it works everywhere | `pipe` on `tank` |
| **State machine prop** | `states` + `{ prop: [...] }` command + `if: { prop: [...] }` | `armchair`: `remote` → `searched`; `tank`: `full` → `draining`; `pantry`: `locked` → `open` |
| **Dialogue unlock** | a talk topic that sets a flag or `unlock`s a place | Grandma's "Where is the key?" unlocks `garden`; Lou's topic sets `deposit_known` |
| **Minigame as a gate** | `{ minigame, params, then }` inside a rule | `pipes` drains the tank, `pick` wins the bouquet |

Anything else (timers, real-time action, random outcomes) fights the solver. Avoid it.

### Chains and the "aha"

- **3 to 6 steps per room.** The garden: take `spare_pipe` → use `pipe` on `tank` → pipes → look at `sock` → talk to
  `shell_phone`. Five steps.
- **One "aha" per room.** The garden's is the sock: you drain a tank for a key and find a note instead. The market's is
  the anniversary: the seller wanted flowers because he forgot his wedding anniversary.
- **Cross rooms once or twice.** The `token` comes from the house armchair and pays at the market. That is enough.
- **Say the goal out loud.** Grandpa says "Drain it. But the tap is stuck." The player knows *what*, not *how*.

### Hints in puzzle order

Each room has `hints`. The engine gives the first entry whose `until` condition is still false. Write them in the order
of the puzzle, one entry per step, vague then precise inside an entry. The garden:

```ts
hints: [
  { until: { any: ['pipe_taken', 'tank_drained'] }, lines: ['There is a spare pipe on the ground. Take it, sweetie.'] },
  { until: 'tank_drained', lines: ['Use the pipe on the water tank.', 'Pipe. Tank. Together. Go!'] },
  { until: 'lou_has_key', lines: ['Something came out of the tank. Look at it.'] },
  { until: { unlocked: 'market' }, lines: ['Talk into my shell phone and call Lou.'] },
  { until: { has: 'key' }, lines: ['Lou is at the market. Open the map.'] },
  { until: 'pantry_open', lines: ['Come home with that key, sweetie!'] },
],
```

Two habits: use `any` when a step can be skipped (the pipe is gone once the tank is drained), and always cover the
rest of the game, so the hint voice is never silent in a room the player comes back to.

### What the solver proves

`npm run solve` plays the real engine with a silent screen. It tries every action from "New game", keeps only states
that differ in what matters, and stops when it reaches the ending. The demo prints "The game can be finished" and a
16-action path, from "(tutorial) Look at pantry" to "Use key with pantry". What the solver finds, a player can do.

It also prints three warnings worth reading:

| Output | Meaning | Fix |
|---|---|---|
| `Dead ends (n): - garden, inventory [shell_phone, pipe] after: A › B › C` | A state where no action changes anything | An item was consumed with no way to get another, a flag closed the only way forward, or a topic's `if` hides the clue. Give the item back, or loosen the condition. |
| `Items obtained but never used in a rule` | A red herring, or a forgotten puzzle | Use it, or remove it. A visible useless item costs the player minutes. |
| `Items never obtained` | Declared in `items` but nothing gives it | Add the `gain`, or delete the item. |

`npm run solve -- --from=market` starts from a checkpoint, handy while you work on one room.

## 4. Rooms

| Element | Rule of thumb |
|---|---|
| Hotspots + named props + actors | **8 to 15** per room. Fewer feels empty, more feels like pixel hunting. The demo house has 11 named things. |
| Props with states | Only for things the story changes (`armchair`, `tank`, `pantry`). |
| Decor props | No `name` = not clickable (`table`, `chair`, `stall_left`). Use them to dress the scene. |
| Exits | One obvious way out, at the edge of the screen, named after where it goes (`back_door`: "Back to Grandma's house."). |

- **Logical space: 640 × 400**, origin top-left, characters placed by their feet.
- **The floor band.** The walk area sits in the lower part of the background; `floor` (default 395) is its bottom.
  Keep it free of drawn furniture, so props and actors stand on it.
- **Character heights** are in pixels of that space: in the demo, Pixel is 36, Grandma 120, Grandpa (seated) 100. A
  human around 110 to 125 next to a 640-wide room reads right on a phone.
- **Approach points**: set them in the editor (`?edit=<room>`), so the hero walks next to a thing, not onto it.
  `validate` warns when a `walk` target has no geometry.
- **Exits are clickable things**, not invisible edges. A locked exit still answers: the house `window` says "Not yet.
  First, the key. Grandma knows things." until the garden is unlocked.
- **One checkpoint per room** in `game.checkpoints`, with the inventory, flags and props the player would have.
  The demo has `house`, `garden`, `market`, `finale`. Open `?dev&at=market` to test that room alone.

## 5. Dialogue

- **2 to 4 talk topics per character, one that advances the plot.** Grandma: "Where is the key?" (plot), "What is for
  dinner?" (gag with `nth`), "Why lock the sardines?" (character). The plot topic goes first.
- **Topics can appear and change** with `if`: Grandpa's "There was no key in the tank!" shows only once `tank_drained`.
- **`choice` sparingly.** Use it when the player's answer is fun to pick, not to branch the story. The demo has two:
  the opening guess (it sets `guess`, judged at the end) and Lou's "argue or accept", where both answers lead forward.
- **Hug and bye are global** (`globalTalk`): "Can I have a cuddle?" and "Bye!" are added to every menu. Give each
  character a `hug` line and a `refuse` line in `cast.ts`: cheap, and players love them.
- **Speech colours** come from `color` on each character. Make them distinct: Grandma `#ff9ec4`, Grandpa `#8fd3ff`,
  Lou `#b8ff8f`, the seller `#ffb36b`. The hint voice `grandma_voice` reuses Grandma's colour on purpose.
- **The transcript** keeps every line. Players will scroll back: do not hide the only clue in a line said during a
  cutscene with no other trace.
- **Line length for a phone: under 90 characters**, two lines on screen. `validate` warns above 140, but 90 is the
  comfortable limit. Split long speeches into several `say`s.

## 6. The fallback layer

Most clicks hit no written rule. What answers them is the game's voice.

- **`rules.fallbacks`: 3 to 6 variants per verb**, drawn at random, never twice in a row. One array per verb, plus
  `use2` for "Use A with B". The demo has two or three; aim higher in a real game.
- **Write them in character.** Pixel's `push`: "It does not move. I need more breakfast." Pixel's `use2`: "These do
  not go together. Like cats and baths." `{objet}`, `{cible}` and `{nom}` insert names.
- **`kinds`** answer a whole family at once: every `cat` refuses to be pulled, every `person` refuses to be carried.
  A precise `target` wins over a `kind`.
- **`refuse` per character** answers any Give that has no rule: Lou says "Thanks, but my pockets are full. Of other
  people's things."
- **"That doesn't work" is never acceptable.** It tells the player nothing and kills the mood. A fallback should be a
  joke, a hint at the hero's want, or both.

## 7. Minigames

Use one as **a gate the player understands**: the fiction says why you play it. The tank needs another way out, so you
lay pipes. The seller wants flowers, so you pick them.

- **Always a Skip**, except the finale's `scratch` ticket. Skipping still runs `then`, so the story goes on.
- **30 seconds, not 3 minutes.** Three rounds of `pick`, one 4 × 3 grid of `pipes`. `helpAfter` makes the right pipe
  glow when the player is lost.
- **`intro` and `win` lines** frame it in the hint voice.

| Minigame | Fits a fiction about |
|---|---|
| `pipes` | water, plumbing, irrigation, anything that flows |
| `cables` | electricity, a switchboard, a tangle behind the TV |
| `pick` | shopping, choosing the right one, a recipe, a line-up |
| `hide` | hide and seek, finding someone or something in a scene |
| `runner` | a chase, an escape, a race to catch a bus |
| `stroke` | calming an animal, putting a baby to sleep |
| `scratch` | the sealed ending only |

## 8. The map

- **Add one from three places.** With two, a door is enough.
- **Vehicles** (`vehicle: 'car'`, `'plane'`) give each trip a small animation and a sense of distance.
- **The "news" marker** shows where something new is waiting. The demo: the garden has news while `!tank_drained`,
  the house when you hold the key and the pantry is still closed.
- **No locked places shown.** A place appears when a rule `unlock`s it, with a `toast` ("New on the map: the garden").
  Players should never see a pin they cannot use.

## 9. Art consistency

- **One reference sheet** for the style, attached to every image prompt. See [PROMPTS.md](PROMPTS.md).
- **Generate prompts, do not improvise them**: `npm run prompts` writes them from the content (the `description` of
  each room and character), so names, looks and sizes match.
- **Backgrounds with an empty floor band** and no people: 1536 × 960, characters and props are added on top.
- **Props with states drawn on the same sheet, same size, same angle.** `armchair` `remote` and `searched` are
  `home2/r2c1` and `home2/r2c2`: side by side, so the swap does not jump.
- **Cut, then review**: `tools/cut-sheet.py` cuts a sheet, `npm run page:review` shows every cell with keep / redo /
  unused. Regenerate only the redo cells.
- **Never recut a validated sprite.** Recut one sheet at a time, after a backup. Layouts and mouths depend on the cells.

## 10. Sound

- **A loop per room**, set with `music` on the room. Short and quiet; the player hears it for 15 minutes. (The demo has
  none yet and says so in `game.ts`: silence is better than a bad loop.)
- **An sfx on every state change.** Armchair searched: `cloth`. Tank drained: `drop`. Pantry: `latch` then
  `door_open`. Item gained: `select`, `pluck`, `metal`. A change with no sound feels like a bug.
- **The hint voice** is an `offscreen` character (`grandma_voice`) answering through the hint item (`shell_phone`).
  Make it someone the player likes, with a tic ("sweetie") so hints feel like help, not a manual.

## 11. Testing like a player

| Step | Command | Catches |
|---|---|---|
| Validate | `npm run validate` | broken ids, missing Look lines, long lines, flags never set |
| Solve | `npm run solve` | dead ends, unreachable ending, items never used |
| Walkthrough test | `npm test` (`tests/demo-walkthrough.test.ts`) | a scripted full playthrough on the real engine |
| Screenshots | `npm run e2e` | what the solver cannot see: a character on a table, a line cut by the edge |
| A real phone | `npm run dev`, landscape | thumb size, readability, sound, the rotate screen |
| Sealed ending | `npm run seal`, `npm run build`, `npm run check:spoilers` | the ending text never in the clear |

Then hand the phone to someone who has never seen the game, and stay silent. Every time they hesitate more than a
minute, write it down: it is a missing Look line, a vague hint, or an exit nobody saw. See [TOOLS.md](TOOLS.md) and
[STUDIO.md](STUDIO.md) (the Check tab runs validate and solve in one place).

## 12. Before you share the link

- [ ] Premise, want, obstacle per room and ending fit in four lines.
- [ ] The storyboard is final, and every room text comes from it.
- [ ] Each room has one goal, 3 to 6 steps, one "aha", 8 to 15 named things.
- [ ] Every named thing has a Look line; repeated looks follow normal, normal, normal, absurd.
- [ ] Each character has 2 to 4 topics, a `hug`, a `refuse` and a distinct colour.
- [ ] Each verb has 3 to 6 fallbacks in the hero's voice. No "That doesn't work".
- [ ] Hints cover every step of every room, in order, until the ending.
- [ ] Every minigame has a reason in the story, a Skip, and lasts about 30 seconds.
- [ ] The map shows only unlocked places; news markers point to the next step.
- [ ] Every state change has a sound.
- [ ] No line over 90 characters.
- [ ] `npm run validate`: no errors. `npm run solve`: finished, no dead ends, no unused items.
- [ ] `npm test` and `npm run e2e` pass; screenshots reviewed.
- [ ] Played start to end on a real phone, in landscape.
- [ ] Sealed ending checked with `npm run check:spoilers`.
- [ ] Someone else played it without help.
