# 0016 · A run clock that observes, a seeded generator, a chained proof of a run (4.1.14)

**Context.** 4.1.14 "Time Attack" (programme §10, sheet `docs/dev/plans/4.1.14-time-attack.md`) times a speedrun and
lets a machine that did not see it say whether it happened as claimed. Until 4.1.13 the engine had a session
(`SessionEntry`, ADR 0004) with an optional `t` in milliseconds that the replay ignores, a presentation estimate of
durations (`core/timing.ts`, not a time anyone could rank on), `engine.random` unseeded (`Math.random`; `rnd[]` in the
entries is a trace) and a session cut at `SESSION_MAX = 5000` entries. A wall clock in a browser can be changed by its
owner; charter rule 10 forbids real-time scripting.

**Decision.** Five parts.

1. **The clock observes (D24).** `RunClock` (`src/engine/core/run-clock.ts`, `Engine.runClock`) has three readings:
   `monotonicNow()` (the host's monotonic clock, `performance.now` in the browser: RTA, never reproducible, never an
   authority), `logicalSteps()` (a `bigint`, one per top-level session entry: a transition of the core) and
   `logicalTime()` (a `bigint` in microticks, 1 ms = 1,000 microticks: the sum of the declared durations of what the
   core ran). It is fed by the core's own calls (an entry opened, a command stepped, an approach walk finished, a
   cutscene entered and left) and holds its own counters; it never writes `GameState`, never awaits, never schedules.
   `Engine.clock` keeps its 4.0 meaning (the millisecond source of an entry's `t`): the run clock is a new name, not a
   change of the old one.
2. **Logical durations are content, versioned.** `core/timing.ts` is their one source, `TIMING_VERSION = 1`:
   a line (`say`, a plain string, a fallback, a hint) costs `SAY_LOGICAL_MS` = 2,200 ms whatever its text, its language
   or the player's text speed (a translation is presentation: a French run and an English run of the same route have
   the same IGT; the sheet's `f(length)` was refused for that reason); an approach walk or a `walk` costs its distance
   over `WALK_SPEED` between **logical anchors** (the room's entry point, the last point the core walked or placed that
   character to: never the presenter's end of a walk, never a tap on the floor, which is not an input of the core);
   `wait` its milliseconds; `anim` its `ms` (default `ANIM_MS`); a camera pan its `ms` (default `CAMERA_MS`); the four
   motions their `ms`; everything else 0 (a choice waits for the player: think time is RTA only). A command run while a
   cutscene is skipped (`ctx.fast`) costs 0: the skip is an input (`skipAt`) and replays. **Active IGT** is the logical
   time minus the logical time spent inside a `cutscene`; pauses, menus, loads and the background already cost no
   logical time, and are recorded as RTA intervals the category's rules read.
3. **A seeded generator with streams** (`src/engine/core/prng.ts`): xoshiro128** (32-bit, `Math.imul` only, the same
   numbers in Node, Chromium, WebKit and Firefox; `tests/fixtures/prng-vectors.json` holds the vectors a cross-runtime
   test compares), `PRNG_VERSION = 1`, seeded by SplitMix32 over FNV-1a of the seed string. `derive(seed, streamId)`
   gives an independent stream per purpose: `logic` (what `engine.random` draws: lines picked at random, `{ random }`),
   `cosmetic` (presentation), `minigame:<id>`, `copy-protection` (4.1.15). `Session.seed` names the run's seed; a new
   game or a checkpoint reseeds, a load and the session's own rollover continue the stream. `rnd[]` stays the trace;
   the verifier replays **without** feeding it and demands that the seeded draws equal it.
4. **A chunked, chained journal** (`src/engine/core/journal-chunks.ts`): the run's entries go into chunks of
   `SESSION_MAX` = 500 entries (the constant is now the chunk size and the session's rollover); the browser keeps the
   current chunk in memory and writes each closed chunk to IndexedDB (`web-scumm-runs`, `src/engine/dom/run-store.ts`)
   in one transaction with the run's head (atomic close); after a crash the run resumes from the last chunk the store
   validated (its hash recomputed on read).
5. **One hash chain, the proof's integrity.** `H0 = sha256(canonicalJson({ fingerprint: the components the category
   requires, categoryId, rulesVersion, seed, prngVersion, timingVersion }))`; for each entry
   `Hn = sha256(Hn-1 ‖ canonicalJson({ entry, rnd, events, logicalSteps, logicalTime }))` (the entry without its
   `digest`, `rnd` its draws, `events` the semantic events it produced without their `seq`, the clock's readings after
   it as decimal strings); a chunk's `prevHash` is the H before its first entry and its `hash` the H after its last;
   `finalProof = sha256(Hn ‖ canonicalJson({ timing, splits, finalStateHash, marks, loads }))` (a deviation from the
   sheet's `finalProof = Hn`: the summary a leaderboard shows is in the chain too). `finalStateHash` is the SHA-256 of
   the canonical logical state (`logicalState`). **Every `bigint` is a decimal string** in an envelope and in a hash;
   nothing in `tools/speedrun/` calls `JSON.stringify` on an object (a lint test greps it).

**Reload policies.** A category declares `reload`: `invalidates` (any load ends the run's eligibility), `allowed` (a
load is fine when it restores a state the run itself reached: the envelope's `loads[]` says "before entry *n*, the
state after entry *m*", and the verifier restores its own snapshot of entry *m*; a save from outside the run is
`foreign-load`), `segment` (as `allowed`, and each load starts a new timed segment, the segments' sum is the time).

**Integrity is not authenticity.** The chain proves that a journal was not altered after it was sealed; it does not
prove it was honest: a client can recompute it, and a pause it does not declare is not seen. The replay proves the run
is *possible* and its logical time *exact*; RTA, pauses and menus are the client's word. Only observation by a server
(`server-witnessed`) or a human (`moderator-verified`) raises the trust (ADR 0017).

**Cost.** One more observer on the hottest path of the core (a function call per command and per entry, measured in
`tests/run-clock.test.ts` on 200 generated games); a `bigint` everywhere a time crosses a boundary; IndexedDB writes every
500 inputs; a session file now holds at most 500 entries (a long playtest is several files, or the run's chunks).

**Would change it.** A content duration the player can shorten without an input the session records (the presenter
would then be a source of time: refused by D21 and D24); a need to rank on think time (RTA with a witness instead).
