### Changes

- **The player's Mystery world** (4.1.17): the Remix menu's **Mystery world** entry asks the game's Bridge for a
  commitment and its reveal, verifies both offline with the game's daily key, builds the world and keeps both tokens
  beside it; a speedrun started in it carries them and its start time (`valid-unranked` without a server witness).
- **A run resumed keeps its world and its proof** (4.1.17): `e2e:remix-speedrun` interrupts and resumes a run in each
  world (Story, Remix Fixed, Remix Random, Daily, Mystery): the same head, world, proof, verdict and board; resuming
  in another world or with another proof than the one sealed is refused (`RunStartRefused`).
- **The speedrun worker's container profile is run in CI** (4.1.17): `tools/speedrun/container.mjs` makes its
  `docker run` arguments (no network unless `--allow-network`, read-only, a bounded `/tmp`, no capability, no new
  privilege, an unprivileged user, limits on processes, memory and CPU, the packages read-only, its own `timeout -s
  KILL`); `npm run e2e:worker-container` (CI's `worker-container` job, in the candidate and the nightly) runs the
  reference run inside it, then a hostile script refused the network, the host's files and secrets, and killed.
- **Moderation from `bridge serve`** (4.1.17): `runs.adminTokenFile` (0600, 32 characters at least; `serve` refuses a
  missing, short or world-readable file); the bearer compared as hashes of equal length; every refusal audited, never
  the token; `/healthz` counts moderations accepted and refused.
- **`ship checks` waits for `pr-gate`** (4.1.17): the second tier's jobs appear once `check` is done, so a list where
  every check passed could be partial (8 of 32 on #67).
- The connectors' ssh tests draw their host key through `sshKeyPair()` everywhere (4.1.17): two fixtures still called
  ssh2's generator, which now and then writes a key its own parser refuses (the "Malformed OpenSSH private key" flake).
- `tests/bridge-fanout.test.ts` removes its folder with retries (4.1.17): Windows keeps a killed instance's SQLite file
  busy for a moment (EBUSY in the Windows job).
- The heavy suite's partition budget is 240 s per search: the slowest of the candidate's three cold runs on the runner
  (146 s) and 60 % more.
