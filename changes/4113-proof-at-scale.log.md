## `feature/4113-proof-at-scale`: the proof matrix, the explosion profile, a compact store, checkpoints, dominance and symmetries measured, partitioned workers ("Solver Research")

- One branch for the sheet's branches 1–5 and 7 (`docs/dev/plans/4.1.13-proof-at-scale.md`), at the orchestrator's
  request. The matrix was committed first, before any code (`docs/dev/PROOF-MATRIX.md`, `matrixGame` in
  `tests/gen/random-game.ts`, ADR 0015), its expected verdicts measured on the 4.1.8 sources. The tests were written
  with the code, in the same commit, not strictly before it: said as such.
- Delivered: `solve --profile` with the explosion profile (`solve/explosion.ts`, `docs/dev/PROOF-PROFILE.md`); the
  compact store (`solve/search/compact.ts`: interned exact keys, parents and steps by index, FNV-1a 64 summed hash,
  edges as columns; `--representation=objects` keeps 4.1.8's); checkpoint and resume (`--checkpoint`, `--resume`,
  `--mem`; `solve/search/checkpoint.ts`, `tools/checkpoint.ts`); symmetric items (`--symmetry`, off by default) and
  dominance measured against the explicit search (`solve/search/dominance.ts`); the workers' shared visited table,
  partition by room and work stealing (`solve/search/partition.ts`); `npm run prove:matrix` and its nightly job;
  softlock causes carry their session entries (replayable). `search.ts` 738 lines (classification moved to
  `search/classify.ts`, the engine driver to `solve/drive.ts`).
- Measured (Mac M5, Node 22.14, 590 s per instance, one at a time): verdicts and states identical to 4.1.8 where both
  finish; states/s ×1.03 (geometric mean); peak heap 11 069 → 1 230 MB over the twelve (÷9), RSS ÷4.5, ÷16–20 on
  o21/o23/o25. 8/12 instances within budget, as with 4.1.8 (o22–o25 truncated by time). With 4 workers o23 reaches
  237 618 states (×2.7), still truncated. Oracle: 203 searches identical to the 4.1.8 fixture. Corpus on this code:
  500 seeds × 3 kinds, 909 compared, 0 divergence. Symmetry on 30 twin games: 0 divergence, ÷1.3 states. Dominance in
  proofs: 1 verdict changed in 43, so off in proofs. Checkpoint of o23: about 180 bytes a state.
- Threshold: the **minimum** is met (by memory, not by speed); the **objective** is not (8/12): the release is
  "Solver Research"; the gap report is PROOF-MATRIX §8 (time spent on no-op tries over whole-map regions, the
  memo refusing them; who carries which key stays in the state).
- Mutation: `search/compact.ts` measured with a temporary set judged by `tests/compact.test.ts`: 78/86 killed, 8
  survivors (a sort comparator on unique keys, the `bytes()` estimate, a snapshot branch). Not added to the core set.
- Run: tsc, biome, knip; `tests/compact`, `checkpoint`, `explosion`, `dominance`, `partition`, `solver-oracle`,
  `workers`, `frontier`, `status`, `proof-cache`, `solver-contract`, `por`, `replay`, `api-surface`,
  `reference-chapter`, `reality-proof`, `bench`, `boundaries`, `file-size`, `scripts-documented`, `docs-truth`,
  `docs-links`, one file group at a time with `--maxWorkers=1`. Not run here: the full suite, coverage, the e2e,
  the build, `quality:baseline`.
- Not done: the symbolic spike (branch 6: BDD, SAT/SMT, CEGAR, not tried); dominance in proofs and sub-puzzle
  proofs (reported only); a memo for macro moves and hand-overs (the gap report's lever); the runner's numbers (the
  nightly, median of three nights after merge); the new modules in the mutation core set.

→ next: Claude · `release/4.1.13`
