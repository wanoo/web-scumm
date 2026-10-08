## `feature/4116-code-wheel`: a minigame's result in the session, the replay and the story; the code wheel by keyboard and gamepad (4.1.16 PR 4)

- Delivered: `MinigameResult` and `SessionEntry.mg`; `SessionLog.minigame` (fed back like `picks` and `maps`); the
  `minigame` command writes `minigame.<id>` through `set` (so the journal says `flagChanged`); the presenter listens
  to `mg-record`, returns the result (every minigame: skipped, else won) and restores the focus (the scene becomes
  focusable out of the Tab order when the focus was nowhere); `judge` gives `failed` for a lost `story` wheel; the
  wheel's Escape, strict focus, gamepad selection and confirmation, `fail` text; the verifier's `code-wheel-rule`
  over the replayed flag; the validator refuses a command setting `minigame.*`. Tests:
  `tests/critical-minigame-outcome.test.ts` (in the `core` mutation set: recorded, flagged, journaled, fed back; a
  silent minigame records nothing; the category rule four ways), `tests/code-wheel.test.ts` (Escape, strict focus, a
  gamepad's whole game, `failed`), `scripts/e2e-a11y.mjs` (the wheel won at the keyboard, its record, its flag, the
  focus back, no animation under reduced motion; axe on it).
- Decided: the narrative channel is a reserved flag (`minigame.<id>`, like `remix.*`, D28: no new condition or
  command, no new journal kind), and only a reported result writes it, so every session and run of 4.1.15 (the
  reference run goes through `cables`) replays to the same state and proof.
- Measured (local, 8 Oct 2026): `e2e:a11y --only=keys,axe` on the demo in Chromium and WebKit: the code wheel won at
  the keyboard in 1.0 s, axe clean on 8 minigames; mutation `core/session-runtime.ts` 62/64 killed (the 2 survivors
  named before this lot).
- Not done: the gamepad in a real browser (Playwright emulates none; the unit test drives the Gamepad API); a printed
  wheel used at a table and a screen reader user on the list (human passes, §18).
→ next: Claude · `chore/4116-gates-docs` (4.1.16 PR 5)
