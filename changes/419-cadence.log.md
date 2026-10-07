## `feature/419-cadence`: fragments of the CHANGELOG and of the LOG, the first lot of 4.1.9

- Measured on 4.1.8: ten pull requests, and after each merge the others became `DIRTY` on `CHANGELOG.md`,
  `docs/dev/LOG.md` and `tests/quality-baseline.json`; each re-merge was a new CI run (12–15 min, the mutation job
  when its inputs moved). About a third of the night went there. The baseline's conflicts stay (its JSON is a
  measure, resolved by `--theirs` then a ratchet); the two prose files are now fragments assembled on `main`.
- `tools/changes.ts`: `sectionsOf`, `mergeChangelog` (bullets under their section of `Unreleased`, sections created in
  the order Breaking, Fixed, Changes), `appendLog` (numbered after the last `## #n ·`, dated by the fragment's first
  commit), `needsFragment` (code moved, no fragment, no CHANGELOG edit); `--check` on pull requests in the `check`
  job, `--assemble` at the release. `tests/changes.test.ts` holds the pure parts; this entry is the first fragment
  assembled.
- Not done here, said as such: the mutation job in two (`mutation (core)`, `mutation (reality)`) waits for PR #32's
  workflows to land; the release acceleration (tag-triggered `release.yml` against main's run, a shared build job)
  is the sheet's next item (`docs/dev/plans/README.md`, lot 0).

→ next: Claude · `feature/419-cadence` (the mutation job in two), then `feature/419-connector-sdk`
