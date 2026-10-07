## `chore/release-speed`: the mutation sets beside release-check, the tag at the merge

- Measured on v4.1.9 (7 October 2026): the tag's `ci` run 15 min, then `release` 70 min, of which the two mutation
  sets about 50 in sequence inside `release-check` (the cache of lot 0 only helps when a `full-ci` pull request or the
  nightly ran the same inputs, which a release changes). The programme's remaining tags (nine, with the candidates)
  would have paid that nine times.
- Done: `mutation` matrix job in `release.yml` (`core`, `reality`), `release` needs it, `npm run release-check:ci`
  (TOOLS en + fr), `ship tag --now`. The guarantee "the tag is the commit ci tested" is unchanged: release.yml still
  checks the tag's own run, its head SHA, the absence of a published release. Not changed: `release-check` for a person
  (both sets, as before); the nightly.
- Not measured here: the new chain's duration (the first tag after this merge measures it; written in the next
  release's baseline sheet).
→ next: Claude · `release/4.1.10` candidate, then the final tag with this chain
