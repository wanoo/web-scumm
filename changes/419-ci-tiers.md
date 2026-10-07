### Changes

- **CI in three tiers, sized by the change** (4.1.9, lot 0). A pull request runs a fast tier on every change (`plan`;
  `check`: formatting, lint, knip, both type checks, the sample game's gates, `build:game` instead of `build`, the
  baseline, the proof; `coverage`: the unit suite once), then only the heavier jobs its diff can affect, as
  `tools/ci-plan.ts` classifies it (`npm run ci:plan`): a docs-only pull request opens no browser, no Windows runner and
  no Node 24; a Bridge change runs Reality, a painter the browser rows and the reference chapter. The browser rows and
  the Firefox PWA job play the `dist/` that `check` built instead of building it seven times; `node-24` runs the suite
  without `quality` again; `audit:deps` runs when the lockfile moved. The seventeen checks the ruleset requires keep
  their names and succeed with "not needed by the plan" when spared. The coverage ratchet warns on a pull request
  (`::warning::`) and stays strict on `main`, tags, the nightly and release-check. On `main`, on a tag and with the
  `full-ci` label, everything runs as before; a new `pr-gate` job sums every result up, the candidate single required
  check (`CONTRIBUTING.md`, "What CI runs"; `docs/en/SUPPORT.md` says what a pull request no longer checks). The `mutation` job no longer runs on a push to `main` either: a main run must stay short, since the release
  chain waits for the run of the exact commit it tags and a later merge cancels one still going; the nightly and
  `release-check` measure the sets, a `full-ci` label on a pull request too.
