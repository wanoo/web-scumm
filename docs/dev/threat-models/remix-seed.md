# Threat model: Remix seeds (4.1.15)

What a seed is, what it is not, and who could cheat with one. The decisions are ADR 0018 and D25–D28
(`docs/dev/DECISIONS.md`); the Bridge's general model is `docs/dev/THREAT-MODEL.md`.

## Assets

- **A world's assignment**: which anchor, room, route, code and order a seed gives. Public by design: the code is in
  the page, the assignment in the save and in the speedrun package.
- **A leaderboard's fairness**: two runs ranked together were played on comparable worlds.
- **A Mystery seed before its reveal**, and **the day's seed** before its day opens.
- **The player's privacy**: nothing personal travels in a code.

## What a seed is not

- **Not a secret.** A seed names a world; anyone who has it can play that world, and the web page can be read to find
  any answer. It authenticates nobody and protects nothing. The code wheel says so (a playful reconstruction, never DRM).
- **Not personal.** A code `WS-XXXX-XXXX` carries 35 bits drawn from WebCrypto (or typed), no player id, no date, no
  device. A shared code says nothing of who shared it.
- **Not a source of randomness for anything else.** A Reality signal is never used as an implicit random source; the
  world is fixed before the run, from the seed alone.

## Threats and answers

| Threat | Answer |
|---|---|
| A runner picks a favourable seed for Random. | Random ranks every seed together by the category's choice; seeds are shown at the start. A runner who wants no choice plays Mystery or Daily. |
| The Bridge picks a seed after seeing a runner's actions (to favour or hinder). | The day's seed is an HMAC of the day under the Bridge's secret, stored on first issue; a Mystery seed is drawn when its commitment is signed, before the run starts; no route of `bridge/src/daily.ts` reads an action (tested: actions posted afterwards move neither). |
| A runner learns a Mystery seed before starting. | Only `SHA-256(seed, nonce)` is published before the start (signed); the nonce is 128 bits; the reveal comes from the Bridge after. |
| A forged daily challenge. | The token is a compact JWS (EdDSA) checked offline with the public key in the game's manifest (`remix.daily`); a token of another game, another day or a changed seed is refused. The reference's key is a published test key: its "challenges" prove the mechanism, not trust. |
| A save or a package claims a world it was not played in. | The world is hashed (`WorldVariant.hash`), the hash checked on load; a replay rebuilds the stored world and replays the inputs; a speedrun verifier also checks the category's world (`worldVerdict`). Integrity is not authenticity: a client can build a consistent lie, which only a server that watched can refute (ADR 0017). |
| A typo silently loads another world. | The check symbol catches every single wrong symbol; a wrong code is an explicit error. |
| A new engine version changes old worlds. | A stored world is never regenerated; an unknown algorithm version is refused for generation and loaded as stored. |
| A link wipes a game in progress. | A link (`?seed=`, `?daily=`, `?world=`) only chooses the world; a new game in it is asked for on the title screen. A save from another world names its world (`SaveWorldMismatch`). |

## Not covered

A runner who edits the page, the engine or the save to play another world than the one claimed: the replay and the
category checks catch the inconsistent lies, not the consistent ones (ADR 0017's trust levels). Human passes of the
five playtest seeds were not done for 4.1.15 (D12).
