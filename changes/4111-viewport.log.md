## `feature/4111-viewport`: the scene frame, the intentions and the semantic journal (4.1.11 "Viewport", one pull request)

- Delivered, in the sheet's order (`docs/dev/plans/4.1.11-viewport.md`), each with its tests written first: the
  semantic journal owned by the core (`core/journal.ts`, `Engine.journal`, replay ⇒ the same journal on `demo`,
  `reference` and 200 generated games; the dev panel and `npm run replay` read it); `SceneFrame`
  (`scene/frame.ts`, pure, hit polygons precomputed; `room.ts` makes then paints it; the DOM of 33 room × state pairs
  held to its golden written on the code before the change); the presenter split (`dom/presenter.ts`, `intent()`,
  `dom/frame-renderer.ts`, `scene/null-renderer.ts`, `core/busy.ts`; `app.ts` 799 → 594 lines, `room.ts` 745 → 717);
  the Canvas painter's context-loss restore and the zone graph in `core/motion.ts`; "intentions DOM = intentions
  Canvas" as a happy-dom test (DPR 1/2/3, phone and desktop, reduced motion); the Studio's stage editor
  (`src/studio/rooms-stage.ts`) and the validator's two refusals (`tools/validate-stage.ts`, `validate.ts` 1183 →
  1140 lines). ADR 0011 and 0012, D21, ENGINE/STUDIO/TOOLS/API en + fr.
- Measured (local, 7 Oct 2026, this worktree): `npx vitest run` on the 11 new test files, 86 tests, plus
  `boundaries`, `file-size`, `api-surface`, `api-doc`, the 23 existing DOM test files, `replay`, `critical-replay`,
  `properties`, `core`, `core-runtime`, `demo-walkthrough`, `walk-topology`, `motion`, `reference-chapter`,
  `solver-contract`, `reality-engine`, `save-v3`, `lint`, `stage`, `scheduler`, `classics`, `tools`, `studio`: green.
  `tsc --noEmit`, `biome check` (468 files), `knip`: clean. The reference chapter's proof (`solve`, `prove`, 288
  states, three runs): 1 383–1 684 ms with the journal, 1 378–1 565 ms without (base 4f0d91b): no difference above
  the noise. `npm run validate` on demo, reference, signals: clean (`_template` fails on its uncut bucket image, as on
  main).
- Decided: the journal is a bounded window (10 000 events); `saveMade` is the autosave that follows a semantic event
  (a tutorial's refused tap, which no session records, adds none); no slot on `saveMade`/`loadMade` (a slot is not
  in a session, a replay could not reproduce it); the full frame is painted when a room is built and an entity that
  changes paints its own sprite between builds (ADR 0011, property 6); the DOM and Canvas painters own no input, so
  their `onIntent` is wired but never called by them (property 4).
- Second reading (PR #42), five "should" applied: the `validate.ts` cap lowered to 1140; `transfer` journals the
  loss and the acquisition with each `player`, a switch journals `playerSwitched`; `unset` journals `value: null`
  apart from `set(k, false)`; a session outgrowing the 10 000-event window is exported `journalTruncated: true` and
  `npm run replay` says it compared no journal; `RoomView.frame()` is memoised by a version (two taps, one frame). The
  nit taken: the painter boundary rule also reads `import()` and `core/players|save`.
- Not done: the WebGL/Pixi spike and every browser measure (`e2e:perf` on DOM and Canvas, CPU and memory budgets with
  `measureUserAgentSpecificMemory`, DPR in a real browser, `e2e:visual`, `e2e:a11y` on both painters, `e2e:studio` for
  the stage editor): this session may run no e2e; ADR 0012 says "not measured". Not run here: the full suite,
  `test:coverage`, mutation, `npm run build`, `quality:baseline` (CI runs them). `objectiveCompleted` waits for
  4.1.12. The CHANGELOG and LOG are this fragment and `changes/4111-viewport.md`.

→ next: Claude · `release/4.1.11`
