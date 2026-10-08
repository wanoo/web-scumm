### Changes

- **Remix and Time Attack are tested together, end to end, in four runtimes** (4.1.16, plan §10): `npm run
  e2e:remix-speedrun` takes each world policy of the reference (Story, Remix Fixed, Remix Random, Daily, Mystery),
  records the solver's route with the real recorder in Node, Chromium, WebKit and Firefox (the four `.wsrun` the same,
  byte for byte), verifies it in a new process and by a Bridge queue's isolated worker, and checks its verdict, its
  leaderboard key and its trust. A `cross-runtime` CI job runs it with `e2e:canonical`, `e2e:remix` and
  `e2e:speedrun` on every pull request (in `pr-gate`), and the nightly at 500 seeds.
- **The reference chapter races in Remix worlds**: categories Remix Fixed (`WS-0000-02DZ`, its own board), Remix
  Random, Daily and Mystery, beside Any%, No Hints and Real Time.
- **`npm run docs:truth`**: what the documentation states against the code (the save and `.wsrun` schemas, every
  script and tool file it cites, the capabilities it calls mounted, no release link newer than the version), in
  CI's `check` job. ARCHITECTURE and SUPPORT (en, fr) say saves schema 4 and `.wsrun` schema 2.
- **Mutation sets `remix` and `speedrun`** (`npm run test:mutation:remix`, `test:mutation:speedrun`, and
  `test:mutation:reality` named): measured, not gated yet; their first runs left survivors to read before 4.2.
