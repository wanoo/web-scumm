# 0012 · Canvas 2D stays the complete backend; WebGL/Pixi not measured in 4.1.11 (4.1.11)

**Context.** The programme (§7.3) asks to measure Canvas 2D against WebGL/PixiJS on the reference scenes before choosing
a backend by ADR, to keep Phaser out unless its systems bring a measured benefit over its weight and its overlap with
the engine, and to keep a simple backend for tests and machines without acceleration. The sheet of 4.1.11 sets the bar:
WebGL/Pixi only on a measured gain above 25 % (frames per second on `reference`, CPU slowed 4×, three scenes) **and**
under 150 KB of weight.

**What was measured.** Nothing new. The lot was built in a session that may not run an end-to-end test or a browser
(`npm run e2e:perf` drives Chromium): no Pixi prototype was written, no frame rate compared. The numbers that exist are
those of 3.4, recorded in `docs/en/ENGINE.md` ("The scene: a model and a painter") and the LOG: `npm run e2e:perf`,
60 frames per second for the sample game's rooms with the Canvas painter and the CPU slowed 4×, in the CI's
`chromium / canvas` row. There is no benchmark sheet under `docs/dev/` yet (the sheet names one, BENCH.md); the spike would start it.

**Decision.** Canvas 2D stays the complete backend (D10): it draws every capability the programme lists (layers,
parallax, arbitrary occlusion polygons and masks, lights, particles, vertical camera and zoom, transitions) and, since
4.1.11, survives a lost context (`contextlost`/`contextrestored`: nothing painted while lost, its caches rebuilt from the
images once restored). The DOM painter stays the reference. The null renderer (`scene/null-renderer.ts`) is the
backend for tests and headless runs. WebGL/Pixi is **not decided**: the spike stays listed for a later lot, with its
bar unchanged (> 25 % on three `reference` scenes at CPU ÷ 4, DPR 1/2/3, and < 150 KB). Phaser stays out (D10).

**Cost.** No GPU path: an effect Canvas 2D cannot hold at 30 FPS on a phone has no fallback yet. The decision rests on
3.4's measure of the sample game, not on the reference chapter's heavier stage.

**Would change it.** The spike, measured: Pixi above the bar on the reference scenes, or the reference chapter under
30 FPS with Canvas 2D on CPU ÷ 4 (`e2e:perf`), which would make the measure urgent.
