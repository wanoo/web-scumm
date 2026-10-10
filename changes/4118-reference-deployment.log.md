## 4.1.18 PR 4 — the Bridge's qualification profile, and a smoke that destroys and restores it

- `bridge/dev/docker-compose.yml` was a Postgres for development; nothing composed the topology REALITY-OPS calls
  distributed. `ops/qualify/` does (`compose.yml`, `Caddyfile`, `Dockerfile.bridge`, README): a proxy with a local CA
  and one port per instance for the qualification, three Bridges built from the tarball, Postgres on an internal
  network, two tenants by `--tenants … --tenant-header`; `BRIDGE_STORE_FILE` so the URL is a secret file.
- `npm run ops:qualify` (the maintainer's Mac has no Docker: brought up on the runner, `qualify.yml`, draft #73):
  images pinned (pulled from `mirror.gcr.io`, the same digests: Docker Hub's anonymous limit hit the first try);
  six players paired over HTTPS; 120 proposals while bridge-2 is killed then started, every fifth sent twice (each
  applied once, 24 duplicates said); every sequence contiguous; a stream on bridge-1 receiving what the others
  accepted, in order, once; each tenant's capability and token refused by the other; backup, the topology and its
  volume destroyed, a new empty database, restore by a one-off container before the instances (started first, they
  registered their tenants and the restore refused a non-empty store), every player as before, the next proposal at
  21. Nine steps green.
- Not inside this topology yet, said as such (README): the speedrun queue and its workers, Daily and Mystery, quotas,
  moderation, a 4.1.17 store's migration — each judged by its own job; the 24–48 h behind a real domain is the human
  pass `bridge-postgres-https` (#77).

→ next: Claude · 4.1.18 release: the candidate with the new families, the passes sheet, GO / NO-GO 4.2
