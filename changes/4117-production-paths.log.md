## 4.1.17 PR 7 — the production paths: Mystery in the player, resume in every world, the worker's container, moderation

The player's Mystery flow (`mysteryFetcher`, `mysteryWorldOf` in `dom/remix-menu.ts`): commit, reveal, both tokens
verified offline (`reality/daily.ts`), the world built and the tokens kept beside it; `storedEvidence` returns them
with the start time when a speedrun starts. Tested through the Bridge's own routes with the published test key: a
reveal of another commitment, another game's tokens and a forged signature refused.

Resume: `SpeedrunRecorder.resume` refuses a proof other than the one sealed in the run's head (4.1.16 refused another
world only). `e2e:remix-speedrun` now records 499 looks and ten steps of the route, loses the page, resumes on a fresh
engine and plays the route again in each of the five worlds; the sealed run is verified in a new process.

The worker's container: `tools/speedrun/container.mjs` (the profile REALITY-OPS documented, now one function and a
command), `scripts/e2e-worker-container.ts` through `runWorker` itself, the hostile probe
`tests/fixtures/worker-hostile.mjs`. Docker is not running on the maintainer's Mac: the job is proved on the runner.

Moderation: `runs.adminTokenFile` read by `serve` (0600, 32 characters, refused otherwise); the bearer compared as
SHA-256 digests (`timingSafeEqual` of equal lengths: the token's length leaked before); refusals counted and audited.

`ship checks` waited for "every check listed" — 8 of 32 on #67 before the second tier existed; it waits for `pr-gate`.
The partition budget from candidate 37852879588 (matrix 12 with one worker: 85, 129, 146 s): 240 s.

→ next: the release commit (4.1.17).
