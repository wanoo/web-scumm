# The classics: famous adventure mechanics, written with this engine

*French version: [docs/fr/CLASSICS.md](../fr/CLASSICS.md). Written for v2.1; every "native" entry below is the actual
DSL, and five of them are played by the engine and proven by the solver in `tests/classics.test.ts`
(fixtures in `tests/fixtures/classics.ts`).*

Before asking for a new primitive, check here: most of what made the LucasArts games memorable is a combination of
rules, flags, scripts and events the engine already has. The verdicts:

| Verdict | Meaning |
|---|---|
| **native** | The DSL as is, a few lines; the validator and the solver understand it. |
| **feasible** | The DSL does it, with a detour or a convention worth knowing. |
| **custom** | A minigame of the registry or a `custom` command: the engine runs it, the solver only knows its declared effects. |
| **out of scope** | The engine will not do it, on purpose. |

## Monkey Island

### Insult sword fighting — native (tested)

Insults are learnt from a thug: each one is a flag. The duel is a topic whose `choice` prompts offer only the replies
the hero knows; the right ones count wins, the threshold ends the duel. No minigame needed: the fight *is* a conversation.

```ts
talk: {
  thug: [{ topic: 'Fight me!', if: '!learned_farmer', do: [{ say: ['thug', 'You fight like a dairy farmer!'] }, { set: 'learned_farmer' }] }],
  master: [{ topic: 'I challenge you!', do: [
    { say: ['master', 'You fight like a dairy farmer!'] },
    { choice: [
      { text: 'How appropriate. You fight like a cow.', if: 'learned_farmer', do: [{ inc: 'wins' }] },
      { text: 'Oh yeah?', do: [{ say: ['master', 'Pathetic.'] }] } ] },
    { if: { flag: 'wins', gte: 2 }, then: [{ set: 'master_beaten' }], else: [{ set: ['wins', 0] }] } ] }],
}
```

The solver tries every reply of a `choice`, so it proves the duel can be won, and only after the insults were learnt.

### The three trials, in any order — native

Three flags, one rule that needs all three, and a chapter checkpoint whose `goals` list them:
`checkpoints: { pirate: { room: 'bar', goals: ['trial_sword', 'trial_theft', 'trial_treasure'] } }`.
`npm run solve -- --chapters` proves each trial reachable from the previous checkpoint, whatever the order.

### Haggling with the used-ship salesman — native (tested)

A numeric flag goes *down*; a topic opens under a threshold, another one closes.

```ts
start: { room: 'yard', inventory: ['coins'], flags: { price: 8000 } },
talk: { stan: [
  { topic: 'That is too much.', if: { all: ['asked', { flag: 'price', gte: 6000 }] }, do: [{ inc: 'price', by: -1000 }, { say: ['stan', 'Fine, 1000 less!'] }] },
  { topic: 'Deal.', if: { all: ['asked', { flag: 'price', lt: 5001 }, { has: 'coins' }] }, do: [{ lose: 'coins' }, { set: 'ship_bought' }] } ] }
```

The solver keeps the exact value of a counter that is ever lowered (it only clamps counters that go up).

### The mug of grog that melts — native (tested)

A world script with a `while`: as long as the hero carries the mug, time eats it. The player must hurry, or refill.

```ts
scripts: [{ id: 'mug_melts', loop: true, while: { has: 'mug_grog' },
  do: [{ wait: 8000 }, { gain: 'mug_holey' }, { lose: 'mug_grog' }, { toast: 'The mug melted.' }] }]
```

Gain the new mug *before* losing the old one: `while` is checked before every command. The solver plays "let the mug
melt" as one of the choices and still finds the path where the hero arrives in time.

### Following the storekeeper to the Sword Master — native

A script waits for the hero to catch up, room after room:

```ts
scripts: [{ id: 'keeper_leads', do: [
  { waitEvent: 'ask_master' }, { moveActor: ['keeper', 'path'] }, { waitUntil: { room: 'path' } },
  { moveActor: ['keeper', 'forest'] }, { waitUntil: { room: 'forest' } }, { set: 'master_found' }, { moveActor: ['keeper', 'shop'] } ] }]
```

### The rubber chicken with a pulley in the middle — native

An exit with a condition and a line when it is not met: `exits: { cable: { name: 'cable', to: 'island', if: { has: 'chicken' }, locked: 'Too far to jump.' } }`.

### The forest maze and the navigator's head — feasible

Rooms linked by `exits`, several of them leading back to the same room (`oneWay: true` silences the validator's
"no way back"), and a flag the head sets (`{ set: 'head_points' }`) that opens the right exit (`if: 'head_points'`).
It works, it is tedious to write, and the world map in the Studio helps more than the DSL does. A generated maze is not
something this engine offers.

### Ten minutes under water with the idol — feasible

A script with a long `wait` and a `while: { room: 'seabed' }`: when it ends, a cutscene and a `goto` to a "game over"
room with `{ end: true }`. What the engine lacks is a "reload the last autosave" command: the player presses Continue
on the title screen, or a `custom` command calls `engine.load()`.

### The spitting contest and the wind — native

A looping script that raises and drops a flag, with a looping prop animation to show it:

```ts
scripts: [{ id: 'wind', loop: true, do: [{ wait: 3000 }, { set: 'wind_blows' }, { play: ['flag', 'flutter'] }, { wait: 3000 }, { unset: 'wind_blows' }, { stopAnim: 'flag' }] }],
on: [{ verb: 'use', a: 'spit', b: 'line', if: 'wind_blows', do: [{ set: 'spit_won' }] }]
```

Because the solver advances a script one `wait` at a time, it sees the state with the wind up.

### The four map pieces — native

Four items, one rule with `{ all: [{ has: 'piece_1' }, …] }`, or a `goals` list on the chapter's checkpoint.

### The library catalogue — native

A `choice` with as many options as drawers, one right one. Since v2.1 the solver tries every option.

### Largo's voodoo doll, four ingredients — native

One rule per ingredient on the doll (`use thread on doll` → `{ set: 'doll_thread' }`), then the needle, guarded by
`{ all: ['doll_thread', 'doll_bone', 'doll_spit', 'doll_hair'] }`.

### Stan locked in the coffin — native

The coffin's rule emits an event; a game listener moves him: `events: [{ on: 'coffin_closed', do: [{ moveActor: ['stan', 'coffin'] }, { set: 'stan_boxed' }] }]`.
Every room where Stan can be lists him in `actors`; `{ actorIn: ['stan', 'coffin'] }` guards the rules that need him there.

## Day of the Tentacle

### The tree planted in the past, seen in the future — native (tested)

Two playable characters. One sets a flag in his room; a hotspot of the other's room is `visible` under that flag.

```ts
players: { ids: ['hoagie', 'laverne'], start: { laverne: { room: 'future' } } },
// past: { verb: 'use', a: 'seed', b: 'ground', do: [{ lose: 'seed' }, { set: 'tree_planted' }] }
// future: hotspots: { tree: { name: 'huge tree', visible: 'tree_planted' }, stump: { name: 'bare ground', visible: '!tree_planted' } }
```

### The Chron-O-John: an item sent to another time — native (tested)

`{ transfer: ['fruit', 'hoagie'] }` moves the item to the other character's bag, wherever he is. Giving an item to a
playable character standing in the room does the same.

### The frozen hamster — native

Items with states are two items: `{ lose: 'hamster' }, { gain: 'hamster_frozen' }`. The report lists both and where they come from.

### The storm, the lightning, the cutscene — native

`cutscene` plus `parallel`, with frame events on the animation:
`{ parallel: [[{ anim: ['sky', 'lightning'], at: { 2: [{ sfx: 'thunder' }, { shake: 4 }] } }], [{ say: ['hoagie', 'Uh-oh.'] }]] }`.

## Maniac Mansion

### The nurse on patrol, and the dungeon — feasible, with a different clock (tested)

A script moves her between two rooms and emits an event after each move; the rooms' `onEnter` and a game listener
catch the hero when they meet; the dungeon has a loose brick.

```ts
scripts: [{ id: 'edna_patrols', loop: true, do: [{ wait: 6000 }, { moveActor: ['edna', 'hall'] }, { emit: 'edna_moved' }, { wait: 6000 }, { moveActor: ['edna', 'kitchen'] }, { emit: 'edna_moved' }] }],
events: [{ on: 'edna_moved', if: { all: [{ room: 'hall' }, { actorIn: ['edna', 'hall'] }] }, do: [{ say: ['edna', 'Got you!'] }, { goto: 'dungeon' }] }],
// hall: onEnter: [{ if: { actorIn: ['edna', 'hall'] }, then: [{ say: ['edna', 'Got you!'] }, { goto: 'dungeon' }] }]
```

The honest difference with the original: scripts run *between* the player's actions, never during one. The patrol is
turn by turn, not real time: Edna cannot walk in while the hero is mid-sentence. That is what makes the solver able to
prove the puzzle (it waits for her to leave, then crosses), and what a save restores exactly.

### The doorbell — native

`{ emit: 'doorbell' }` on the button, listeners in the rooms that react (`once: true` for the one-time gag).

## Sam & Max

### "Use Max on…" — feasible

The partner is both an item (`items: { max: { name: 'Max' } }`, in the starting inventory) and an actor listed in every
room's `actors` without a starting `room`, so he is always there. `use max on door` is a rule like any other, with an
`anim` of the actor. The engine has no notion of "companion"; this convention is enough.

### The running gag when nothing works — native

`rules.fallbacks` per verb, a list for variety, plus `rules.kinds` for a line per kind of thing (`kind: ['glass']`).

## Indiana Jones, Loom

### The three paths (team, wits, fists) — native

A `choice` early on sets a flag; rooms, topics and rules carry `if` on it. The solver proves each path with a chapter
checkpoint per branch.

### Fist fights, the drafts of Loom — custom

A minigame of the registry (`minigames` exported by `games/<id>/index.ts`): the engine draws nothing of it, the solver
counts it as won. `{ minigame: 'fists', params: { rounds: 3 }, then: [{ set: 'guard_down' }] }`.

## What stays out of scope

- A real-time world: scripts advance between actions, animations and loops are the real-time layer (see "The world lives").
- A second dialogue format: topics, `choice` and `if` are the dialogue graph; the Studio draws it.
- Physics, zoom, a camera that moves on two axes.
