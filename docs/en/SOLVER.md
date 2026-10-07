# The solver

*French version: [docs/fr/SOLVER.md](../fr/SOLVER.md). The measures are in [BENCH.md](BENCH.md); the commands in
[TOOLS.md](TOOLS.md). This page says what the solver proves, how it stores what it has seen, and where a proof stops.*

## What it proves

`npm run solve` looks for one way from "New game" to the ending (a witness); `npm run solve -- --prove` explores every
state the player can reach and reports each one from which the ending is lost (a softlock), grouped by the step that
lost it. Both run the real engine with a silent presenter (ADR 0003): whatever the solver finds, a player can do, and
its paths replay as sessions (`npm run replay`). Since 4.1.13 a softlock cause carries its session entries as well as
its labels, so the way into it replays too. A search that runs out of a budget (states, time or memory) says
`truncated`: nothing is proved then, and the exit code is not 0. A proof never reads `proved` where a budget cut it.

## How a state is stored

A state is what the content can still tell apart: the live flags, items, props, counters, scripts and positions (the
dimensions, `solve/abstractions.ts`). Since 4.1.13 (ADR 0015) the search stores a state seen as an index into flat
columns: its parent, its path length, its last step, its room and bag, each string interned once. Its key is its
interned (dimension, value) pairs, sorted: two states share a key exactly when their dimensions are equal, so no hash
collision can merge them. The engine state is kept only while the node waits to be expanded. On the open instances of
the proof matrix the heap falls 16 to 20 times (1.6 KB a state on o21 instead of 31.6, BENCH.md "4.1.13"); the time per
state is the engine's, and does not change. `--representation=objects` keeps the 4.1.8 storage: the reference the differential
tests compare with (`tests/solver-oracle.test.ts`: 203 searches, the same verdicts, paths and reachable sets).

## What folds states: the abstractions

A proof folds states that differ only in what cannot matter, each fold audited against the explicit search
(`npm run solve -- --audit-abstractions`, `npm run audit:corpus` every night): the canonical character (who holds the
controls), the mobility regions (rooms one walks between silently), the canonical owner (who holds an item no
condition reads), the no-op memo (a try known to change nothing). 4.1.13 adds symmetric items (`--symmetry`, off by
default): two items the game treats alike, swapped, give the same game, so a state and its swapped twin are one. It is
measured against the explicit search on generated games with twins; it finds none in the bundled games or the matrix.
Dominance (a state with no more progress than one seen) prunes witnesses only: in a proof it changes verdicts on
generated games (`tests/dominance.test.ts`), so it stays off there and the profile says why.

## Reading the profile

`npm run solve -- --prove --profile` prints what the search cost and, since 4.1.13, what the states are made of: the
explosion profile. The stored states are attributed to five families (positions, inventories, flags and counters,
those a dialogue writes, those a script or an event writes): for each, how many states would merge without it, which is
what it multiplies. Three counts say what never became a state: symmetries folded, tries that changed nothing, and
transitions that landed on a state already seen (two orders of independent actions). Each abstraction has a line: what
it did, or why it is off. The independent sub-puzzles (groups of dimensions no rule links) are reported, not applied:
proving each alone needs a product argument the search does not make. `docs/dev/PROOF-PROFILE.md` is this profile for
each instance of the matrix.

## Long proofs: budgets, checkpoints, memory

`--max` (states), `--time` (seconds) and `--mem` (MB of heap) bound a search; each stops it as `truncated`.
`--checkpoint=<file>` writes the search down every `--checkpoint-every` seconds (300 by default) and when a budget
stops it: the store, the frontier in its order, the counters. `--resume` takes it up from that file, to the same
verdict and the same witness as a search that never stopped (`tests/checkpoint.test.ts` kills a real process with
SIGKILL at 30 % and resumes it). A snapshot belongs to one search: the game and the options that change what is found
are its fingerprint, and another search ignores it. A finished search removes its file.

## Workers

`--workers=N` expands the frontier a batch at a time on worker threads; the merge stays in the batch's order, so the
result depends on the batch, never on the number of workers (`tests/workers.test.ts`, `tests/partition.test.ts`). Since
4.1.13 the search shares its visited table with the workers (the 64-bit hash of every stored state): a worker sends a
state the search has already stored back without its engine state. The exact keys stay the authority: a worker's
"already stored" the search does not confirm is expanded again in the search's thread. Each node goes first to the
worker its room hashes to, and an idle worker steals from the longest queue. Workers speed an exploration up; they do
not answer an explosion of states.

## The proof matrix

`docs/dev/PROOF-MATRIX.md` is the class of games the solver is measured on since 4.1.13: twelve generated games of 20
to 40 rooms and three playable characters, six constrained (walls between the characters' zones) and six open, with
transferable items, crossed puzzles, dialogues, scripts, events and destructive actions. `npm run prove:matrix` proves
each one in its own process under the published budgets (10 000 000 states, 10 minutes on the maintainer's Mac, 20 on
the runner, 4 GB) and fails on a false verdict. It runs every night, never on a pull request. Where an instance does not
finish, the matrix's gap report says which budget stopped it and which dimension grew.
