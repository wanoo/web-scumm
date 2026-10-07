## `fix/release-older-tags`: release.yml on tags that predate its newer steps

- The release jobs of `v4.1.10` (run 37688608708) and `v4.1.13` (run 37680487989) passed both mutation sets and
  `release-check:ci`, then failed in "Build archive, checksum and SBOM" on `npm run speedrun:verify`, a script their
  commits do not have: `workflow_run` always takes the default branch's workflow file. Fixed by testing for the
  fixture; the attestation glob and the upload follow. Lesson: a step added to `release.yml` must hold for every tag
  still to be published, not only for the commit that adds it.
→ next: Claude · the release runs of 4.1.10 and 4.1.13 again (a new `ci` run of each tag)
