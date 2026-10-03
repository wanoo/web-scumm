# Benchmark: a generated game of any size

*French version: [docs/fr/BENCH.md](../fr/BENCH.md). Numbers measured on 3 October 2026 (v2.3.0) on a laptop; they
move with the machine, the ratios do not.*

`npm run bench -- --rooms=40 --players=3 --items=30 --flags=100 --npcs=5 --scripts=10 --topics=40 --max=200000`
generates a game of that size (`src/engine/tools/stress.ts`) and times every tool on it. The game is a chain: each
room's item opens the next room's lock, playable characters take over at chapter boundaries, walkers patrol pairs of
rooms and emit events, clocks tick in every other room, topics chain flags, trinkets go into bins, ten artificial save
migrations lead to the current version, a checkpoint with goals ends each chapter, two invariants watch the first item.
No art: the layouts are rectangles. A ten-room version runs in `tests/bench.test.ts`.

## Results

| Step | 40 rooms, 3 players, 39 items, 119 rules, 40 topics, 10 scripts | 100 rooms, 5 players, 119 items, 300 flags, 100 topics, 30 scripts |
|---|---|---|
| validate | 15 ms, 0 errors | 41 ms, 0 errors |
| content report | 24 ms | 103 ms |
| world graph + SVG | 1 ms | 2 ms |
| puzzle graph + SVG | 16 ms, 554 nodes | 72 ms, 1 399 nodes |
| texts: extract + translate | 4 ms, 697 texts | 8 ms, 1 752 texts |
| migrate a v1 save (10 steps) | 2 ms | 4 ms |
| solve, chapter 1 | 0.1 s, 156 states, 273 engine runs | 0.2 s, 343 states, 524 runs |
| solve, last chapter | 0.1 s, 257 states, 466 runs | 7.6 s, 3 290 states, 5 435 runs |
| solve, whole game | 0.3 s, 624 states, 123 actions, 1 110 runs | 5.8 s, 2 901 states, 309 actions, 4 499 runs |

Every tool but the solver is linear and instant. The solver is the one to watch.

v2.3 made it run three times fewer engine runs for the same states: an action no written rule can answer (whatever
the conditions) can only fall to a look line, a kind reaction or the fallback line, so it is not run at all (the
profile counts them as *skipped*). On the sample game: 2 076 runs became 280 for the same 35 states.

## What the solver does with a big game

The state space of an adventure game is the product of everything that can vary independently. Before v2.1 the solver
hashed every flag, every item and every script position: the ten-room version of this game, with its clocks, walkers,
"looked at" flags and trinkets, hit the 20 000-state limit after 54 seconds without finishing.

v2.1 asks the puzzle graph what can still change the outcome (`liveness` in `src/engine/tools/puzzle.ts`): rooms,
places, players, the end and the chapter goals are live; an action is live when one of its effects reaches something
live; a thing (item, flag, prop, character position, event) is live when a live action reads it. The rest is left out
of the state and out of the actions tried: a flag only its own setter reads (a "looked at" marker), a trinket no gate
needs, a clock nobody reads, a walker nobody waits for, a topic chain that ends in a flag nothing uses. The same
ten-room game now takes 102 states; the forty-room one 624; the hundred-room one 2 901.

What still multiplies states, by design, is what matters: independent live things. Ten optional items that each open
something, in any order, are 2^10 states. The honest answer for a long game stays:

1. **Chapters** (`checkpoints` with `goals`, `npm run solve -- --chapters`): each chapter is proven from the previous
   checkpoint, with only its own things live. The last chapter above costs 3 290 states; the game as a whole 2 901,
   because the global search drops what earlier chapters consumed.
2. **Invariants** for the "never again" bugs, checked on every explored state.
3. The puzzle graph to see, before solving, what a thing depends on and what it unlocks.

A global solve of a 100-room, 5-player game in six seconds is not a promise that every 15-hour game will be proven in
one go. It says the engine's tools scale with the content, and that the solver spends its budget on the puzzles.

## When it gets slow: the profile

`npm run solve -- --profile` (the Check tab's "Solver health", the `solve` tool with `profile: true`) says why:

```
SOLVER PROFILE
  states explored       35
  engine runs           280  (211 changed nothing, 35 landed on a known state)
  actions not run       1808  (no rule could answer them)
  actions per state     22.3 on average, 27 at most (house, 3 items in the bag…)

What splits the states (states that would merge without it):
      13  room  (3 values)
       4  player hero  (11 values)
       3  flag lou_has_key  (2 values)
…
Use / give combinations per room (over its expansions):
  garden: 272 candidates, 2 answered by a rule, 271 could only fall back (100% useless)
Independent dimensions (their combinations multiply the states; a checkpoint between them would cut it):
  ⚠ item rope, item coin, item book: 8 of 8 combinations seen
Monotonic (never lost once gained): 9 flags, 1 items (shell_phone)
```

Each dimension of the state (an item in the bag, a flag, a prop state, a script position…) is scored by how many
states would merge if it were dropped: the top of that list is what the game's logic is made of, or the puzzle that
went combinatorial. Groups of two-valued dimensions whose combinations all show up evolve independently: a checkpoint
with goals between them makes each chapter's search small. The heat map on the puzzle graph (Check tab) shows the same
numbers on the rules and rooms; "why is this live?" on a card explains why the solver keeps a thing in its state.

## Fewer orders: the partial-order reduction

Two actions that touch different things commute: taking the rope then the coin, or the coin then the rope, land on the
same state. The solver already merges the states (one hash); what it still paid was the orders in between: k
independent pickups before a door are 2^k states when the search cannot finish (a proof of a dead end, a truncated
run). `npm run solve -- --por=sleep|stubborn` (`src/engine/tools/por.ts`) uses what the engine recorded while each
action ran (what it read, what it changed, in the state's dimensions) and, for the actions a condition still holds
back, what the puzzle graph says they need:

| `tests/fixtures/por.ts`, k pickups then a door that cannot open | states | engine runs |
|---|---|---|
| plain, k = 8 | 256 | 2 304 |
| `--por=sleep`, k = 8 | 256 | 1 535 |
| `--por=stubborn`, k = 8 | 9 | 81 |
| plain, k = 12 | 4 096 | 53 248 |
| `--por=stubborn`, k = 12 | 13 | 169 |

`sleep` only skips engine runs (an action tried before an independent one is not tried again on the way back);
`stubborn` explores one of several commuting actions at a time, so the states go too. On the chain-shaped stress game
above nothing commutes and nothing changes; on a real game with optional side quests it is the difference between a
proof and a time-out. The reduction is off by default: the plain search is the proof, and `tests/por.test.ts` checks
that every fixture and the sample game give the same verdict in all three modes.
