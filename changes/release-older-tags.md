### Fixed

- **A tag older than 4.1.14 releases again (4.1.15)**: `release.yml` runs from `main` while it checks out the tag's commit,
  and since 4.1.14 it verified and attached a speedrun file the 4.1.10 and 4.1.13 commits do not have: both release jobs
  failed after every check had passed. The speedrun is now verified and attached only when the tag carries it.
