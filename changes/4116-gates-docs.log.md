## `chore/4116-gates-docs`: Remix and Time Attack gated together in four runtimes, docs checked against the code, the remix and speedrun mutation sets (4.1.16 PR 5)

- Delivered: `scripts/e2e-remix-speedrun.ts` (each world policy of the reference: the world made, Daily and Mystery
  through the Bridge's own module and the published test key; the route recorded by the real recorder in Node,
  Chromium, WebKit and Firefox, the same `.wsrun` byte for byte; verified by `speedrun:verify` in a new process and by
  a `RunQueue` whose worker is the real `tools/speedrun/worker.ts`); the reference's four world categories; the
  `cross-runtime` job (ci.yml, in `pr-gate`) and its nightly twin; `tools/docs-truth.ts` and its test; ARCHITECTURE
  and SUPPORT schemas; the `remix` and `speedrun` mutation sets, their scripts, and `tests/remix-tokens.test.ts`
  (every refusal of a day token, a commitment and a reveal, with real signatures) and
  `tests/speedrun-world-refusals.test.ts` (each alteration of a recorded Daily, Mystery and Fixed run's world and
  evidence).
- Measured (local, 8 Oct 2026): `e2e:remix-speedrun`: the five policies the same in four runtimes; any% valid on
  `any%` (ranked 155 234 000 µt), Remix Fixed valid on `remix-fixed:WS-0000-02DZ` (155 720 000 µt), Remix Random
  valid on `remix-random`, Daily valid on its day's board, Mystery `valid-unranked`. Mutation, first runs: `remix`
  424/590 killed, `speedrun` 397/513; after the two new test files, `reality/daily.ts` 76/78 then the last real one
  killed and one named (`TextDecoder`'s `fatal`, equivalent), `tools/speedrun/verify.ts` 329/379.
- Decided: the `remix` and `speedrun` sets are measured, not gated, in 4.1.16 (as `reality-store` was in 4.1.10):
  about 230 survivors in `compile.ts`, `apply.ts`, `categories.ts`, `seed-code.ts`, `recorder.ts`, `envelope.ts` and
  `verify.ts` are to be read one by one, killed or named, before the two join `GATED` for 4.2; naming them unread
  would make the gate say nothing. Vite 8's warnings about extensionless imports in the config's import graph (the
  future native config loader) are kept and explained: the default bundling loader is the one used (no
  `configLoader` setting, `vite.config.ts` and `tools/` import the engine's sources by their extensionless paths, as
  `tsc`'s bundler resolution does); a codemod adding `.ts` to some 300 imports would need `allowImportingTsExtensions`
  across the project, a mechanical change of its own for 4.2. The first-visit budget stays 140 KB (demo 133 KB,
  reference 137 KB); the 130 KB target for the reference is not reached.
- Not done: the per-policy resume after a chunk in `e2e:remix-speedrun` (the resume is `e2e:speedrun`'s, the world
  binding of a resume is a unit test); a code wheel by gamepad in a real browser.
→ next: Claude · the release commit of 4.1.16
