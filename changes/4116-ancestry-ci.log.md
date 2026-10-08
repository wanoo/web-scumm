## `chore/4116-ancestry-ci`: the release line restored, Pages behind `pr-gate`, the 4.1.16 plan checked against the code (4.1.16 PR 1)

- Delivered: `git merge v4.1.14` (its one commit `ed8fbf6` lowered the floors; `main`'s stricter floors kept);
  `tools/release/ancestry.mjs` (the highest stable tag below the version must be an ancestor of the SHA), called by
  `ship tag` before tagging and by `release.yml` before publishing (guarded on the file, as every step a tag may
  predate); `pages.needs: [pr-gate]`; `tests/release-ancestry.test.ts` (a scratch repository rebuilds the side-branch
  tag); the new logo (the maintainer's file reduced to 640 px) in both READMEs.
- Decided by the maintainer on 8 October 2026: the whole of `docs/dev/PLAN-4.1.16-CONVERGENCE.md` (revision 2 commits
  it, checked against `v4.1.15`, its §21 lists what the reading confirmed and what it added), D29 and ADR 0019 for
  `SpeedrunCategory.world`, five pull requests (`docs/dev/plans/4.1.16-convergence.md`).
- Measured (`docs/dev/baselines/4.1.16-start.md`): `e2e:remix` and `e2e:speedrun`, never run before, pass in the four
  runtimes; `e2e:canonical` fails in Firefox, whose `normalize('NFC')` turns a lone surrogate into U+FFFD.
- Not done: the Firefox fix (PR 2), the E2E in CI (PR 5); `pr-gate` as the single required check stays the
  maintainer's move in the ruleset.
→ next: Claude · `feature/4116-run-world` (4.1.16 PR 2)
