# Benchmark: a generated game of any size

*French version: [docs/fr/BENCH.md](../fr/BENCH.md). Numbers measured on 3 October 2026 (v2.3.0) on a laptop; they
move with the machine, the ratios do not. The v3.1 numbers (4 October 2026, schema 3, the exhaustive proof) are at the end.*

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

## v3.1: schema 3 and the exhaustive proof (4 October 2026)

`npm run bench -- --v3` generates the stress game with stable ids (`assignIds`), as a real v3 game; `--prove` adds the
exhaustive search (`solve -- --prove`: every reachable state, the softlocks). Same laptop as above.

| Step | 40 rooms, 3 players (v3) | 100 rooms, 5 players (v3) |
|---|---|---|
| validate | 11 ms, 0 errors | 41 ms, 0 errors |
| solve, whole game (witness) | 0.13 s, 624 states, 123 actions, 1 110 runs | 3.0 s, 2 901 states, 309 actions, 4 640 runs |
| solve, last chapter (witness) | 63 ms, 257 states | 4.5 s, 3 290 states |
| solve, whole game, `--por=stubborn` | 0.16 s, 624 states, 0 postponed (a chain: nothing commutes) | 2.9 s, 2 901 states, 0 postponed |
| solve, whole game, `--prove` | **truncated** at 50 000 states after 408 s, 119 411 runs | not attempted |

The witness did not move between v2.3 and v3.1 (same states, same runs: the stable ids change nothing for the
search). The exhaustive proof is another matter: it visits every reachable state, the partial-order reduction is off
in that mode (a reduction must not drop a losing branch from a proof until it has its own equivalence proof), and a
40-room game already exceeds a 50 000-state budget. So `npm run prove:game` is a release gate for a small game (the
sample proves in 1.3 s) and a weekly job with a budget for a big one (`.github/workflows/prove.yml`); on a long game,
prove chapter by chapter (`--prove --chapters`), where each search is bounded by its goals. Bringing the reduction into
proof mode, with the equivalence tests of `tests/por.test.ts` as its proof, is the next step for the solver.

## v3.2: softlock causes, the proof by chapters, and where the proof stops (4 October 2026)

A proof now reports **every** reachable softlock state (`softlockCount`), grouped by the step that lost the game
(`softlockCauses`: the first action from a state that could still win into one that cannot), and a proof from "New
game" branches over the intro's choices too (the demo's proof grew from 2 176 to 6 528 states: it had only proved the
default answer). `npm run solve -- --prove --chapters` proves each chapter from **every** reachable boundary state of
the previous one (every state where its goals hold, deduped by what the next chapter reads), and reports a checkpoint
that matches none, with the dimensions that differ: it found three of the demo's four checkpoints disagreeing with
the content (Biscuit's position and the pipe already used, a once-listener already fired, the room where the key is
found), all fixed. One state budget covers the whole proof (`maxStates × 10`, at most 1 000 boundary starts per
chapter): past it the result is `truncated`, never green.

Same laptop; 12 items, 30 flags, 1 walker, 2 scripts, 8 topics; `maxStates` 20 000:

| Game | Global proof | Proof by chapters |
|---|---|---|
| sample game (3 rooms, 4 chapters) | solved, 6 528 states, 4.9 s | solved from 1/78/243/312/288 boundary states, 115 670 states, 89 s |
| 20 rooms, 1 player, 4 chapters | solved, 797 states, 0.2 s | solved, 1 466 states, 0.4 s |
| 40 rooms, 1 player, 8 chapters | solved, 3 197 states, 1.1 s | solved, 6 034 states, 2.3 s |
| 20 rooms, 2 players, 4 chapters | **truncated** at 20 000 states, 8.7 s | **truncated** in chapter 1, 6.8 s |
| 40 rooms, 3 players, 3 chapters | **truncated** at 20 000 states, 51 s | **truncated** in chapter 1, 26 s |

What this says, plainly: the exhaustive proof is complete and fast for a single-character chain of 40 rooms; with
several playable characters the reachable states multiply (each one's room and bag) and both proofs stop at the
budget and say so. **This is a limit of the explicit search as written, not of the engine**: the state keeps every
character's exact room and the active character, and a switch of character is a transition of its own, so equivalent
states are explored thousands of times (three characters free in 30 rooms: 81 000 position combinations before any
flag). The 3.3 solver track (ROADMAP) attacks exactly that. Cutting the game into chapters does not change that, because the first chapter already holds the
product; it checks the checkpoints and proves each chapter from every way into it, which is what a long
single-character game needs. Without a written equivalence argument, the reductions stay off in proof mode, and the
differential suite (`tests/por.test.ts`) shows why: sleep sets invent softlocks on three of eight fixtures (dropped
edges feed the reverse reachability that classifies them), stubborn sets agreed on all eight. A multi-character
long game is proved per character (a checkpoint where the others wait) or relies on the witness, the chapter
witnesses and the playtests. The solver's next steps, in order (an outside review, LOG #38): measure where the time goes (engine runs, clones,
hashes, queue); a proof-mode frontier without best-first ordering or copied paths; the active character out of the
state (each character's actions offered from one canonical state, a switch kept explicit only when it has an effect);
**mobility regions** (rooms joined by reversible, silent exits merged into one region per character, moves as macro
steps with the route kept for the walkthrough); chapter interfaces projected on what the rest reads; a proof-safe
reduction (dependency closure, goal and invariant visibility, deadlocks, a cycle proviso, since the property is
"from every reachable state the ending stays reachable"), validated against the explicit search on thousands of
generated games with every counter-example replayed on the real engine; then parallel frontiers. Exit criterion: the
40-room stress game proved with 1, 2 and 3 characters, a state count that no longer grows like the product of
positions, no generated game where the reduced and explicit verdicts differ, and a truncation that stays a truncation.

## v3.3 "Scale": the reference matrix (4 October 2026)

`npm run bench -- --matrix --max=20000`: the exhaustive proof on generated chains of 20 and 40 rooms with 1, 2 and 3
playable characters (12 items, 30 flags, 1 walker, 2 scripts, 8 topics). `Positions` counts the distinct
(active character, room of each character) combinations among the states; the time split comes from the solver's
own profile (`profile.timing`).

| Game | Proof | States | Engine runs | Time | Positions | Time split (run / clone / hash / queue / tries / other) |
|---|---|---|---|---|---|---|
| 20 rooms, 1 character | solved | 797 | 3 295 | 0.2 s | 20 | 47% / 21% / 13% / 3% / 6% / 7% |
| 20 rooms, 2 characters | truncated | 20 000 | 100 863 | 7.6 s | 800 | 45% / 23% / 9% / 15% / 2% / 4% |
| 20 rooms, 3 characters | truncated | 20 000 | 49 538 | 22.6 s | 13 858 | 9% / 5% / 2% / 83% / 0% / 1% |
| 40 rooms, 1 character | solved | 3 197 | 13 245 | 1.1 s | 40 | 46% / 25% / 13% / 6% / 3% / 5% |
| 40 rooms, 2 characters | truncated | 20 000 | 92 475 | 19.0 s | 3 200 | 30% / 16% / 8% / 42% / 1% / 3% |
| 40 rooms, 3 characters | truncated | 20 000 | 44 298 | 50.9 s | 18 796 | 6% / 3% / 1% / 89% / 0% / 1% |

Two causes, measured. **The states are positions**: with two characters on 20 rooms, the 800 positions are exactly
20 × 20 × 2, every combination; with three, positions are most of the states. **The time goes to the queue** as soon
as states pile up: the best-first queue inserts in O(n) (`splice`), 83–89% of the time with three characters; with one
character, running the engine (about half) and copying states (about a quarter) dominate. The 3.3 branches attack
them in that order: an exact proof core (O(1) frontier, parent pointers), then the canonical character and the
mobility regions for the positions.

### After `v33-proof-core` (exact: same witnesses, same proofs, same printed output on the demo)

The frontier is a binary heap in the old list's order (score, then arrival), and a state keeps a pointer to its
parent and its last step instead of a copy of the whole path and session.

| Game | Proof | States | Engine runs | Time | Positions | Time split (run / clone / hash / queue / tries / other) |
|---|---|---|---|---|---|---|
| 20 rooms, 1 character | solved | 797 | 3 295 | 0.2 s | 20 | 48% / 22% / 13% / 1% / 7% / 7% |
| 20 rooms, 2 characters | truncated | 20 000 | 100 863 | 6.6 s | 800 | 53% / 27% / 11% / 0% / 3% / 5% |
| 20 rooms, 3 characters | truncated | 20 000 | 49 538 | 4.1 s | 13 858 | 53% / 29% / 10% / 0% / 2% / 5% |
| 40 rooms, 1 character | solved | 3 197 | 13 245 | 1.1 s | 40 | 49% / 26% / 14% / 0% / 3% / 6% |
| 40 rooms, 2 characters | truncated | 20 000 | 92 475 | 11.4 s | 3 200 | 52% / 27% / 13% / 0% / 2% / 5% |
| 40 rooms, 3 characters | truncated | 20 000 | 44 298 | 6.2 s | 18 796 | 50% / 29% / 13% / 0% / 1% / 5% |

The queue is gone from the profile (89% → 0%) and the heaviest case runs 8× faster for the same 20 000 states
(50.9 s → 6.2 s). The state counts are unchanged, as they must be: what remains is the engine (about half) and the
state copies (about 30%), and above all the number of states, which the next branches attack.

