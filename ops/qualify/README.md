# The Bridge's qualification profile (4.1.18)

A reproducible deployment of the reference Bridge in the topology `docs/en/REALITY-OPS.md` calls distributed: an
HTTPS proxy, three Bridge instances, one Postgres, two tenants. It is the profile `npm run ops:qualify` drives in CI
and the one the human pass `bridge-postgres-https` runs behind a real domain for 24 to 48 hours. It is an example an
operator can carry elsewhere, not a promise that Docker Compose is secure everywhere, and not a hosted service.

```text
client ──HTTPS──▶ proxy (Caddy) ──▶ bridge-1 ─┐
                   :8443 every Bridge  bridge-2 ─┼──▶ Postgres 16
                   :8444-8446 one each bridge-3 ─┘
```

- **Built from the candidate's tarball** (`web-scumm-bridge-<version>.tgz`), never from a checkout: the image is the
  package, its production dependencies and the Postgres peer.
- **Every image pinned by digest**, pulled from `mirror.gcr.io` (the same digests as Docker Hub's official images; a
  shared runner meets Docker Hub's anonymous rate limit).
- **The Bridges** run as the operator's uid, read-only, with a bounded `/tmp`, no capability, no new privilege, limits
  on processes and memory; the tenants' directories (keys and tokens, files of mode 600) are mounted read-only.
- **Secrets are files**: the database password (`POSTGRES_PASSWORD_FILE`) and the store URL (`BRIDGE_STORE_FILE`,
  4.1.18), never environment values a process listing shows.
- **Three networks**: `public` (the proxy's ports, bound to 127.0.0.1), `edge` (the proxy and the Bridges) and
  `store` (the Bridges and Postgres), the last two internal: Postgres and the Bridges' ports are never published.
- **Health**: each Bridge's `/readyz` is its container health check and the proxy's upstream check.

## The qualification

```sh
npm run ops:qualify -- [--tarballs=<candidate packages>] [--out=.cache/field/deployment] [--keep]
```

It writes the environment the profile needs (`QUALIFY_*`), initialises two tenants with the package's own `init`
and `grant`, brings everything up and checks, writing `ops-qualify.json`:

1. every image pinned by digest;
2. six players paired over HTTPS (three per tenant), as a game and a connector pair them;
3. 120 proposals through the proxy while `bridge-2` is killed then started again, every fifth one sent twice:
   each applied once, the repeats said duplicates;
4. every player's sequence contiguous from 1, and a stream held on `bridge-1` receiving, in order and once, what the
   other instances accepted;
5. a tenant's capability and connector token refused by the other tenant;
6. `backup`, the whole topology destroyed with its database volume, a new empty database, `restore` by a one-off
   container (before the instances, which would register their tenants), the instances up: every player's signals as
   before, and a new proposal continuing the sequence.

What it does not do, said as such: the speedrun queue and its confined workers, Daily and Mystery, quotas, moderation
and the migration of a 4.1.17 store are judged by their own jobs (`bridge-load`, `runs-load`, `worker-container`,
`e2e:remix-speedrun`, the Postgres store tests), not inside this topology yet; the 24 to 48 hours behind a real domain
are a person's pass.

## Behind a real domain

Replace the Caddyfile's site addresses by the domain (`bridge.example.org { reverse_proxy … }`): Caddy then obtains a
public certificate. Keep the per-instance ports off the internet (they are for the qualification). The database
password and URL stay in files outside the repository, mode 600 (the password readable by Postgres's user); back up
with `backup` (every tenant) and `pg_dump` (the database), and rehearse the restore above before the long run.

**Upgrading.** A new Bridge version may bring a schema migration (`bridge/migrations/`): stop every instance, run
`migrate` once (or let the first instance open the store), then start the new instances. Two versions with different
schemas never serve one database at the same time: a database newer than a Bridge is refused by it.
