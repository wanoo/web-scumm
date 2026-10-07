# Email connector: threat model (4.1.9)

**What it does.** Turns an email into a declared signal: a message whose subject or text contains every word of an
answer the game declares (`reality.connectors.email.answers`) proposes that answer's signal for the player the
message is addressed to (`<anything>+<playerId>@<domain>`), or links a player when it carries a pairing code. Two
modes: `webhook` (a provider posts the raw message, signed with HMAC-SHA256 over `<timestamp>.<body>`) and `imap` (the
connector polls a mailbox over TLS).

**Assets.** The players' addresses and messages (personal data); the webhook secret and the IMAP password; the
connector's Biscuit; the game's state through the signals it proposes.

**Adversaries.** Anyone who can send an email to the address; anyone who can reach the webhook URL; a provider or a
mailbox replaying old messages; a player trying another player's signal.

| Threat | Answer | Test |
|---|---|---|
| A MIME bomb (nested multiparts, a huge part, a base64 that inflates) | The raw message is refused above `maxBytes` (256 KB by default) before parsing; the parser runs in a worker thread with a 64 MB heap and a 2 s budget, then is replaced; at most 3 levels of multipart, 64 parts, 256 KB of decoded text | `tests/connectors-email.test.ts` (fixtures `hostile-*.eml`), the fuzz harness |
| Recursive attachments (`message/rfc822` inside `message/rfc822`) | Attachments are refused by default: a message with one is rejected, never opened; an embedded message is an attachment | `hostile-nested-rfc822.eml` |
| HTML (scripts, tracking pixels, hidden text) | HTML is reduced to inert text (tags dropped, entities decoded, no URL fetched); the text is used for matching words only and never leaves the connector | `html-only.eml`, `hostile-script.eml` |
| Spoofed headers (`From` claiming another player) | A player is bound by the recipient tag (`+p-…`) or by a pairing code; `From` counts only once a pairing code came from that very address (kept as a salted hash, in memory, `linkDays`). A spoofed `From` can then send a signal *to* that player, never take one from them or reach another; a stranger's `From` routes nothing | `spoofed-from.eml`, `tests/connectors-email.test.ts` |
| A replayed message (same `Message-ID`, a webhook posted twice, a mailbox reread) | `dedupeKey = sha256('email:' + Message-ID)`: the Bridge answers `duplicate`; a webhook more than 5 minutes old (timestamp) is refused | contract tests, `tests/connectors-email.test.ts` |
| A forged webhook | HMAC-SHA256 of `<timestamp>.<raw body>`, compared in constant time; the secret is read from a file | `tests/connectors-email.test.ts` |
| A message without `Message-ID` | Refused (no idempotence possible) | `no-message-id.eml` |
| Header injection in a reply | No reply is sent in 4.1.9 (not done, said in the CHANGELOG fragment); nothing of a message is ever written anywhere | — |
| Encoded words abuse (RFC 2047 with unknown charsets, invalid base64) | Decoded with the platform's `TextDecoder` (non-fatal); an unknown charset keeps the raw bytes as Latin-1; never an exception out of the worker | `encoded-subject.eml`, fuzz |
| An IMAP server that lies (huge literal, endless lines, chained `{0}` literals) | A line is at most 8 KB and a response line with its literals' markers 64 KB; a command collects at most 1 000 untagged lines, 64 literals, `2 × maxBytes` of literals and 1 MB of lines; a command answers within 30 s; else the connection is closed and the poll retried later. Without TLS only to a loopback host (else LOGIN would cross in clear). A refusal that may pass (the Bridge away, a quota) leaves the message unseen for the next poll | `tests/connectors-email.test.ts` (a fake IMAP server) |
| Retention | `keep: 0` (default): a message is deleted from the mailbox once its proposal is accepted or found duplicate; `keep: N`: deleted after N days; a refused message is flagged and kept for the operator | `tests/connectors-email.test.ts` |

**Residual risks.** A provider whose own signature scheme differs needs a small adapter in front (not shipped). DKIM
and SPF are not checked by the connector (not done in 4.1.9): a linked sender's address can be spoofed by someone who
knows it, and an address tag by someone who knows the pseudonymous playerId; either only sends that player a signal
the game declared. A game that needs stronger proof keeps such signals optional or uses a pairing code per message.
Charsets beyond what Node's `TextDecoder` knows are read as Latin-1.
