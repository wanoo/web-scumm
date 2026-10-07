# Open Badges connector: threat model (4.1.9)

**What it does.** A player submits a badge (a URL, a compact JWS, or a JSON credential) with a pairing code on a small
HTTP endpoint. The connector verifies it as Open Badges 2.0 (hosted or signed) or 3.0 (a Verifiable Credential secured
as a VC-JWT or with a Data Integrity proof `eddsa-jcs-2022`), checks issuer, recipient, expiry and revocation, and
proposes the signal the game declares for the verdict: `valid`, `invalid`, `expired`, `revoked` or `indeterminate`.
The game never receives the document: the payload is `{ badgeId, issuer, status, checkedAt }`, and only its hash
leaves the connector.

**Assets.** The connector's host and network (SSRF); the game's state; the player's email if they give it to match a
hashed recipient.

**Adversaries.** A player with a forged or someone else's badge; a hostile issuer or URL pointing inside the network;
a DNS server that changes its answer; a huge or deeply nested JSON-LD document.

| Threat | Answer | Test |
|---|---|---|
| SSRF (a badge URL or a redirect to `127.0.0.1`, `169.254.169.254`, a private range) | Only `https:`; the host must be in the operator's allowlist (by default the hosts of the game's issuers); the name is resolved once and the connection made to that address (no rebinding); loopback, private, link-local, CGNAT, multicast and unspecified addresses are refused, IPv4 and IPv6; at most 2 redirects, each checked the same way | `tests/connectors-badges.test.ts` (redirect to 127.0.0.1, a host resolving to 10.0.0.1, rebinding) |
| A huge or slow document | 64 KB per document, 10 s per fetch, 16 fetches per verification | test |
| JSON-LD tricks (remote `@context`, deep nesting) | `@context` is never dereferenced (the checks read plain JSON fields); nesting deeper than 8 is refused | recursive fixture |
| A forged signature | OB2 signed: the JWS (RS256, ES256, EdDSA) verified with the key the assertion names, whose `owner` must be the issuer; OB3: VC-JWT verified against the issuer's `did:key` or a JWK it publishes; `eddsa-jcs-2022` per the W3C suite (JCS, SHA-256, Ed25519); `eddsa-rdfc-2022` and other suites need RDF canonicalisation: `indeterminate`, never `valid` | broken-signature fixture |
| An unknown issuer | `issuer.id` must be one of the game's `issuers`: else `invalid` | fixture |
| Someone else's badge | The recipient (an email hashed with its salt, or an identifier) must match what the player gives; the email is hashed and dropped at once, never stored or logged | fixture |
| Expired, revoked | `expires`/`validUntil` against the clock; OB2: `revoked` in a hosted assertion, a 410, or the issuer's `revocationList`; OB3: `1EdTechRevocationList` and Bitstring/StatusList2021 entries; a status list that cannot be fetched or checked gives `indeterminate` | fixtures |
| Cache poisoning, stale revocation | Revocation lists cached at most 24 h, keyed by URL, bounded (256 entries), with the time they were fetched | test |
| Floods on the form | 64 KB per request, 30 verifications a minute per address, the pairing code checked by the Bridge | test |

**Residual risks.** A status list credential's own proof is checked only when it is a VC-JWT or `eddsa-jcs-2022`;
otherwise the verdict is `indeterminate`. OB2 `signed` with an RSA key in PEM is supported; other key formats are not.
A real issuer's badge was not checked by a person in 4.1.9 (`experimental` in SUPPORT, D19).
