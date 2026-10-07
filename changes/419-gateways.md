### Changes

- **Four connectors of the world outside: email, Telnet, SSH and Open Badges** (4.1.9, experimental, D19, ADR 0008).
  Each is a process of its own (`web-scumm-connector <id> --config <file>`, or `npm run connector -- …` in the
  repository), never in the game nor its DSL, with one Biscuit attenuated to its own signals. Email: a provider's
  signed webhook or an IMAP mailbox, the message read in a worker under limits, HTML made inert, attachments refused,
  one signal per `Message-ID`. Telnet and SSH: a virtual terminal (the game's commands, `help`, `exit`) and, for SSH,
  a virtual disk (`ls`, `cd`, `cat`); no host shell, no `exec`, no `sftp`, no forwarding; line, rate, time and
  connection limits. Open Badges 2.0 (hosted, signed) and 3.0 (VC-JWT, Data Integrity `eddsa-jcs-2022`), issuer,
  recipient, dates and revocation checked, every document fetched under an SSRF-safe network policy; the verdict is
  `valid`, `invalid`, `expired`, `revoked` or `indeterminate`. A player links a connector with the pairing code the
  pause menu shows. Not done: replies to emails, DKIM and SPF, RDF-canonicalised proofs (`indeterminate`), a real
  provider, badge or exposed terminal tried by a person (`docs/en/SUPPORT.md`).
- **A game declares what its connectors may do, as data** (4.1.9): `reality.connectors` holds the words of an email's
  answers, a terminal's commands and replies, an SSH disk's files and the badge issuers a game trusts; `npm run
  validate` checks that every signal named is declared, that commands are plain words and not the terminal's own,
  and that paths stay inside. The Reality manifest carries the block (its hash changes only for a game that declares
  it). A game runs without any connector.
- **The connector SDK** (4.1.9, `connectors/src/sdk.ts`): a connector receives, validates, binds to a player, gives a
  `dedupeKey` (`sha256('<source>:<external id>')`, the Bridge's existing deduplication key) and proposes; delivery is
  at least once and applied once (a proposal whose answer was lost is sent again with the same key, the Bridge answers
  `duplicate`). What a connector saw never leaves it: the Bridge receives the SHA-256 of its payload as
  `evidenceHash`. Limits (size, a local quota, a timeout), metrics and `/health` in JSON, a log that writes
  `[redacted]` for anything that looks like content, SIGTERM drained in at most five seconds.
- **`web-scumm-connectors`, a fourth package** (4.1.9): one bundled module, its MIME worker beside it, `ssh2` (MIT)
  its only dependency, whose optional native parts are refused (`cpu-features` and `nan` map to a refusing stub): no
  native code is built. `npm run pack` makes four tarballs; `npm run fresh-install` installs this one without native
  code and runs `web-scumm-connector --help`.
- **A build that carries server code fails** (4.1.9): `verify:dist` (in `npm run build`) refuses a game's JavaScript
  that holds any marker of the connectors or the Bridge (`connectors/`, `ssh2`, `imapflow`, `web-scumm-bridge`…).
- **`npm run solve:reality` proves recorded replays too** (4.1.9): `games/<id>/replays/*.json` (connector inputs and
  the signals they made), proved finishable like the scenarios and replayed through the real connector code by a
  test, with no network. The sample game `games/signals` gains "the mailbox and the terminal": a letter opens the
  shed, a command lights a lamp, a badge puts a ribbon on the bucket, all optional.
- **Tools and CI** (4.1.9): `npm run fuzz:connectors` (seeded mutations of each connector's corpus, crashes and memory
  counted); a `connectors` CI job (the contract on the four connectors against a real Bridge, abuse and replay
  tests, a run under `--disallow-code-generation-from-strings`, half a minute of fuzzing, the tarball installed); a
  nightly fuzz of a minute per connector, not gating yet; a `connectors` mutation set, outside `all`, not gated yet;
  `e2e:reality` sends one key three times from two connectors and proposes the sample chapter's replays. The Windows
  job leaves out the Telnet and SSH tests until they are ported.
- **Documentation** (4.1.9): `docs/en/CONNECTORS.md` and `docs/en/PRIVACY.md` (what is kept, where, how long, how to
  delete), in French too; a threat model per connector (`docs/dev/threat-models/`); ADR 0008; D19.
