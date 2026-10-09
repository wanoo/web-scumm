## 4.1.17 PR 6 — the Remix and Speedrun mutation sets read and gated

Measured on this branch (PR 5's code in): `speedrun` 444/533 (envelope 16 mutants, recorder 116, verify 401),
`remix` 454/590 (seed-code 38, compile 262, apply 142, categories 70, `reality/daily.ts` 78, none left there). The
survivors were read file by file, each file's in a copy of the branch by a second context (Claude sub-agents) that
applied each mutant alone, ran only its own new test file, and restored the source: recorder 38 killed / 2 equivalent,
verify 36 / 7, compile + seed-code 65 / 7, apply 43 / 7, categories and envelope here. Tests:
`speedrun-recorder`, `speedrun-verify-guards` (dishonest runs recorded with the real recorder: a save, a menu, a forger's
copy of a category, signals with a missing or decoy proof), `speedrun-envelope-seal`, `speedrun-envelope-shape`,
`remix-compile-rules` (each manifest problem alone; the logic and cosmetic streams pinned), `remix-apply-rules`,
`remix-categories-rules`. 23 equivalents named with their reason; the verifier's `'seed' → 'world-shape'` mapping,
dead (every `loadVariant` refusal has its code), removed rather than named. Found on the way: no defect in the
sources; the recorder's live RTA counts from a resume before the run's start (its sealed times are right).

→ next: PR 7, the production paths and the release.
