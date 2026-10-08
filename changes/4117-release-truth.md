### Fixed

- **The nightly's SQLite load measures SQLite** (4.1.17): its row set `BRIDGE_STORE=""` and `bridge:load` kept the
  empty string (`??`), so SQLite was never opened and the missing report failed nothing. Each store is now a job of its
  own with `--store=`; the report names the backend the store object is and the commit, and
  `tools/load-report.ts` fails a report that is missing, incomplete or of another backend.
- **One job per mutation set** (4.1.17): the 4.1.16 nightly ran the gated sets, then `reality-store` in the same job,
  which reached the job's 90 minutes and was killed after `core` and `reality` had passed. The nightly, ci (`full-ci`)
  and the candidate run each gated set in its own job; `reality-store` has its own budget. The mutation reports are
  kept with the run (`.cache/` was left out of every upload until now: hidden files).
- **`upgrade-check --from=v4.1.15`** downloads `v4.1.15` and `web-scumm-4.1.15.tgz`, not `vv4.1.15` and
  `web-scumm-v4.1.15.tgz`; a pre-release takes its tarball's name without the suffix (4.1.17).

### Changes

- **A tag stands on a candidate run** (4.1.17, plan §4.2): `gh workflow run candidate -f sha=<sha>` runs
  release-check, the heavy solver suite three times on new runners, the load on SQLite and on Postgres, the four
  runtimes and each gated mutation set, side by side; `candidate-gate` judges them all (a skipped job is red) and
  writes `candidate-manifest.json` (the SHA, the run, the SHA-256 of each file for the release). `ship tag … 
  --candidate=<run id>` refuses a run that is not a green candidate of that SHA and writes the run into the tag;
  release.yml checks that run's files against their sums and publishes them. `npm run release-check:local` is the part
  a machine can run.
- **The release carries the runs it was tested with** (4.1.17, the 4.1.16 plan's §11.3): Story, Remix Fixed, Remix
  Random, Daily and Mystery `.wsrun` files from `e2e:remix-speedrun --out`, 4.1.15's schema 1 run, their manifest
  (schema, world policy, rules version, test key, commit, the verdict this engine gives), the check's report and the
  candidate's manifest. The Daily and Mystery tokens in them are signed with the published test key: demonstration
  fixtures, not attestations.
