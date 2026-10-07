### Changes

- **A tag's release chain in half the time (4.1.10).** `release.yml` runs the two mutation sets as jobs of their own
  (`core`, `reality`, about half an hour each; the final tag after its candidate reuses the candidate's reports through
  the cache) beside
  `release-check:ci` (`release-check` without the mutation step), and the release waits for all three: about 35
  minutes from the tag's green run to the published release instead of 70. `ship tag --now` (and `chain --now`) tags
  as soon as the pull request is merged instead of waiting for main's run of the same commit: the tag's own run, the
  same suite on the same commit, is what the release checks.
- **`ship tag` fetches before reading the commit (4.1.10)**: `chain` tagged nothing twice (4.1.9, 4.1.10) because the
  merge commit it had just made was on origin only ("not a commit here").
