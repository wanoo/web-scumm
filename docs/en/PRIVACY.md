# Personal data: what is kept, where, for how long

What a web-scumm game, its Reality Bridge and its connectors keep about a player (4.1.9). The operator who runs a
Bridge and its connectors is the one who answers for this data to the players; this page says what the software
keeps so the operator can say it in turn. A game without `reality` keeps nothing beyond the player's own device.

## On the player's device

The save and the sessions live in the browser's storage (IndexedDB), on the device only. With a world link they also
hold the pseudonymous `playerId` the Bridge gave (`p-` and 16 hex digits, derived from nothing about the person), the
delivery cursor and the ids of the signals applied: never an email, a token, a message or a badge. The capability that
reads the player's signals is kept in the browser's `localStorage` (`<game>:reality-link`). **Deleting:** the pause menu's "Unlink" revokes
the link on the Bridge; erasing the save, or the site's data in the browser, removes the rest.

## On the Bridge

The journal (`journal.jsonl`, under the Bridge's folder) keeps, per player: the `playerId`, the SHA-256 of their
capability, its expiry; per signal: its id, sequence, name, source, the connector's deduplication key (a SHA-256 for
the connectors of 4.1.9), the hash of what the connector saw (`evidenceHash`), and the times. Pairing codes live in
memory for ten minutes. Logs name events and pseudonymous ids. **How long:** until `compact --retention-days=<N>`
(90 by default) drops the acknowledged signals older than N days. **Deleting:** `DELETE /v1/admin/players/<id>`
removes everything about a player; `GET` on the same route exports it (`docs/en/REALITY-OPS.md`).

## Email connector

**Webhook mode:** the message is read in memory and dropped; nothing is written. **IMAP mode:** the message stays in
the operator's mailbox, where it arrived: with `keepDays: 0` (the default) it is deleted as soon as its signal is
accepted (or found already accepted), with `keepDays: N` after N days; a refused message is flagged and kept for the
operator, who deletes it. A sender who sent a pairing code is remembered as a salted SHA-256 of their address (the
salt is random and lives as long as the process) mapped to the `playerId`, in memory, for `linkDays` (30 by default);
a restart forgets it. The address, the subject and the text are never logged, never sent to the Bridge (only a hash of
the Message-ID and the answer's number, hashed again as `evidenceHash`). No reply is sent.

## Telnet and SSH connectors

Nothing typed is stored: a line is matched against the game's commands and forgotten; the Bridge receives only the
signal's name. A resume word links a later session to the same player for 30 minutes, in memory. The public keys an
operator declares for players (`ssh.keys`) live in the connector's configuration until the operator removes them.
The client's address is used by the operating system for the connection only; the connector keeps no list of them.

## Open Badges connector

The badge and the documents it points to are fetched, checked and dropped; only a verdict leaves the connector, as a
signal, with a hash of the badge's id and issuer as `evidenceHash`. The email a player gives to match a hashed
recipient is hashed with the badge's salt for the comparison, then dropped: it is never stored, logged or sent.
Revocation and status lists (an issuer's, not a person's) are cached for at most a day. The addresses that post to
the form are counted in memory for a minute (the rate limit), then forgotten.

## Logs and metrics

Every connector logs JSON lines of events, identifiers (`playerId`, signal names, codes of refusal) and counts. A
string that looks like content (a space, an `@`, a slash) is written `[redacted]`; the tests check that no fixture's
address, text or secret reaches a log. Metrics (`/metrics`) are counters in memory. How long logs live is the
operator's rotation; they hold no content to delete, and a `playerId` in them is pseudonymous.

## Deleting a player's data, everywhere

1. On the Bridge: `DELETE /v1/admin/players/<id>` (the link, the journal, the acknowledgements).
2. In an IMAP mailbox: delete the player's flagged messages, if any (accepted ones are already gone with `keepDays: 0`).
3. In the SSH configuration: remove the player's declared key, if any, and restart the connector.
4. In memory (sender links, resume words): restarting the connectors forgets them all.
5. On the device: the player erases the save or the site's data.
