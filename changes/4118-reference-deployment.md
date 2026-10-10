### Changes

- **The Bridge's qualification profile** (4.1.18, `ops/qualify/`, REALITY-OPS): an HTTPS proxy (Caddy), three Bridge
  instances built from the `web-scumm-bridge` tarball, one Postgres, two tenants; every image pinned by digest, the
  Bridges read-only and unprivileged with their tenants mounted read-only, the database password and URL as secret
  files, Postgres never published. `npm run ops:qualify` brings it up, kills an instance during proposals, holds a
  stream on another, checks the tenants apart, then backs up, destroys the topology with its database and restores it
  (`ops-qualify.json`). The `distributed` profile stays experimental until the 24–48 h pass behind a real domain.
- **`BRIDGE_STORE_FILE`** (4.1.18): the store's URL read from a file, so a database password is a secret file, never an
  environment value a process listing shows.
