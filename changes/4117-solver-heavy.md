### Fixed

- **The no-op memo keys a parked character by its room and bag, not its pixel spot** (4.1.17): `guests()` reads every
  parked player, and `players:<id>` was valued with its position, which the search's own dimensions leave out; the
  memo kept one entry per spot and missed. The demo's proof runs 56 588 engine tries instead of 69 958 (136 176
  without the memo: a gain of 2.41, where 4.1.15's content had brought it to 1.95 and the nightly's `memo` test red).
  Every result is the same; `memoVerify: 1` checks every skip.

### Changes

- **`npm run test:heavy` runs one file after the other** (4.1.17): the partition test's four workers had to share the
  runner with eight other files, and its one 600 s budget for eight searches ran out. Each game and configuration is
  now a test of its own with its own budget, so an overrun names its configuration.
- **`npx tsx tools/oracle-case.ts --case="<id>" --out=<file>` and `--diff <before> <after>`** (4.1.17): one case of the
  solver's oracle in full, and the difference of two runs by meaning (fields, first session entry, flags added,
  removed or reordered, reachable states, engine, Node and options). The oracle's fixture keeps digests only.
