# 0020 · A minigame's result is computed again from its transcript (4.1.17)

**Context.** 4.1.16 records a minigame's result in the session (`SessionEntry.mg`, fed back on a replay like a choice)
and lets a speedrun category judge the code wheel's (`codeWheel { enabled, skip }`, rule `code-wheel-rule`). The
result is the client's word: the replay checks it was recorded and replays it, never that it was earned. A category
that wants the wheel won is satisfied by the word `won` alone. A printed wheel (`medium: 'physical'`) is the player's
word too. Integrity of the chain (ADR 0016) does not turn a declaration into a proof.

**Decision** (D31, an additive correction to the freeze D28, made before 4.2).

1. **A transcript beside the result.** `SessionEntry.mgt?: (MinigameTranscript | null)[]`, aligned with `mg`. For the
   code wheel, `CodeWheelTranscript { v: 1, wheel, answers, end }`: each answer by its **place** in the author's
   `answers` (a translation changes the text, never the places), `wheel` the hash of the wheel with its answers
   replaced by places (`wheelHash`: the same in every language), `end` `decided` or `skipped`. Bounded (64 answers),
   validated as data from a client. Entries are hashed into the chain: a transcript edited after the seal breaks it.
2. **Judged again by the replay.** `SessionRuntime.minigame`, when it feeds a recorded result that has a transcript,
   asks the engine's prover (`core/minigame-proofs.ts`: a pure function per minigame, never in a game's data) for the
   result the transcript gives, from the params the world gave the command: the wheel generated again, each answer
   judged in order (`judge`), a decision ends it, an undecided wheel was skipped (never in `strict`). Another result,
   another wheel or a malformed transcript stops the replay; the verifier says `invalid-replay`,
   `minigame-transcript` (not a crash).
3. **A category asks for it.** `codeWheel.proof: 'transcript'`: every played wheel's result must come with its
   transcript (`code-wheel-proof`). Categories without `proof` keep 4.1.16's meaning and trust; no published category
   changes, so no `rulesVersion` moves. The reference chapter proves the mechanism on a category of its own,
   `wheel-proved`.
4. **A printed wheel is not seen.** `medium: 'physical'` and a wheel played: `valid-unranked`,
   `physical-wheel-unwitnessed`, until a moderator ranks it. The client's `medium` never makes a proof.
5. **What it proves.** A run whose transcripts give their results is logically consistent: `replay-valid`. It does
   not prove a person played it (a script can produce right answers); that is `server-witnessed` (the server saw the
   events) or `moderator-verified` (a human looked).

**Consequences.** A 4.1.16 session has no `mgt` and replays as it did; a 4.1.16 run is judged by the 4.1.16 archive
(its engine version), never re-judged against these rules. The presenter returns `{ result, transcript }` when a
minigame gives one (`Presenter.minigame`'s return type widened, additively). Node, Chromium, WebKit and Firefox
compute the same hashes and verdicts (`npm run e2e:canonical`).
