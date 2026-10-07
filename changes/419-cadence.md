### Changes

- **The CHANGELOG and the LOG written as fragments per branch** (4.1.9, lot 0 "cadence"). A branch that changes
  the code writes `changes/<slug>.md` (its bullets under `### Breaking`, `### Fixed` or `### Changes`) and, for a LOG
  entry, `changes/<slug>.log.md`; `npm run changes -- --assemble` folds them into `CHANGELOG.md`'s `Unreleased` and
  numbers the LOG entries in the order the fragments reached `main`; CI's `check` job fails a pull request that
  touches the code without a fragment (`npm run changes -- --check`). During 4.1.8 every merge made the other open
  branches conflict on those two files and re-run their CI: that is over (`changes/README.md`).
