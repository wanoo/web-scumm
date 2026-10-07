# 0017 · Speedrun verdicts and trust levels (4.1.14)

**Context.** A speedrun is submitted as a `.wsrun` envelope (ADR 0016). Someone has to say whether it is a run of this
category, on this game, as timed; and a leaderboard has to say how far it believes it. The programme refuses to promise
universal cheat detection (§10.1).

**Decision.** The verifier (`verifyRun`, `src/engine/tools/speedrun/verify.ts`; `npm run speedrun:verify`, the CLI's
`speedrun verify`, the MCP tool `speedrun_verify`, the Bridge's isolated worker) returns one **verdict** with a
**code** (machine) and a **reason** (one sentence):

| Verdict | When | Codes |
|---|---|---|
| `valid` | the replay reaches the finish, every recomputed value equals the envelope, every rule holds | `ok` |
| `valid-unranked` | as `valid`, but the time cannot be ranked by a replay (an `rta` category) | `rta-unverifiable` |
| `invalid-category-rule` | the run breaks a rule of its category | `unknown-category`, `hints-forbidden`, `saves-forbidden`, `pauses-forbidden`, `reload-forbidden`, `foreign-load`, `input-forbidden`, `reality-forbidden`, `seed-policy`, `start-trigger` |
| `invalid-replay` | the envelope does not replay as claimed | `envelope-shape`, `chunk-order`, `chunk-hash`, `chain`, `replay-diverged`, `rnd-mismatch`, `time-mismatch`, `splits-mismatch`, `final-state`, `not-finished` |
| `modified-game` | a fingerprint component the category requires differs from the approved package's | `fingerprint` |
| `missing-reality-proof` | a `recorded` or `live` category whose signals are missing, unsigned or do not match the entries | `signal-missing`, `signal-signature`, `signal-mismatch` |
| `unsupported-version` | the verifier cannot reload the exact rules or engine | `schema`, `engine-version`, `prng-version`, `timing-version`, `rules-version` |
| `inconclusive` | the verifier could not finish (a budget, a crash, no keyring for the signals) | `timeout`, `crash`, `no-keyring` |

`inconclusive` is **never** treated as valid: `isRankable(verdict)` is true for `valid` alone, a leaderboard keeps an
inconclusive run unranked and may retry it. The checks run in a fixed order (shape and versions, category and
fingerprint, chunks' order, replay, draws, clock, splits, final state, chain, rules on marks): the first that fails
names the verdict.

**Trust levels**, shown wherever a run is (the player's records, the overlay, the Studio, the Bridge's leaderboard):

- `local`: the player's own machine timed it; nobody else replayed it (every exported envelope says `local`).
- `replay-valid`: a verifier that is not the player's client replayed it and found it `valid`.
- `server-witnessed`: the server received the run's chunks while it was played and dated them itself (reserved: the
  live stream to the Bridge is not part of 4.1.14).
- `moderator-verified`: a human with the leaderboard's admin token looked at it (video, notes) and said so.

A level is only ever raised by someone other than the client; an envelope that claims more than `local` is read as
`local`. The Bridge's verdict is produced by an isolated worker (ADR 0016, D23): a separate process, bounded in CPU,
memory and time, with no secret of the Bridge and no network, the game package approved by fingerprint, its output a
structured verdict signed (HMAC) by the queue that spawned it; the HTTP process never replays.

**Cost.** Eight verdicts and some thirty codes to keep stable (tests/speedrun-verify.test.ts holds the alteration table);
a run whose time is RTA can be valid and still unranked.

**Would change it.** A verdict a leaderboard needs that none of these says; a witness protocol (4.2) that makes
`server-witnessed` real.
