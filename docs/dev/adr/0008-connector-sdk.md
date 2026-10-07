# 0008 · A connector is a process of its own, behind one small SDK

**Context.** 4.1.9 "Gateways" (programme §5, D19) brings the first real connectors of the world outside: email,
Telnet, SSH and Open Badges. Each reads input written by strangers, each holds a secret, and none must reach the game
(a PWA with no socket, no secret and no executable content) nor its DSL. Until 4.1.8 the Bridge only had the
demonstration webhook in `bridge/src/server.ts`.

**Decision.** One SDK, `connectors/src/sdk.ts`, and one process per connector (`web-scumm-connector <id> --config
<file>`, `connectors/src/run.ts`), in a package of its own (`web-scumm-connectors`). A connector implements
`RealityConnector` (`start`, `stop`, `health`); its `ConnectorContext` gives it the Bridge, its attenuated Biscuit,
the game's Reality manifest, its limits, a log that redacts what looks like content, `pair` (a pairing code → a
player) and `propose`. It receives, validates and normalises, binds the input to a player, gives it a `dedupeKey`
(`sha256('<source>:<external id>')`: the Bridge's existing deduplication key, `bySequenceKey`, is the idempotence
key) and proposes; the Bridge sequences and signs as it did. The semantics are **at least once, applied
idempotently, one logical effect** per key: the SDK sends a lost proposal again with the same key and the Bridge
answers `duplicate`; never "exactly once". What a connector saw stays in it: the Bridge's protocol has no payload
field, so the SDK sends the SHA-256 of the canonical payload as `evidenceHash`, and the game receives only a declared
signal. `tenantId` is reserved (`'default'`) for 4.1.10. Health and metrics are counters in memory served as JSON;
SIGTERM stops the input, drains what is in flight for at most five seconds, and exits 0.

What the game declares for its connectors is data in `reality.connectors` (words of an answer, terminal commands, a
virtual disk, trusted badge issuers), checked by `npm run validate` and carried by the Reality manifest; no pattern,
script or path of the author's reaches a connector.

Two dependencies were weighed. IMAP: the usual client (`imapflow`) brings eight runtime packages (a logger, a SOCKS
client, charset tables); the connector needs seven commands, so `connectors/src/email/imap.ts` is a bounded client of
its own, tested against a scripted server. MIME: read by `connectors/src/email/mime.ts` in a worker thread with a
small heap and a time budget, rather than a general parser. SSH: `ssh2` (MIT, pure JavaScript), its optional native
parts (`cpu-features`, `nan`) mapped by the root `overrides` to a stub that refuses them
(`connectors/vendor/refused-native`): ssh2's install script still attempts a native build in the repository and fails
without the `nan` headers, so no `.node` file results; the package is installed with `--ignore-scripts`.

**Cost.** A fourth package to pack, install and document; four threat models (`docs/dev/threat-models/`); an IMAP
client and a MIME reader to maintain; `ssh2` to follow.

**Would change it.** A connector that needs to run in the Bridge's process for latency (none so far); a maintained
IMAP or MIME library with no dependency tree; a Bridge protocol that carries a payload (then the SDK would send it,
still checked here first).
