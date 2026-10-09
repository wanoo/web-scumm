## 4.1.17 PR 5 — the code wheel's result computed again from its answers; what each trust level proves

`SessionEntry.mg` was the client's word (4.1.16): the replay checked a result was recorded and fed it back. Now the
code wheel also records a `CodeWheelTranscript` (`v`, `wheel`, `answers`, `end`) in `SessionEntry.mgt`, aligned with
`mg`. Found while writing it: the reference wheel's answers are translated (`STREET` / `RUE`), so a transcript of
texts would not replay across languages; answers are kept by their **place** in the author's list and `wheelHash`
hashes the wheel with places — the same in every language (tested with a French list). `SessionRuntime.minigame`
asks `core/minigame-proofs.ts` (a pure prover per minigame, engine-side: a game's data stays declarative) for the
result the transcript gives from the command's params; another result, another wheel (another seed) or a malformed
transcript throws a marked error the verifier turns into `invalid-replay` / `minigame-transcript` (not `inconclusive`
/ `crash`). A transcript edited after the seal breaks the chain (entries are hashed). `codeWheel.proof:
'transcript'` makes a category refuse a result without one (`code-wheel-proof`); `medium: 'physical'` with a played
wheel is `valid-unranked` (`physical-wheel-unwitnessed`).

`rulesVersion` (global to the manifest) does not move: no published category wanted the wheel won (all four Remix
categories let it be skipped, `medium: 'either'`), and the speedrun manifest is `meta`, outside `fingerprint.logic`,
so adding `wheel-proved` changes no run's hash; a 4.1.16 run is judged by its own engine version's archive anyway.
`wheelHash` uses FNV's prime as shifts (`tests/remix-compile.test.ts` forbids `Math` on the variant path). Node and
Chromium agree on the six new cases of `e2e:canonical` (58 values); WebKit and Firefox run in `cross-runtime`.
D30 (the tags' signature put off to 4.2) written beside D31.

→ next: PR 6, the Remix and Speedrun survivors (the transcript code under mutation first).
