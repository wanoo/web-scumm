# Benchmark: a generated game of any size

*French version: [docs/fr/BENCH.md](../fr/BENCH.md). Numbers measured on 3 October 2026 (v2.1.0) on a laptop; they
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
| validate | 12 ms, 0 errors | 38 ms, 0 errors |
| content report | 16 ms | 103 ms |
| world graph + SVG | 1 ms | 2 ms |
| puzzle graph + SVG | 5 ms, 554 nodes | 24 ms, 1 479 nodes |
| texts: extract + translate | 3 ms, 697 texts | 6 ms, 1 892 texts |
| migrate a v1 save (10 steps) | 1 ms | 2 ms |
| solve, chapter 1 | 0.2 s, 157 states | 0.7 s, 344 states |
| solve, last chapter | 0.3 s, 257 states | 10.7 s, 3 290 states |
| solve, whole game | 0.8 s, 624 states, 123 actions | 8.1 s, 2 901 states, 309 actions |

Every tool but the solver is linear and instant. The solver is the one to watch.

## What the solver does with a big game

The state space of an adventure game is the product of everything that can vary independently. Before v2.1 the solver
hashed every flag, every item and every script position: the ten-room version of this game, with its clocks, walkers,
"looked at" flags and trinkets, hit the 20 000-state limit after 54 seconds without finishing.

v2.1 asks the puzzle graph what can still change the outcome (`liveness` in `src/engine/tools/puzzle.ts`): rooms,
places, players, the end and the chapter goals are live; an action is live when one of its effects reaches something
live; a thing (item, flag, prop, character position, event) is live when a live action reads it. The rest is left out
of the state and out of the actions tried: a flag only its own setter reads (a "looked at" marker), a trinket no gate
needs, a clock nobody reads, a walker nobody waits for, a topic chain that ends in a flag nothing uses. The same
ten-room game now takes 133 states; the forty-room one 624; the hundred-room one 2 901.

What still multiplies states, by design, is what matters: independent live things. Ten optional items that each open
something, in any order, are 2^10 states. The honest answer for a long game stays:

1. **Chapters** (`checkpoints` with `goals`, `npm run solve -- --chapters`): each chapter is proven from the previous
   checkpoint, with only its own things live. The last chapter above costs 3 290 states; the game as a whole 2 901,
   because the global search drops what earlier chapters consumed.
2. **Invariants** for the "never again" bugs, checked on every explored state.
3. The puzzle graph to see, before solving, what a thing depends on and what it unlocks.

A global solve of a 100-room, 5-player game in eight seconds is not a promise that every 15-hour game will be proven in
one go. It says the engine's tools scale with the content, and that the solver spends its budget on the puzzles.
