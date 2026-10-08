### Fixed

- **The release line is a line again** (4.1.16): `v4.1.14` was tagged on a side branch whose only extra commit
  lowered the coverage floors for that tag; it is merged into `main` (the stricter floors kept), so `v4.1.14` and
  `v4.1.15` are both ancestors of what comes next. `ship tag` and `release.yml` now refuse a tag whose previous stable
  tag is not its ancestor (`tools/release/ancestry.mjs`).
- **Pages deploys after `pr-gate`**, the terminal gate, instead of four of its jobs: no deployment while Firefox PWA,
  a proof, a mutation set or the reference game is red.

### Changes

- **A new logo** at the head of both READMEs.
