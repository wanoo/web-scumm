## `feature/4112-language`: GameIR, GameFingerprint, objectives, generated forms and DSL page (4.1.12 "Language", one pull request)

- Delivered, in the sheet's order (`docs/dev/plans/4.1.12-language.md`), one commit per branch, each with its tests
  written with or before its code: (1) ADR 0013, D22, `docs/dev/DSL-STABILITY.md` with the candidate primitives;
  (2) `core/canonical.ts` `canonicalJson`, the proof cache keyed by it, `scripts/e2e-canonical.mjs`
  (`npm run e2e:canonical`); (3) `core/ir.ts` `compileIR`, `core/ir-schema.ts` (zod), `core/ir-fields.ts` (every field
  classified, compiler-checked), `core/source-keys.ts` (provenance), `npm run ir`; (4) `core/fingerprint.ts`,
  `sealBuild` writing the built `site.json`, `__TRUSTED_EXTENSIONS__`/`__ENGINE_VERSION__`, the pause menu's row;
  (5) objectives (`GameDef.objectives`, `tools/validate/objectives.ts`, `core/objectives.ts`, `--goal=100%`, the quest
  journal, MCP `set_value` on `@game`, five objectives in `demo` and in `reference`, translated), ADR 0014; (6) and
  (7) nothing admitted, said in DSL-STABILITY; (8) `src/studio/forms-gen.ts`, the Language tab, `get_ir`;
  (10) `tools/dsl-doc.ts`, `docs/{en,fr}/DSL.md`; (9) `tests/propagation.test.ts` (committed after 10: its doc
  assertion reads the generated page); (11) API surface, UPGRADING §23, docs en + fr, TOOLS rows,
  `tests/migrate-official.test.ts`.
- Decided. The runtime does not consume the IR and `CompiledGame` does not derive from it: the IR is a projection
  (ADR 0013). Measured on this branch: 641 reads of the game object in `src/engine` (core 171 in 19 files, dom 132 in
  14, tools 300 in 20); the IR leaves presentation out by design, so either other path rewrites those reads and loses
  the logic/presentation split the fingerprint needs. Text is logic; the fingerprint is computed on the game as
  written. Objectives completed live with the session, not the save (ADR 0014): no save migration, no solver state.
  `trustedExtensions` hashes the game's code files by convention (every `.ts/.js/.mjs` outside `rooms/`, the four
  content files and the asset/test folders); `''` when the build said nothing, shown `????????`.
- Primitives. Admitted: objectives and the quest journal (the sheet's family, 4.1.14 needs named steps). Refused or
  already there, each with its game or fixture in DSL-STABILITY: wait for a signal (listeners, `waitEvent`), delay and
  expiry (a script's `wait` then `if`), correlation and capability and consent (outside the DSL, D19), single
  consumption (`SignalDef.once`), offline fallback (`SignalDef.fallback`), indeterminate (`connectors['open-badge']`),
  conditional layers (`visible`), camera, timelines (`anim.at`, `path`, `parallel`), interruptible sequences
  (`cutscene`), audio-cue sync and rendezvous (no proof), named dialogue states (topic `if` + `nth` + `seen`).
- Measured (local, 7 Oct 2026, this worktree). `npm run solve -- --goal=100%`: demo solved, 35 states; reference
  solved, 1 447 states, 0.8 s. `validate.ts` 1 140 → 1 113 lines (cap lowered); `core/engine.ts` 792 → 797. New test
  files 12, 119 tests: canonical-json 56, ir 11, fingerprint 8, objectives 12, propagation 8, dsl-doc 6,
  migrate-official 5, studio-objectives 3, dom/studio-forms-gen 4, dom/pause-fingerprint 2, dom/quest-journal 2,
  dom/propagation-forms 2; all green, each run alone. Existing files run alone, green: journal (its expected kinds now
  include `objectiveCompleted`), core, core-runtime, tools, studio, studio-structured, studio-assistant (tool counts
  24 and 20), mcp, i18n, lint, replay, critical-replay, solver-contract, reference-chapter, demo-walkthrough,
  properties, critical-session, save-v3, engine-honesty, boot, pages, formats, content-ids, stable-ids, dom/a11y,
  dom/presenter, dom/intent-equivalence, dom/app-destroy, boundaries, file-size, api-surface, api-doc,
  scripts-documented, docs-truth, quality-baseline, changes. `npm run validate`: demo, reference, signals clean.
  `npm run i18n -- status`: demo and reference 100 % in fr. tsc, biome, knip clean; `api-doc --check` and
  `dsl-doc --check` up to date.
- Not done, said as such: `npm run e2e:canonical` was written, not run (this machine runs no e2e; CI's engine gate is
  to wire it in its e2e rows); bundle weight and `quality:baseline` not measured (no build here; the fingerprint's code
  is a lazy chunk, the objectives' tracker and menu are in the main chunk); `upgrade-check --from=4.1.11` not run;
  the full suite, coverage and mutation not run (CI). No content migration step was added to `web-scumm migrate`:
  4.1.12 changes no authoring format. The Studio's demo mode shows the IR without provenance and cannot write
  objectives (the dev server can). `IrVariantSlot` is a reserved type only.
- After the second reading of #46: Biome formatting fixed (`ir-schema.ts`, `migrate-official.test.ts`; `biome
  check .` clean); objectives are now checked after every state event of the journal as well as at each save (the
  `set`, `unset` and `lose` handlers change the state before journalling it), with a test that pins
  `objectiveCompleted` inside a cutscene; 100 % is said to mean "all at once" (CLI, `completionGoal`, ADR 0014) and
  the validator warns about a `done` the content can take back; a flag only an undeclared custom command could set
  says "declare the command's effects"; the field-classification test walks every section of the compiled bundled
  games and fifty generated ones; a computed or spread id has no provenance (tested).

→ next: Claude · `release/4.1.12`
