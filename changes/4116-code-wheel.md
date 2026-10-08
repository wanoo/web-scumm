### Changes

- **A minigame's result counts** (4.1.16, plan §9): a minigame that says how it ended (the code wheel's `mg-record`)
  has its result recorded in the session (`SessionEntry.mg`, fed back on a replay like a choice) and written in the
  reserved flag `minigame.<id>` (`won`, `passed`, `skipped`, `failed`, `disabled`), which the story reads with
  `{ flag, eq }` and the journal reports as `flagChanged`. In the player every minigame reports (skipped, else won);
  the solver and the sessions of 4.1.15 record nothing new and replay as they were. A behaviour change for existing
  games: a save made in the player now carries a `minigame.<id>` flag for each minigame played (the solver does not
  explore branches hung on one). `Presenter.minigame` may resolve
  with the result; a command never sets a `minigame.*` flag (validator).
- **The code wheel, end to end**: a `story` wheel lost after its tries ends `failed` (no longer like a parody); the
  whole wheel by keyboard (Escape skips, a strict wheel starts focused on a turn button) and by gamepad (up and down
  choose an answer, A confirms, B skips); the focus returns to the game when any minigame closes; a speedrun
  category's `world.codeWheel` is enforced by the verifier (`code-wheel-rule`: `skip: false` wants it won,
  `enabled: false` wants it not played). `e2e:a11y` wins the wheel at the keyboard, checks the record, the flag, the
  focus and reduced motion, and runs axe on it.
