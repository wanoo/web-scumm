## `feature/419-ci-tiers`: CI in three tiers, the second sized by a tested plan, the 17 required checks kept

- Measured by the user on 7 October 2026 (GitHub runs): 20 jobs per pull request, a green CI in 11–19 min for 59–61
  runner-minutes, `quality` run twice (`check`, `node-24`), the unit suite twice (`check` through `build`, `coverage`),
  `dist/` built seven times (`check`, six e2e rows) plus once in `pwa-firefox`. Not measured here: the expectations
  below are said as such until the first runs.
- `tools/ci-plan.ts` (self-contained, run by `node --experimental-strip-types` without `npm ci`): the diff
  (`HEAD^1...HEAD` of the pull request's merge commit) classified by the first matching rule into ten gates (`node24`,
  `e2e`, `reference`, `reality`, `pwaFirefox`, `windows`, `secondGame`, `freshInstall`, `upgrade`, `auditDeps`). The
  workflow, the plan, the lockfile, `package.json`, the configurations, the app shell, the build plugins, the engine's
  core and an unknown path run everything; a git error too. `tests/ci-plan.test.ts`: a table of changes and plans,
  the self-exclusion rules, every tracked file known to a rule, and `ci.yml` wired to it (every gate read, the
  seventeen required names and matrix rows present, every step of a gated job behind `env.RUN`, `pr-gate` needing
  every job).
- The ruleset requires seventeen names and a skipped job does not satisfy one (a skipped matrix does not even expand
  its names), so the plan gates the work inside each job, not its existence: a spared job runs one step, "not needed
  by the plan", and succeeds. The draft's grouping by browser waits for the ruleset to require `pr-gate` alone.
- `check` no longer runs the unit suite (`build:game`, not `build`) and uploads the two-entry `dist/` as an artifact;
  `e2e` and `pwa-firefox` download it. `reference`, `reality`, `second-game`, `fresh-install`, `upgrade` and `windows`
  keep their own build (another game, or a build on Windows is the check). `node-24` runs the suite only. The
  coverage ratchet annotates (`::warning::` on a pull request, `::error::` and red under `--strict` on `main` and tags).
- Expected, not measured: a docs-only pull request in about 8–9 min wall (bounded by `coverage`) for about 25
  runner-minutes (fast tier ~20, eleven spared jobs ~1 each); an engine-core pull request in 13–17 min (the second
  tier now waits for `check`, ~7 min, but builds nothing in seven jobs) for about 50 runner-minutes.
- Not done here: the ruleset (the maintainer's move, after a few green runs of `pr-gate`), the e2e rows grouped by
  browser, the release accelerated (lot 0 point 8). `tests/quality-baseline.json` not ratcheted (more declarations
  pass `--check`).

→ next: Claude · `release/4.1.9`
