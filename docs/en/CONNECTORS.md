# Connectors of the world outside

A connector turns something that happens outside the game (an email arrives, a command is typed on a terminal, a
badge is shown) into one of the signals the game declares, and proposes it to the Reality Bridge
(`docs/en/REALITY-OPS.md`). 4.1.9 ships four: **email**, **Telnet**, **SSH** and **Open Badges**. They are
**experimental** (`docs/en/SUPPORT.md`, D19): every contract and abuse test runs in CI, but no person has yet run one
against a real email provider, a real badge or a terminal exposed on a network.

Each connector is a process of its own, never in the game: the game's build holds nothing of `connectors/` (checked by
`tools/dist.ts`), the DSL declares only data, and a game runs without any connector. What a connector reads is
treated as hostile; each one has its threat model in `docs/dev/threat-models/`. The design is ADR 0008.

## Run one

```sh
npm run bridge -- grant --connector=shed-telnet --source=terminal --signals=terminal.lamp --pair > telnet.token
npm run connector -- telnet --config telnet.json        # from the repository
npx web-scumm-connector telnet --config telnet.json     # from the package web-scumm-connectors
```

The configuration names the Bridge and the file of the connector's token (never the token on the command line), the
game, its limits, an optional health port, and a section named after the connector:

```json
{
  "bridge": { "url": "http://127.0.0.1:8787/", "tokenFile": "telnet.token" },
  "gameId": "signals",
  "limits": { "maxBytes": 4096, "maxPerMinute": 60, "timeoutMs": 5000 },
  "health": { "port": 9301 },
  "telnet": { "port": 2323 }
}
```

The game's Reality manifest comes from the Bridge (`GET /v1/manifest`), or from `"manifestFile"`. A token minted with
`--pair` may confirm the pairing codes players give; grant each connector only the signals it proposes. With
`health`, `GET /health` and `GET /metrics` answer on 127.0.0.1 (counts of proposals, duplicates, refusals by code,
inputs rejected, retries). SIGTERM or Ctrl-C stops it: no new input, work in flight drained for at most five seconds,
exit 0. Install the package without native code: `npm install --omit=optional --ignore-scripts web-scumm-connectors`.

## Declare what the connectors may do

The game says, as data, what each connector may turn into a signal (`reality.connectors`, checked by
`npm run validate`). Every signal named there is one of `reality.signals`; no pattern, script or path of the author's
reaches a connector.

```ts
reality: {
  signals: [
    { id: 'letter.door', source: 'email', availability: 'optional', replay: 'record' },
    { id: 'terminal.lamp', source: 'terminal', availability: 'optional', replay: 'record' },
  ],
  connectors: {
    email: { answers: [{ words: ['open', 'door'], signal: 'letter.door' }], otherwise: 'letter.unclear' },
    telnet: { prompt: 'shed> ', commands: [{ says: 'lamp on', reply: 'Click.', signal: 'terminal.lamp' }] },
    ssh: { commands: [/* the same */], files: { '/notes/lamp.txt': 'The lamp obeys two words.' } },
    'open-badge': { issuers: ['https://badges.example.org/issuer'], valid: 'badge.valid', revoked: 'badge.refused' },
  },
}
```

A player links a connector to their game the way they link any connector: the pause menu's "World link" shows a
code, and the player types it at the terminal's prompt, sends it as an email's subject (`PAIR ABCD2345`), or posts it
with a badge. The connector confirms it with the Bridge; the game is then linked.

## Email

Two modes. `webhook`: a provider (or a small adapter in front of it) posts the raw message to `POST /v1/inbound`,
with `X-Web-Scumm-Timestamp` (Unix seconds, within five minutes) and `X-Web-Scumm-Signature: sha256=<hex>`, an
HMAC-SHA256 of `<timestamp>.<body>` with the secret from `webhook.secretFile`. `imap`: the connector polls a mailbox
over TLS every `pollS` seconds (`imap.host`, `user`, `passwordFile`, `mailbox`); `"tls": false` is refused unless the
host is this machine (127.0.0.1, ::1, localhost). A message whose signal could not reach the Bridge (away, busy, over
a quota) stays unseen and is read again at the next poll.

A message is read in a worker thread (64 MB, 2 s), at most 256 KB, 3 levels of multipart, 64 parts; HTML becomes
inert text; a message with an attachment is refused. The player is the recipient's tag (`gate+p-…@<domain>`, with
`"domain"` set) or the sender who sent a pairing code (in memory, `linkDays`, 30 by default). The first answer whose
words all appear in the subject or the text proposes its signal, else `otherwise`. The key is
`sha256('email:' + Message-ID)`: a message delivered twice is one signal. Retention: with `imap.keepDays: 0` (the
default) a message is deleted once its signal is accepted; refused messages are flagged and kept for the operator.
No reply is sent in 4.1.9.

## Telnet

`telnet: { "port": 2323, "host": "127.0.0.1" }`. A TCP server that refuses every Telnet option and filters the
protocol's bytes. The player types the pairing code (or the resume word printed at a previous pairing), then the
commands the game declares; `help`, `clear` and `exit` are the terminal's own. Lines are at most 512 bytes, 100 a
minute; a connection sends at most 64 KB a second, must pair within 20 seconds, type a line every minute, and lasts
at most 30 minutes; 3 connections per address and 20 in all; six wrong codes from one address in ten minutes, across
reconnections, and it is refused. The key is `sha256('telnet:' + session + ':' + line)`. Telnet is clear
text: keep it on a local network, behind a VPN or TLS (stunnel), or prefer SSH.

## SSH

`ssh: { "port": 2222, "hostKeyFile": "ssh_host_ed25519_key", "keys": [{ "key": "ssh-ed25519 AAAA…", "playerId": "p-…" }] }`.
An SSH server (`ssh2`, pure JavaScript, its native parts refused). The password is a pairing code or a resume word
(three tries); or a public key the operator declared for a player. Only a terminal opens: the game's commands, and
`ls`, `cd`, `pwd`, `cat` on the game's virtual disk (`files`); `exec`, `sftp`, environment, agent and forwarding are
refused. Paths never leave the virtual tree, nothing typed is interpreted. The output wraps at the terminal's width.
Same limits as Telnet, and one session with one shell per connection; a connection authenticated without a shell
is closed after a minute. Generate the host key with `ssh-keygen -t ed25519 -f ssh_host_ed25519_key -N ''`.

## Open Badges

`"open-badge": { "port": 8790, "hosts": ["badges.example.org"] }`. A player posts
`{ "code": "ABCD2345", "badge": <a URL, a compact JWS, or the credential>, "email": "…" }` to `POST /v1/badges`. The
connector verifies Open Badges 2.0 (hosted: the assertion fetched again from its own id; signed: a JWS whose key the
issuer owns) and 3.0 (a VC-JWT, or a Data Integrity proof `eddsa-jcs-2022`; other suites such as `eddsa-rdfc-2022`
are `indeterminate`), the issuer among the game's `issuers`, the recipient against the email (hashed with the
badge's salt, then dropped), the dates, and the revocation (OB2 revocation lists, OB3 `1EdTechRevocationList` and
Bitstring status lists, cached at most a day). The verdict (`valid`, `invalid`, `expired`, `revoked`,
`indeterminate`) proposes the signal the game declares for it. Every document is fetched under a network policy:
`https:` only, hosts from `hosts` (by default the hosts of the issuers), the name resolved once and no private,
loopback or link-local address, two redirects, 64 KB, 10 seconds, JSON nested at most 8 deep, `@context` never
fetched. The game never receives the badge.

## What leaves a connector

The Bridge receives the signal's name, the player, the source, the deduplication key, the time, and the SHA-256 of
the connector's payload (`evidenceHash`): never the payload, the message, the line or the badge. Delivery is at
least once and applied once: a proposal whose answer was lost is sent again with the same key and the Bridge answers
`duplicate`. The log holds events, identifiers and counts; a string that looks like content (a space, an `@`, a
slash) is written `[redacted]`. What each connector keeps, and for how long: `docs/en/PRIVACY.md`.

## Testing without a network

`npx vitest run tests/connectors-*.test.ts` runs the same contract on the four connectors against a real Bridge on a
free port, their hostile fixtures (`connectors/test-vectors/`), Telnet and SSH under floods, slow clients and a
thousand connections, and the four driven under `--disallow-code-generation-from-strings`. `npm run fuzz:connectors`
feeds each one seeded mutations (`--cases`, `--seconds`, `--seed`). A game's recorded replays
(`games/<id>/replays/*.json`: connector inputs and the signals they made) are replayed through the real connector
code by `tests/connectors-replays.test.ts` and proved finishable by `npm run solve:reality`.

## Playing the sample chapter

`games/signals` has a chapter, "the mailbox and the terminal". Link the game (pause menu, World link), then: write to
the gate with "open the door" in the subject or the text, and the shed's door opens; type `lamp on` at the shed's
terminal (Telnet or SSH), and a lamp glows in the garden; show a badge from the garden guild, and a ribbon lands on
the bucket. None of it is needed to finish the game: the radio still opens the gate.
