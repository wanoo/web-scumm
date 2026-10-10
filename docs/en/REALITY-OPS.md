# Running a Reality Bridge

The reference Bridge (`bridge/src/`, the package `web-scumm-bridge`) serves a game. It is a small Node service:
pairing, connectors under Biscuit capabilities, a demonstration webhook, a journal, signed events, Server-Sent
Events. Since 4.1.10 it keeps its state in a store (the 4.1.9 journal, SQLite, or Postgres), and one deployment may
run several instances and serve several tenants. For authors: `docs/en/REALITY.md`. For why:
`docs/dev/THREAT-MODEL.md` and `docs/dev/threat-models/constellation.md`.

## Start one

```sh
npm run bridge -- init [--dir=.cache/bridge] [--audience=bridge.example] [--origin=https://game.example]
npm run bridge -- serve [--dir=.cache/bridge] [--port=8787] [--host=127.0.0.1]
```

`init` reads the game's manifest from its content and writes, under `--dir` with mode 600:

- `config.json`: the manifest and its hash, the Biscuit root's public key, the event-signing key (Ed25519, with a
  `kid`), the hash of the operator's token, one demonstration webhook per source (its secret, its own connector
  token: any player of that source's signals, may confirm pairings, 30 days or `--demo-days`);
- `root.key`: the Biscuit root's private half, read by `grant` only (`serve` never loads it: keep it where the Bridge
  is not, if you can);
- `admin-token`: the operator's token, the only copy in clear.

Nothing secret is printed or committed (`.cache/` is ignored). In a game project the command is `web-scumm bridge`.
The package `web-scumm-bridge` (the release's tarball) is one JavaScript module plus its Datalog policies and its SQL
schema: it needs Node 22.12 or newer (22.13 for SQLite), Biscuit's WebAssembly and zod; `pg` only for Postgres,
`@opentelemetry/api` only for the measures; `web-scumm-bridge` is its command.

Behind HTTPS: run `serve` on `127.0.0.1` behind a reverse proxy that terminates TLS and does not buffer
`text/event-stream` responses, with `--trust-proxy` so the per-address limits see the client's address
(`X-Forwarded-For`). `--trust-proxy` alone trusts the loopback; `--trust-proxy=10.0.0.0/8,192.0.2.7` names the
proxies (addresses or IPv4 networks): the header is read only from them, and the client is its rightmost address
that is not one of them. Since 4.1.10 a proxy elsewhere than on the loopback (a PaaS's router) must be named: without
it, every client shares the proxy's address and its one rate bucket. `--origin` lists the game's site (CORS); the player's routes answer it only. Set the game's
`reality.bridge` to the public URL. On the Internet, `init --no-demo-webhooks` and one `grant` per connector, each
as narrow as its job.

Per address, the routes anyone may call (a code, its state, the keys, the manifest) answer 60 requests a minute, and
60 failed authentications a minute on the others refuse every request of that address for a while (429,
`Retry-After`). Codes waiting for a confirmation are 1000 at most across players and swept once expired: in memory
on the journal (a restart forgets them), in the `pairings` table on SQLite and Postgres (any instance can confirm or
claim one). No capability waits anywhere: it is drawn when the player claims the code, and only its hash is kept.

## Connectors

A connector proposes signals with a Biscuit minted from the root key:

```sh
npm run bridge -- grant --connector=mail-1 --source=mail --signals=mail.answer.correct,mail.answer.wrong \
  [--players=any|p-…,p-…] [--pair] [--days=30]
```

It names the game, the sources, the signals, the players (or any player of the game), the Bridge's audience, and an
expiry (to the second; refused from that second on). `--pair` lets it confirm pairing codes. A connector can
attenuate its own token (fewer players, an earlier expiry) before handing it on; it can never widen it.

- `POST /v1/signals` (Bearer token) `{ playerId, signal, source, dedupeKey, occurredAt?, evidenceHash? }`: 202
  accepted, 200 already accepted (the same `dedupeKey`), 403 not allowed, 422 not in the manifest, 429 over a quota.
- `POST /v1/pairings/<code>/confirm` (Bearer token with `--pair`): links the player who shows that code.
- `POST /v1/hooks/<source>` with `X-Web-Scumm-Signature: sha256=<HMAC of the body>` `{ playerId, event, id }`: the
  demonstration webhook; `event` must be one it knows, `id` names the delivery (deduplication).

A connector checks what it claims (a credential's proof, an email's sender): Biscuit only says who may propose.
The connectors of 4.1.9 (email, Telnet, SSH, Open Badges; experimental) run as processes beside the Bridge, each
with its own token: `docs/en/CONNECTORS.md`.

## The player's side

- `POST /v1/pairings` `{ gameId }` → `{ code, expiresAt }` (10 minutes); `GET /v1/pairings/<code>` → pending, then
  once `{ playerId, capability }`.
- `GET /v1/events?after=<n>` (SSE, Bearer capability) and `GET /v1/signals?after=<n>` → `{ signals, sequences }`:
  the signed signals after a sequence, each with its sequence. `POST /v1/ack { through }`: applied and saved up to
  there. A player holds at most 4 open streams; a stream whose reader stopped reading (64 KB unsent) or whose link
  was revoked or expired meanwhile is closed by the Bridge, and the player reconnects from its cursor.
- `GET /v1/keys`: the public keys, current and previous.

A capability reads and acknowledges one player's signals, nothing else, and lives 30 days from its last
acknowledgement, 180 days at most from its pairing. In the browser it is sensitive all the same (any script of the
page can read it): a revoked or expired one makes the player "unlinked", and the game can be linked again. The pause
menu's "Unlink" revokes it on the Bridge (`POST /v1/unlink`, Bearer capability), not only on the device.

## Keys and rotation

The event key signs every signal with its `kid`; the player trusts the keys `GET /v1/keys` lists, each within its
window, with five minutes of tolerance for a device's clock. To rotate: `npm run bridge -- rotate [--keep-days=30]`
makes a new key and keeps the current one in `previousKeys` until then, then restart the Bridge. From then on the
Bridge delivers every signal under its current key: what was waiting for a player is signed again at delivery (the
journal keeps the payload as accepted), and a player whose link was open asks for the keys once when a signal names
one it does not know. `--keep-days` only has to cover a player that received a signal just before the rotation and
verifies it after. A compromised key: remove it from `previousKeys` and restart; players refuse what it signed from
then on, and what it signed in the journal is delivered again under the new key.

The Biscuit root key mints connector tokens; rotating it means granting every connector a new token.

## Revocation, quotas, limits

```sh
npm run bridge -- revoke --url=<bridge> --player=<p-…>      # a player's link
npm run bridge -- revoke --url=<bridge> --token=<revocation id>   # a connector's token (any of its revocation ids)
```

Quotas: signals per connector per minute (120), signals waiting for a player's acknowledgement (1000), request body
(8 KB). Over a quota is a 429, visible to the connector, never a signal dropped in silence.

Proposals for one player are taken one at a time: the deduplication, the quotas, the sequence, the signature and the
journal line are decided together under a lock per player, so two connectors proposing at once never share a
sequence, and a `dedupeKey` is accepted once whatever the timing. A pairing code confirmed by two connectors at once
is confirmed once; the other gets a 409.

## Retention, export, deletion

The journal (`journal.jsonl`) keeps every accepted signal: its id, sequence, the connector's key, the signed
envelope and, since 4.1.2, the signal's payload as accepted (to sign it again after a rotation); never a token or an email. The log (stdout) is JSON lines with no secret. Keep the journal as
long as players may be offline with signals to receive; then a player re-pairs.

- `GET /v1/admin/players/<p-…>` (Bearer operator token): everything held about a player (its link without the
  capability, its signals, its acknowledgement).
- `DELETE /v1/admin/players/<p-…>`: deletes it, the journal file rewritten without a line about that player (each
  line read as an event, never matched as text).
- `web-scumm-bridge doctor`: reads the journal and says what it holds. A last line cut short by a crash is dropped
  at the next start, and said in the log (`journal.repaired`); any other line that does not parse, or parses but is
  not an event of the journal's shape (every field checked, 4.1.8), is corruption, and the Bridge refuses to start
  rather than guess.
- One Bridge per journal (4.1.8): the running Bridge holds `journal.jsonl.lock` with its process id; a second start
  on the same file refuses while that process lives, and takes over a lock left by a crash (said in the log). A stop
  by Ctrl-C or SIGTERM releases the lock. `compact` takes the lock too, so it refuses while the Bridge runs. A lock
  whose process id was reused by an unrelated process since the crash is refused as "in use": look, then delete it.
  The lock is a hard link, so the journal's folder must be on a file system that holds them (APFS, ext4, NTFS do;
  FAT and some network mounts do not).
- `web-scumm-bridge compact [--retention-days=90]`, the Bridge stopped: rewrites the journal without the pairings
  past their time, the earlier versions of a player's line, and the signals acknowledged and older than the
  retention; a player's last signal always stays (its next sequence is counted from it), and so does everything not
  yet acknowledged. The journal grows only with what is still waiting, or recent enough for a connector to repeat.

## Stores and profiles

| Profile | Store | For |
|---|---|---|
| `local` | SQLite (`node:sqlite`, Node 22.13+, one file, WAL) | one machine, one or a few processes; the profile of `npm run bridge` |
| (4.1.9) | the JSON-lines journal | a configuration written before 4.1.10 keeps serving from it; one process |
| `distributed` (`experimental`) | Postgres (`pg`) | several instances behind a load balancer; experimental until a real deployment |

`init --store=sqlite` writes `"store": "sqlite:bridge.sqlite"` in `config.json`; without it `init` still writes the
journal's configuration in 4.1.10 (the default moves to SQLite when the engine requires Node 22.13, D20). A database
URL is not written in the file: `serve --store=postgres://…` or `BRIDGE_STORE=postgres://…`. The schema is versioned
(`bridge/migrations/`): a SQL store brings it up when it opens; `migrate --schema=N` goes up or down by hand, and a
database newer than the Bridge is refused. The SQLite file and its `-wal` and `-shm` are mode 0600; a write that
waits more than 5 s for another process's lock is answered 503 with `Retry-After` (the connector repeats it).

```sh
npm run bridge -- migrate --from=jsonl --to=sqlite [--tenant=<id>]   # the Bridge stopped; the journal is kept
npm run bridge -- doctor                                              # a store read without a change
```

`migrate --from=jsonl` reads the journal under its lock, writes every player, signal, acknowledgement and revocation
into the new store, reads them back, then names the new store in `config.json` (not for a URL). `doctor` on a SQL
store prints its schema version and, per tenant, the players, the signals, any gap in a player's sequence (exit 1)
and the quarantined rows. `compact` is the journal's command; a SQL store keeps every signal in 4.1.10.

## Several tenants, several instances

A tenant is one operator's game in one environment: its own directory (`init --tenant=<id>
--environment=prod|staging|dev --hosts=bridge.a.example`), its own Biscuit root, event key, operator token, quotas,
rotation and revocations. One server holds several on one SQL store:

```sh
BRIDGE_STORE=postgres://… npm run bridge -- serve --tenants=/srv/bridge/a,/srv/bridge/b [--tenant-header]
```

A request is routed by its `Host` (each tenant's `hosts`), or by `X-Web-Scumm-Tenant` with `--tenant-header`, before
anything is read; no tenant, a 404. Every row of the store carries its tenant and every query filters on it. A tenant
of a shared deployment signs `SignalV2` (ADR 0010: the signal names its tenant, environment, origin, link and key) and
its connectors' tokens are bound to it (`grant` adds the tenant), so neither a token nor a signal of one tenant is
accepted by another even when two of them were (wrongly) given one key.

Instances are stateless: start as many `serve` as needed on the same store, with no sticky sessions. Sequences,
deduplication and acknowledgements are decided in one database transaction; a signal accepted by one instance reaches
a stream held by another, which reads the store when woken (Postgres `NOTIFY`, a 250 ms poll on SQLite, and a pass
every 5 s should a wake-up be lost). Delivery is at least once and applied once (D20). Each instance bounds its open
streams (`streamsPerInstance`, 10 000; then 429) and its per-connector minute (with N instances a connector may
propose N times its quota). A stored row that no longer verifies is quarantined, never delivered, and `doctor` lists it.

## The reference deployment (4.1.18)

`ops/qualify/` is the distributed profile as a reproducible deployment: an HTTPS proxy (Caddy), three Bridges built
from the `web-scumm-bridge` tarball, one Postgres, two tenants, every image pinned by digest, the Bridges read-only and
unprivileged, the database password and URL as secret files (`BRIDGE_STORE_FILE`), Postgres never published.
`npm run ops:qualify` brings it up and kills an instance during proposals, holds a stream on another, checks the
tenants apart, then backs up, destroys the topology with its database and restores it (`ops/qualify/README.md`). The
`distributed` profile stays `experimental` until the person's pass behind a real domain (24 to 48 hours) is `passed`.

## Health, measures, backups

- `GET /livez`: the process answers. `GET /readyz`: the store answers (503 otherwise). `GET /healthz`: both, with
  the tenants, the store's kind and the open streams. No token, no tenant's data.
- Measures: acceptances, duplicates, refusals by code, acknowledgements, store retries, quarantine, refused streams,
  the backlog and a proposal's latency. In the process always; through OpenTelemetry's metrics API when
  `@opentelemetry/api` is installed beside the Bridge, exported over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and
  `@opentelemetry/sdk-node` is installed. Attributes: the tenant and a code, never a player or a payload.
- `npm run bridge -- backup --out=<file>` writes every tenant (one transaction each) to a file of mode 600: hashes of
  capabilities, never a capability or a key. `restore --from=<file>` writes it into an empty store (`--force`
  replaces the tenants it holds). Both are rehearsed by `tests/bridge-ops.test.ts`. On Postgres, `pg_dump` remains
  the backup of the database itself.
- `tenant export --tenant=<id> [--out=<file>]`, `tenant delete --tenant=<id> --yes`: one tenant's rows, in every table.

## Procedures

**An event key compromised (one tenant).** `rotate --dir=<tenant>`, then remove the compromised key from
`previousKeys` in that tenant's `config.json`, and restart its instances. Players refuse what it signed from
then on; what waits for them is signed again under the new key at delivery. The other tenants are untouched.

**A Biscuit root compromised.** `init --force` is too much: make a new root (`init` in a scratch directory, copy its
`biscuitRoot` and `root.key`), grant every connector of the tenant a new token, restart, then revoke the old tokens'
ids (`revoke --token=`) for the window before the restart.

**An instance or its host compromised.** It held every private key of the tenants it served: rotate each tenant's
event key, make each tenant a new root, change the database password and the operator tokens, and read the store's
`quarantine` and the logs since the compromise.

**Rotation, routinely.** Per tenant, at its own pace: `rotate --dir=<tenant> --keep-days=30`, restart its instances
one by one (the others keep serving; the store is the same).

**Recovery.** An instance killed or crashed: start another; nothing is lost (a transaction is committed or not there,
`tests/bridge-fanout.test.ts` kills one of three during 1 000 proposals). The database lost: `restore` the last backup
into a new one, then `doctor`; connectors repeat what they sent since (their `dedupeKey` makes it idempotent), and
players keep their cursors. A journal that will not start: `doctor` names the line.

## Leaderboards and the daily challenge (4.1.16)

A configuration's `runs` section mounts `/v1/runs`, its `daily` section `/v1/daily`, `/v1/commit` and `/v1/reveal/<id>`
(docs/en/SPEEDRUN.md, "Leaderboards on the Bridge"). Both keep their records in the SQL store (`--store=sqlite:<file>`
or `BRIDGE_STORE=postgres://…`; `serve` refuses them on the JSON-lines journal), migrations 0002 to 0004.

The queue's limits hold for every instance together (4.1.17): `maxQueued` (default 100, runs waiting or being
verified) is counted and written in one transaction under the tenant's lock; `perMinute` (default 10 per client) is a
bucket per client in the table `run_quota`. The client is the socket's address, or the one a trusted proxy names
(`--trust-proxy`): only an HMAC of it is stored, with a secret every instance of the tenant derives from its event key.
Rotating the event key (`kid`) rotates that secret too: every client starts a new bucket (at most one more minute's
quota), and the old buckets are purged with the idle ones. A global rate limit at the proxy stays a good idea in front
of it all.

```json
"runs": {
  "games": { "reference": { "dir": "/srv/games/reference", "fingerprint": { "logic": "…", "trustedExtensions": "…", "presentation": "…", "engine": "…" } } },
  "worker": ["/usr/bin/node", "/srv/web-scumm/node_modules/tsx/dist/cli.mjs", "/srv/web-scumm/tools/speedrun/worker.ts"],
  "workers": 2
},
"daily": { "games": { "reference": { "daily": "daily", "mystery": "mystery" } }, "kid": "daily-2026", "keyFile": "daily.jwk", "secretFile": "daily.secret" }
```

`keyFile` (the Ed25519 private JWK whose public half the game's manifest names in `remix.daily`) and `secretFile` (the
days' secret) sit beside `config.json`, mode 0600. Rotating the daily key is a release of the game with the new public
key: the player and the verifier accept the key the manifest names only, so a token of another `kid` is refused.

### The speedrun worker

The worker's in-process refusal of the network is defence in depth, not a sandbox: a replay runs the game's code, and
a hostile package or run could still reach the filesystem, spawn a process or open a socket another way. Run the
worker command inside the deployment's isolation, for instance:

```sh
docker run --rm -i --network none --read-only --tmpfs /tmp:rw,size=64m --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 512m --memory-swap 512m --cpus 1 --user 65534:65534 -v /srv/games:/srv/games:ro web-scumm-worker \
  timeout -s KILL 70 node tools/speedrun/worker.ts
```

as the `worker` command: no network namespace, a read-only root, a bounded temporary directory, no capability, no
secret of the Bridge in its environment (the Bridge passes `PATH`, `GAME_DIR` and `NODE_OPTIONS` only), limits on CPU,
memory (no swap beyond it), processes and time (the Bridge kills the process group at `timeoutMs` + 5 s). Its stdout is
capped at 1 MB and its stderr is not kept. Whatever folder is mounted is readable inside: keep the Bridge's own
directory (`config.json`, its keys and token files) outside the engine folder mounted at `/app`.
Killing the `docker` client does not stop its container: `timeout -s KILL` inside it (a little over the Bridge's
`timeoutMs`) is what ends a replay that runs too long, so timed-out containers never pile up.

Since 4.1.17 this profile is one function (`tools/speedrun/container.mjs`, `workerContainerArgs`): `node
tools/speedrun/container.mjs --image=<image> --app=<engine folder> [--games=<folder>]` prints the `worker` command, with
**no network unless `--allow-network`** (which says so on stderr). CI's `worker-container` job (`npm run
e2e:worker-container`, Linux and Docker) runs the reference run inside it, then a hostile script: HTTP, DNS and TCP
refused, nothing written outside `/tmp`, the host's secrets unseen, a child process allowed but without a network,
the container killed by its own timeout with nothing left running; then a run again.

### Moderation

`runs.adminTokenFile` names the file of the token that moderates a tenant's leaderboards (`POST
/v1/runs/<id>/moderate`, `Authorization: Bearer …`): beside `config.json`, mode 0600, at least 32 characters; `serve`
refuses to start when it is missing, shorter or open to others (on POSIX systems; on Windows the folder's ACL decides).
Without it there is no moderation route (404, nothing counted). The token
is compared as hashes of equal length (its length says nothing either); every refusal is an audit line
(`run.moderation-refused`, never the bearer), and `/healthz` counts moderations accepted and refused.

## What is not here (4.1.10)

A real email or SSH connector, a deployment of the `distributed` profile (it stays `experimental` until one), row-level
security per tenant in Postgres, retention on a SQL store, a rate limit per connector shared between instances. The
reference Bridge is for a game, a developer, an event or a small studio's games; the protocol is what stays.
