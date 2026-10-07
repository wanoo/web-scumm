## `feature/4114-time-attack`: speedruns: the run clock, the seeded generator, the chained run, the verifier, the local tools and the Bridge's worker (4.1.14 "Time Attack", one pull request)

- **Delivered**, in the sheet's order (`docs/dev/plans/4.1.14-time-attack.md`), each with its tests first: ADR 0016
  (clock, generator, chunks, chain H0…Hn, reload policies, integrity ≠ authenticity), ADR 0017 (verdicts, trust), D23,
  D24, `docs/{en,fr}/SPEEDRUN.md`; `core/run-clock.ts` + `TIMING_VERSION`; `core/prng.ts` + vectors; `core/run-tape.ts`,
  `core/journal-chunks.ts`, `dom/run-store.ts`; `GameDef.speedrun` + validator + the fixture category with no change
  under `src/`; splits, records, routes, ghost (`src/engine/tools/speedrun/`); the envelope and the recorder; the
  verifier, `speedrun:verify`, the CLI command, the MCP tool; Reality policies; `tools/speedrun/{overlay,livesplit}.mjs`;
  `bridge/src/runs.ts` + `tools/speedrun/worker.ts`; the Studio's speedrun panel; `scripts/e2e-speedrun.mjs`; the
  reference run committed (`tests/fixtures/speedrun/reference-any.wsrun`) and the release's ninth asset.
- **Measured** (local, 7 Oct 2026): the reference Any% run: 49 steps, IGT 2:35.234, active 2:23.434;
  `npm run speedrun:verify` on it 77 ms of replay (0.37 s with `tsx`); the isolated worker, spawn included, 272 ms (budget
  60 s); the clock's property on 200 generated games, live then replayed, 2.8 s for the file. `npm run build` and the
  bundle's weight were not run here (machine rule): the first visit now carries `core/run-clock.ts` and `core/prng.ts`
  statically, the speedrun mode is loaded on demand.
- **Decided**: `Engine.clock` keeps its meaning, the run clock is `Engine.runClock`; a line's logical cost is fixed
  (2.2 s) whatever its language or text speed (a translation is presentation), refusing the sheet's `f(length)`; a walk's
  logical length is measured between logical anchors (the presenter's end of a walk and the taps on the floor are not
  inputs); `finalProof` also seals the summary (timing, splits, final state, loads, signals), not only Hn; a resume after
  a crash is a load of the run's own state, allowed by every reload policy; `SESSION_MAX` 500 is both the chunk and the
  session's rollover; the `.mjs` local tools post only cleaned events (the `JSON.stringify` lint covers the TypeScript of
  `tools/speedrun/`); the speedrun manifest is `meta` in the IR (rules carry their own version); `core/fingerprint.ts`'s
  own `PRNG_VERSION` (0) is to import `core/prng.ts`'s (1): left to the 4.1.15 lot, which owns that line.
- **Not done**: the live witness (`server-witnessed` is reserved); the pinned-version replay in the worker (another
  engine version is `unsupported-version`); the worker's network is refused in-process (fetch, WebSocket, sockets), the
  OS isolation is the deployment's; a SQL `RunStore` (memory only) and the `/v1/runs` mount in `bridge/src/server.ts`
  (4.1.10 owns it); `e2e:speedrun` written but not run here and not in `ci.yml`; real OBS and LiveSplit sessions,
  speedrunners' field tests (human passes); the mutation sets do not yet include `run-clock.ts`, `prng.ts`,
  `journal-chunks.ts`; `.wsrun` names and the speedrun category names are not translated; the committed reference run
  must be re-recorded (`npx tsx tools/speedrun/reference-run.ts`) after `npm version` at the release.

→ next: Claude · `release/4.1.14`
