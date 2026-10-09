### Changes

- **The Remix and Speedrun mutation sets are gated** (4.1.17, plan §9): their survivors read one by one, by file —
  the seed codes, the manifest's compilation and every one of its problems alone, the application of a world, the
  categories' worlds, the envelope's sealing, the recorder (RTA, pauses, the finish, resume refusals), the
  verifier's guards (each reached by a run recorded dishonestly, not a hand-edited file) — and killed by a test, or
  named equivalent in `docs/dev/mutants.json` with why. `remix` and `speedrun` join `core`, `reality` and `runs` in
  the gate: their own jobs in ci (`full-ci`), the nightly, the candidate and the release.
- The verifier says a stored world's refusal by the code `loadVariant` gives it (the mapping of a code nothing threw
  is gone).
