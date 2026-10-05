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

## Fewer orders: the partial-order reduction (historical, v2.3)

> **Never use the partial-order reduction to certify that a game has no softlock.** Measured in proof mode in 3.3, it
> reported a softlock that does not exist ([below](#after-v33-noop-memo-no-partial-order-reduction-in-proofs-a-no-op-memo-instead)).
> `--por` only applies to witness searches: in proof mode the solver ignores it and says so. This section is the v2.3
> measurement, kept as it was.

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
proof and a time-out (in a witness search: see the banner). The reduction is off by default: the plain search is the
proof.

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

### After `v33-player-canonical` (same verdicts, checked against the explicit search)

In proof mode, states that differ only by the active character are one state, and each state offers every
character's actions (`Switch to X › action`) when the switch changes nothing the solver reads; a switch that does
stays an explicit step, and invariants are checked on every character's view. The demo's proof: 6 528 → 3 480 states,
same verdict.

| Game | Proof | States | Engine runs | Time | Positions |
|---|---|---|---|---|---|
| 20 rooms, 1 character | solved | 797 | 3 295 | 0.2 s | 20 |
| 20 rooms, 2 characters | truncated | 20 000 | 153 282 | 12.7 s | 757 |
| 20 rooms, 3 characters | truncated | 20 000 | 79 081 | 5.5 s | 60 |
| 40 rooms, 1 character | solved | 3 197 | 13 245 | 1.0 s | 40 |
| 40 rooms, 2 characters | truncated | 20 000 | 83 535 | 6.1 s | 44 |
| 40 rooms, 3 characters | truncated | 20 000 | 65 577 | 6.4 s | 112 |

The active character is no longer a factor (positions 18 796 → 112 with three characters), but the stress chains
still truncate: each character's exact room and bag now split the states. That is the mobility regions' job.

### After `v33-mobility`: mobility regions, and the reference proof

A character's exact room is replaced by its **region**: the rooms it can walk between silently (generated exits and
map trips to rooms without `onEnter`, whose `visited` nothing reads, and that no condition names), the strongly
connected part around it under its own view. The proof offers the actions of every room of the region as
`Go to <room> › action`; the route is played once per room, every hop checked (it arrives, it changes nothing the
solver reads), and one that is not silent restarts the search with exact rooms (`profile.mobility.reason`). The
witness of a region proof replays on the real engine.

**The reference** (`npm run bench -- --matrix --eras`, `makeStressGame({ eras: true })`): each character confined to
its era, the item that opens the next era's first lock sent through a time chute (`{ transfer }`), one-way chutes,
walkers, scripts and topics; `softlock: true` adds a trash can that destroys item 0. Proof mode, 200 000-state budget:

| Game | Proof | States | Engine runs | Time |
|---|---|---|---|---|
| 20 rooms, 1 character | solved | 83 | 1 787 | 0.2 s |
| 20 rooms, 2 characters | solved | 358 | 7 260 | 0.8 s |
| 20 rooms, 3 characters | solved | 481 | 11 277 | 1.1 s |
| 40 rooms, 1 character | solved | 163 | 6 787 | 2.1 s |
| 40 rooms, 2 characters | solved | 678 | 25 660 | 6.5 s |
| 40 rooms, 3 characters | solved | 578 | 21 886 | 4.2 s |

The 3.3 target is met on it: 40 rooms × 3 characters proved in 578 states and 4.2 s. On 12-room versions the
explicit search (both abstractions off) gives the same verdicts with 13–15× more states (2 906 vs 230 with two
characters, 16 944 vs 1 100 with three), and finds the same softlock in the negative variant
(`tests/reference-proof.test.ts`).

**The open chain is still out of reach, and that is the game, not the abstraction.** Without eras, every character
can walk the whole chain and pick up anyone's item: which character carries which item is a real product the proof
must cover (20 000-state budget):

| Game | Proof | States | Time |
|---|---|---|---|
| 20 rooms, 2 characters | truncated | 20 000 | 57.9 s |
| 20 rooms, 3 characters | truncated | 20 000 | 33.8 s |
| 40 rooms, 2 characters | truncated | 20 000 | 451.7 s |
| 40 rooms, 3 characters | truncated | 20 000 | 65.9 s |

Exact reductions cannot remove those states; a game built that way is checked by the witness, the chapter witnesses
and the playtests, or by bounding who can carry what. With one character the regions shrink the open chain too
(40 rooms: 3 197 → 163 states).

### After `v33-chapter-interfaces`: one search per chapter, from every boundary state at once

A chapter is now proved by **one** search that starts from all its boundary states together and shares what it has
seen (a state is safe or not whichever start reached it): it costs the union of what the starts reach, not the sum.
Checking that against the explicit search run from each start found a real defect, older than 3.3: a chapter goal
that reads the active character's bag (`{ has: 'token' }`) was evaluated on whichever character the merged state
kept, so some boundary states were lost. A canonical state now reaches a goal when any character, seen as active,
meets it. On the demo, the abstract shared search finds exactly the explicit search's boundaries at every chapter
(`tests/reference-proof.test.ts`), with 15–36× fewer states.

| Demo | Before 3.3 | Now | 3.3 target |
|---|---|---|---|
| Global proof | 6 528 states, 4.4 s | 3 480 states, 4.5 s | under 5 s |
| Proof by chapters | 115 620 states, 90–147 s | 5.7 s | under 20 s |

Mobility is off on the demo, and the profile says why (`no move of this game can be silent`: every room has an
`onEnter` or is named by a condition), which also spares the region computation on every hash.

### After `v33-noop-memo`: no partial-order reduction in proofs, a no-op memo instead

**The reduction, measured in proof mode.** Sleep sets visit every state but skip edges: an action already tried in
a commuting order is not run again. The proof classifies states by reverse reachability over those edges, so a
skipped edge can hide the only way to the goal. On the era game it does: 20 rooms × 3 characters reports a softlock
that the plain proof does not have (40 × 3 too), while skipping under 2% of the engine runs and taking 20–25% longer
(`tests/por.test.ts`, "why proof mode keeps the reductions off"). Reductions stay off in proofs; the cost is
elsewhere: 78% of the demo's engine runs (92% on the era game) change nothing.

**The no-op memo.** The engine now records what a run writes (`Engine.writes`, beside `Engine.reads`), even a value
already there. A run that writes nothing the solver hashes is kept with the values it read; the same action on a
state with the same values is a no-op too, and is not run. It drops no edge (a no-op is a loop), so the proof is the
same. It relies on the read trace being complete: one skip in 16 is run anyway and compared, and a difference is an
error, never a silent skip. `tests/memo.test.ts` runs every skip anyway on twelve fixtures (witness and proof) and on
the demo: same verdicts, states, softlocks, witnesses and reachability counts. This is an equivalence checked on that
corpus, not a proof for every game: a future condition or command that forgets to declare a read would break it, and
only a check that runs every skip would catch it (`npm run solve -- --audit-abstractions`, 3.3.1).

| Demo | Before | With the memo |
|---|---|---|
| Global proof | 129 840 runs, 4.4 s | 40 191 runs, 2.2 s |
| Proof by chapters | 5.7 s | 3.3 s |
| Era game, 40 rooms × 3 characters | 21 886 runs, 4.5 s | 10 647 runs, 3.5 s |

`npm run solve -- --profile` now ends its header with what each abstraction did, or why it is off:

```
Abstractions (what each one did, or why it is off):
  canonical character   3048 switches folded, 0 kept explicit
  mobility regions      off (no move of this game can be silent)
  no-op memo            95625 runs skipped (5976 of them run anyway and identical), 522 kept, 4728 refused
```

### 3.3.0, measured on the release (5 October 2026, cache off)

| Game | Status | States | Engine runs | Time | 3.3 budget |
|---|---|---|---|---|---|
| Demo, global proof | solved | 3 480 | 40 191 | 2.2 s | 5 s |
| Demo, proof by chapters | solved | 5 chapters | | 3.3 s | 20 s |
| Reference, 40 rooms, 1 character | solved | 163 | 764 | 1.8 s | |
| Reference, 40 rooms, 2 characters | solved | 678 | 11 348 | 5.6 s | |
| Reference, 40 rooms, 3 characters | solved | 578 | 10 647 | 3.5 s | 200 000 states, 60 s |

With the proof cache warm, the demo's global proof answers in 0.17 s and its chapters in 1.1 s. The open matrix
(characters not confined to an era, items moving freely) still truncates with 2 and 3 characters: see
"After `v33-mobility`".

## 3.3.1: the abstractions audited (5 October 2026)

`npm run solve -- --audit-abstractions` (`src/engine/tools/audit.ts`) proves the selected game twice: with the
abstractions, every memo hit run anyway and compared, and with all of them off. It fails (exit 1) on any difference in
the verdict, the broken invariants, whether softlocks exist, or the flags, rooms and places reached; it says `partial`
(exit 2) when the explicit search does not fit the budget, because then the verdicts were not compared. On the demo:
`same`, 3 480 states against 6 528, 95 625 memo hits all identical, 9.5 s. `release-check` runs it.

`tests/audit.test.ts` runs the same audit on 120 random games (`tests/gen/random-game.ts`: 2–4 rooms, 1–2 characters,
negative `has`, consumption, transfers, counters, `once` / `nth` / `cycle`, nested `if`), and on one game per command
and per condition of the DSL (the two tables are checked against the `Cmd` and `Cond` types: a new variant without a
sample does not compile). Of the 120 random games, 92 are `same` (the explicit search: 26 solved, 18 with softlocks,
48 unsolved) and 28 `partial` at 3 000 states; none diverged.

What it found, and what is fixed:

- **A dead flag that was not dead.** The first written rule that matches answers. A flag that gates only an earlier
  rule, which itself only touches that flag, looked dead to the liveness analysis, yet it decides whether the earlier
  rule or a later one answers. The solver merged the two states and lost every path through the later rule; on one
  random game, the abstractions happened to reach a flag the explicit search did not. This was a flaw of the base
  search, not of an abstraction. The puzzle graph now links an earlier rule's condition to every later rule it can
  shadow (`puzzleGraph`); the demo and the reference game keep exactly the same state counts.
- **Rooms reached.** With the canonical character, a room where only another playable character stood was missing
  from `roomsReached` (and so could be reported by the lint as never reached). Every character's view now counts.

## 3.4: the reference chapter (5 October 2026)

`games/reference`, "The Night Market": 8 rooms, 9 items, 5 characters, two of them playable (Pixel and Biscuit, who
hand items to each other and open places for each other), a staged market (Canvas, 960 wide, 6 layers with
parallax, 3 occluders, 2 walk zones joined by stairs), a yard on two planes (a ladder opened by a flag, a jump for
Biscuit only), an autonomous script, a minigame, a timeline finale. Measured on an M-series laptop, cache off.

| Measure | Result | Gate |
|---|---|---|
| Witness | 1 450 states, 0.6 s, 49 steps | — |
| Global proof | solved, 904 states, 1.9 s | no softlock |
| Proof by chapters (`lights`, `ending`) | 848 + 72 states, 16 boundary states, 2.0 s | every chapter from every boundary state |
| `--audit-abstractions` | `same`: 904 states against 83 672 explicit, 36 144 memo hits identical, 40.8 s | no divergence |
| Frame rate, CPU ÷4, Canvas | market 50.2 fps (47.3 at ÷8), yard / alley / street 60.2 fps | ≥ 30 fps |
| First visit | 1 989 KB transferred, 2 198 KB predicted, nothing outside the prediction | within 10%, nothing outside |
| Rooms | 541–718 KB each; the whole chapter 4 249 KB | 3 000 KB a room, 6 000 KB a chapter |
| Visual baselines | 8 / 8 rooms, 0.00% | ≤ 0.5% |

Played to the end by CI: at the keyboard in Chromium and WebKit, in French with no English default visible, and by
the generic harness with axe and a save round trip.

### 3.4.0, measured on the release (5 October 2026, cache off)

| Game | Status | States | Time | Against 3.3.0 |
|---|---|---|---|---|
| Demo, global proof | solved | 3 480 | 2.3 s | same states (2.2 s) |
| Demo, proof by chapters | solved | 5 chapters | 3.6 s | same chapters (3.3 s) |
| Era reference, 40 rooms × 3 characters | solved | 578 (10 647 engine runs) | 3.9 s | same states (3.5 s) |
| The Night Market, global proof | solved | 904 | 1.9 s | new |
| The Night Market, by chapters | solved | 2 chapters | 2.0 s | new |

3.4 changed the picture, not the logic: every state count is the one 3.3.0 measured; the times move within the
noise of a laptop.

## 3.5: proof workers (5 October 2026)

`npm run solve -- --prove --workers=N` (`src/engine/tools/solve-pool.ts`): the search takes a batch of nodes from its
frontier (64 by default, best first), each node goes to whichever worker thread is free, and the expansions come back
to be merged in the batch's order. An expansion reads nothing of the search (no `seen`, no frontier): it is the node's
tries run on the engine, built from the game and the options alone (`makeExpander`), the same in every thread. The
merge, in the search's thread, is where `seen`, the goals, the edges and the frontier change. So the result depends on
the batch and never on the number of workers; one worker is the same batched search in the search's thread. Without
`--workers` nothing changes: one node at a time, the same witnesses and proofs as 3.4 (checked byte for byte on the
demo and the reference chapter, witness and proof). A worker that cannot start, or stops, leaves its nodes to the
search's thread (the result does not change; `profile.workers.reason` says it); the custom commands reach the workers
from the game's module; the partial-order reduction keeps them off. `--time` stops a search, workers or not.

Measured with `npm run bench -- --workers-table` on a 10-core laptop, cache off:

The open chain, 20 rooms × 2 characters, items moving freely, stopped at 40 000 states:

| Workers | Proof | States | Time | Speed-up | Result |
|---|---|---|---|---|---|
| none (one node at a time) | truncated | 40000 | 58.1 s | ×1.00 | `9806965f9b` |
| 1 | truncated | 40000 | 55.0 s | ×1.06 | `530cfb4002` |
| 2 | truncated | 40000 | 32.3 s | ×1.80 | `530cfb4002`, the same as 1 |
| 4 | truncated | 40000 | 22.8 s | ×2.54 | `530cfb4002`, the same as 1 |
| 8 | truncated | 40000 | 16.9 s | ×3.43 | `530cfb4002`, the same as 1 |

The era reference, 40 rooms × 3 characters (solved):

| Workers | Proof | States | Time | Speed-up | Result |
|---|---|---|---|---|---|
| none (one node at a time) | solved | 578 | 3.8 s | ×1.00 | `2717e116b8` |
| 1 | solved | 578 | 3.9 s | ×0.99 | `17cf8b1721` |
| 2 | solved | 578 | 2.4 s | ×1.59 | `17cf8b1721`, the same as 1 |
| 4 | solved | 578 | 1.9 s | ×2.01 | `17cf8b1721`, the same as 1 |
| 8 | solved | 578 | 1.7 s | ×2.20 | `17cf8b1721`, the same as 1 |

The 3.5 gate (×2 with 4 workers on a large proof, the same result for 1, 2, 4 and 8) is met. The result without workers
has another signature: the order of a batched search differs (the same states and verdict, other first-found paths);
`tests/workers.test.ts` checks both. What does not scale: the merge (the states cross between threads, the search's
thread checks each one), and starting the workers (about 0.3 s): a small proof, like each of the sample game's
chapters, is not faster. So workers stay off unless asked for; `--workers=auto` (the cores but one, at most 8) is the
setting for a large game.

## 3.5: who holds what (5 October 2026)

**The canonical owner** (proofs, on by default with the canonical character and mobility regions; `--ownership=off`).
With several playable characters, which one holds an item multiplies the states: three characters and twelve items
that move freely is the open matrix that 3.3 could not prove. An item no condition reads (so lacking it decides
nothing: no `else`, no rule shadowed by one that needs it), in no invariant or goal, lost or moved only by an action on
it, and given by no rule or reaction by kind (`poolableItems`), is pooled while every two characters can meet: the
state keeps how many of each pooled item exist, not who holds them. Before a character's actions are tried, the
hand-overs that give it the pool are played on the engine: the other holder switches in, both walk to a room their
regions share, the items are given, the controls come back, and every step must leave the state as the search sees
it. One that does not restarts the proof without pooling (`profile.ownership.reason`), like mobility.

Checked against the explicit search (`--audit-abstractions`, `tests/audit.test.ts`): the reference chapter `same`,
288 states against 83 672; 60 random games with free items, no divergence (32 compared within 3 000 states, 10 of them
with hand-overs played; 44 compared within 20 000, 14 with hand-overs, none diverged). The first version diverged on
3 of the 60: the pool listed items the search otherwise ignores (dead ones), and the audit caught it.

| Game | Without the owner | With it |
|---|---|---|
| The Night Market (2 characters) | 904 states, 1.9 s | 288 states, 1 559 hand-overs, 1.0 s |
| The sample game | 3 480 states | the same: no mobility region, so no owner |
| Open chain, 20 rooms × 2 characters, 12 items | truncated at 40 000 states (58 s) | **solved**, 14 002 states, 19.4 s |
| Open chain, 20 rooms × 3 characters | truncated | **still truncated** at 200 000 states (154 s with 4 workers) |

The 3.5 target, the 20 × 3 open matrix within budget, is **not met**. The owner applies only while every two
characters can meet, and in the open chain locked doors keep them apart most of the time (1 817 hand-overs in
200 000 states). As decided, this does not block 3.5; it is the open question for what follows.

**Witness dominance** (`--dominance`, witnesses only: it cannot prune a proof). A state with no more progress than one
already seen (the same everything else; its monotonic items and boolean flags, those nothing reads for their absence,
a subset) is not explored. A witness search that finds nothing with it runs again without it, so it never reports
`unsolved` by itself. Measured: it prunes nothing on the sample game, the reference chapter or the stress games. The
best-first search reaches a witness before a dominated state comes up, and a dominated state only comes up once the
better ones are exhausted, which (when absence is never read) means the search is failing anyway. It stays an
option, off by default.
