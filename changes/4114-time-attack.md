### Breaking

- **A session holds 500 entries, not 5,000 (4.1.14, ADR 0016).** `SESSION_MAX` (`Engine.SESSION_MAX`) is now the size
  of a run's journal chunk: the 501st input starts a new session from the current state, as the 5,001st did. A long
  session file is several files (or a run's chunks); `replay()` follows a session across its rollover (it reported
  "nothing happened" at the rollover before).
- **`engine.random` draws from the run's seeded stream (4.1.14).** By default the engine no longer calls `Math.random`:
  it draws from the `logic` stream of the run's seed (xoshiro128**, `core/prng.ts`). A host or a test that sets
  `engine.random` is unchanged; a session whose host chose the seed (`Engine.sessions.nextSeed`) writes `Session.seed`.

### Changes

- **Speedrun categories as content (4.1.14, `docs/en/SPEEDRUN.md`).** `GameDef.speedrun` declares categories (timed on
  RTA, IGT or Active IGT; start and finish on semantic events; saves, pauses, hints, reloads, Reality policy, the
  fingerprint components a run must match, the inputs, a fixed or random seed), splits and the rules' version;
  `npm run validate` checks them. A category needs no change of the engine. The reference chapter declares Any%,
  Any% No Hints and Real Time.
- **The run clock (4.1.14, ADR 0016, D24).** `Engine.runClock` reads RTA (`monotonicNow`, never an authority), logical
  steps (one per input) and logical time (microticks: the declared durations of `core/timing.ts`, `TIMING_VERSION 1`;
  a line costs the same whatever its language or the text speed); Active IGT leaves out the cutscenes. It observes the
  engine and never writes the state; replayed, a session gives the same steps and times (200 generated games).
- **A seeded generator with streams (4.1.14).** `core/prng.ts`: xoshiro128**, `PRNG_VERSION 1`, a stream per purpose
  (`logic`, `cosmetic`, `minigame:<id>`, `copy-protection`), test vectors for every runtime
  (`tests/fixtures/prng-vectors.json`). `rnd[]` stays the trace: a verifier draws again and demands the same numbers.
- **Speedrun mode in the player (4.1.14).** Pause menu › Speedrun › a category: a new game with its seed, a timer,
  automatic splits (a missed split never spoils the attempt), the pause menu and the background recorded as intervals,
  **Export run** (`.wsrun`) at the finish, **Abandon run**; local records offline (personal best, best segments, sum of
  best, attempts, abandons), a ghost of the PB on semantic targets (off the first time a category is played). The run
  is written to IndexedDB (`web-scumm-runs`) in chained chunks of 500 inputs and resumes after a closed tab or a crash
  from its last chunk. New interface texts: `ui.speedrun`, `ui.exportRun`, `ui.abandonRun`.
- **The proof of a run and its verifier (4.1.14, ADR 0016, ADR 0017).** A `.wsrun` (schema 1) chains every input by
  SHA-256 from the category's rules to a final proof, with the final state's hash; `npm run speedrun:verify`, the
  CLI's `web-scumm speedrun verify` and the MCP tool `speedrun_verify` replay it with its seed and give one verdict
  with a code and a reason (`valid`, `valid-unranked`, `invalid-category-rule`, `invalid-replay`, `modified-game`,
  `missing-reality-proof`, `unsupported-version`, `inconclusive`, never valid). Twenty-nine alterations (time, action,
  seed, rules, signal, hash, chunk, shape) are each refused with their code. Reality categories keep each signal's
  signed JWS and check it with the Bridge's keys. A complete Any% run of the reference chapter is attached to the
  release, verified first.
- **Routes, ghosts and the Studio (4.1.14).** `.wsroute` routes (exported, imported, compared); the solver's witness as
  a logical route, never a record. The Studio's Play tab has a speedrun panel: categories and rules, a splits editor
  written back to the game, a preview of the splits on the frame's session, routes, the run's export.
- **OBS and LiveSplit, locally (4.1.14, D23).** `npm run speedrun:overlay` serves an OBS Browser Source (full, compact,
  transparent); `npm run speedrun:livesplit` exports a LiveSplit splits file and drives LiveSplit through its own
  WebSocket server. The game posts its run's events to them with `?speedrunTool=<port>`, nothing else.
- **Leaderboards on the Bridge (4.1.14).** `bridge/src/runs.ts`: `POST /v1/runs`, a queue, an isolated verification
  worker (its own process, bounded heap and time, no secret, no network, the package approved by fingerprint, its answer
  signed with a one-time key), leaderboards per category and seed kind (valid runs, pseudonyms, trust levels),
  moderation, deletion on request, 90-day retention. A module for the Bridge's host to mount (`runsRoute`).
