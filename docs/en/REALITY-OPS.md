# Running a Reality Bridge

The reference Bridge (`bridge/src/`, the package `web-scumm-bridge`) serves one game. It is a small Node service:
pairing, connectors under Biscuit capabilities, a demonstration webhook, a journal, signed events, Server-Sent
Events. For authors: `docs/en/REALITY.md`. For why: `docs/dev/THREAT-MODEL.md`.

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
The package `web-scumm-bridge` (the release's tarball) is one JavaScript module plus its Datalog policies: it needs
Node 22, Biscuit's WebAssembly and zod, nothing else, and `web-scumm-bridge` is its command.

Behind HTTPS: run `serve` on `127.0.0.1` behind a reverse proxy that terminates TLS and does not buffer
`text/event-stream` responses, with `--trust-proxy` so the per-address limits see the client's address
(`X-Forwarded-For`). `--origin` lists the game's site (CORS); the player's routes answer it only. Set the game's
`reality.bridge` to the public URL. On the Internet, `init --no-demo-webhooks` and one `grant` per connector, each
as narrow as its job.

Per address, the routes anyone may call (a code, its state, the keys, the manifest) answer 60 requests a minute, and
60 failed authentications a minute on the others refuse every request of that address for a while (429,
`Retry-After`). Codes waiting for a confirmation live in memory only, 1000 at most across players: nothing is
written for a code nobody confirms.

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
envelope; never a token, an email or a payload. The log (stdout) is JSON lines with no secret. Keep the journal as
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
  on the same file refuses while that process lives, and takes over a lock left by a crash (said in the log). Stop
  the Bridge before `compact`.
- `web-scumm-bridge compact [--retention-days=90]`, the Bridge stopped: rewrites the journal without the pairings
  past their time, the earlier versions of a player's line, and the signals acknowledged and older than the
  retention; a player's last signal always stays (its next sequence is counted from it), and so does everything not
  yet acknowledged. The journal grows only with what is still waiting, or recent enough for a connector to repeat.

## What is not here (4.1.1)

A real email or SSH connector, a hosted multi-tenant Bridge, high availability. The reference Bridge is for a game,
a developer, a small event; the protocol is what stays.
