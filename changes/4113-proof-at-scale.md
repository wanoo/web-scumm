### Changes

- **A proof needs nine times less heap over the proof matrix, up to twenty times less on the open instances** (4.1.13,
  ADR 0015). The search stores the states it has seen by index, with exact interned keys, parents and steps in flat
  columns, and keeps a state's engine copy only while it waits to be expanded. Over the twelve instances of the new
  proof matrix the peak heap falls ÷9 (÷4.5 in RSS), and ÷16 to ÷20 on the large open ones o21, o23 and o25 (1.6 KB a
  state instead of 31.6 on o21); the time per state, the engine's runs, does not change. The verdicts, paths, softlocks and reachable sets are those of 4.1.8, state for state, on the sample game,
  the reference game and 200 generated games (`tests/solver-oracle.test.ts`). `--representation=objects` keeps the
  4.1.8 storage.
- **A long proof can be stopped and taken up again** (4.1.13). `npm run solve -- --prove --checkpoint=<file>` writes
  the search down every five minutes (`--checkpoint-every`) and when a budget stops it; `--resume` takes it up to the
  same verdict and the same witness, even after the process was killed or a budget stopped it inside a state's
  expansion. `--mem=<MB>` stops a search as `truncated`
  past a heap size. A budget that cuts a search never gives `proved`.
- **The proof profile says what multiplies the states** (4.1.13). `npm run solve -- --prove --profile` attributes the
  states to positions, inventories, flags, dialogues and scripts (how many would merge without each), counts the
  symmetries folded, the tries that changed nothing and the orders merged, and names every abstraction with what it did
  or why it is off. A softlock cause now carries its session entries: `npm run replay` plays the way into it.
- **The proof matrix** (4.1.13, `docs/dev/PROOF-MATRIX.md`, `npm run prove:matrix`, nightly). Twelve generated games of
  20 to 40 rooms and three playable characters, six constrained and six open, with published budgets and expected
  verdicts. 4.1.13 proves the same eight of twelve as 4.1.8 within ten minutes on the maintainer's Mac; four open ones
  run out of time, and the gap report says why (the engine's runs on tries that change nothing, and who carries which
  key). This release is therefore "Solver Research".
- **Symmetric items, and workers that share what the search has seen** (4.1.13). `--symmetry` folds two items the game
  treats alike (off by default: none in the bundled games). With `--workers`, a worker sends back a state the search
  already stored without its engine copy, and nodes are dealt by room with work stealing; the result stays the same for
  any number of workers.
