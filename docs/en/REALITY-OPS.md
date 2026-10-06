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

- `config.json`: the manifest and its hash, the Biscuit root key pair, the event-signing key (Ed25519, with a `kid`),
  the hash of the operator's token, one webhook per source (its secret, its own connector token);
- `admin-token`: the operator's token, the only copy in clear.

Nothing secret is printed or committed (`.cache/` is ignored). In a game project the command is `web-scumm bridge`.

Behind HTTPS: run `serve` on `127.0.0.1` behind a reverse proxy that terminates TLS and does not buffer
`text/event-stream` responses. `--origin` lists the game's site (CORS); the player's routes answer it only. Set the
game's `reality.bridge` to the public URL.

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
- `GET /v1/events?after=<n>` (SSE, Bearer capability) and `GET /v1/signals?after=<n>`: the signed signals after a
  sequence. `POST /v1/ack { through }`: applied and saved up to there.
- `GET /v1/keys`: the public keys, current and previous.

A capability reads and acknowledges one player's signals, nothing else, and lives 30 days from its last
acknowledgement. In the browser it is sensitive all the same (any script of the page can read it): a revoked or expired
one makes the player "unlinked", and the game can be linked again.

## Keys and rotation

The event key signs every signal with its `kid`; the player trusts the keys `GET /v1/keys` lists. To rotate:
`npm run bridge -- rotate [--keep-days=30]` makes a new key and keeps the current one in `previousKeys` until then (pick
longer than a player may stay offline with signals waiting), then restart the Bridge. A compromised key: remove it from
`previousKeys` and restart; players refuse what it signed from then on.

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
- `DELETE /v1/admin/players/<p-…>`: deletes it, the journal file rewritten without a line about that player.

## What is not here (4.1.1)

A real email or SSH connector, a hosted multi-tenant Bridge, high availability. The reference Bridge is for a game,
a developer, a small event; the protocol is what stays.
