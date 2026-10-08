## 4.1.17 PR 1 — release truth: the candidate a tag stands on, the load that measures its store, one job per mutation set

Step 0 (plan): the 4.1.16 nightly (run 37765270588, on the tag's commit 969929c) read again. `heavy`: memo
`expected 139916 to be less than 136176` (69 958 tries ×2 against 136 176: a deterministic counter, not CI noise),
partition 1/2/4 workers past 600 000 ms, the oracle `[ 'reference proof' ]` instead of `[]`. `bridge-load (sqlite)`:
`unknown store ""` — `tools/bridge-load.ts:36` did `BRIDGE_STORE ?? 'sqlite:…'` and `??` keeps `""`; `storeSpec()` in
`bridge/src/cli-store.ts` reads `""` as absent on purpose and is left as it is. `mutation`: `core` + `reality` green
(1 098 of 1 128 killed, 30 named, 0 unexplained), then `reality-store` in the same job hit the 90-minute budget (143).

Done: `tools/release/candidate.mjs` (gate, manifest, check, run-of) and `candidate.yml`; `ship tag --candidate=`
(required from 4.1.17, pre-releases included; the run id goes into the tag's annotation); release.yml checks the run
the tag names (workflow, green, manifest of this SHA and run, every SHA-256) and publishes its files; `bridge-load
--store=` with the backend read from `store.kind` and the checkout's commit; `tools/load-report.ts`; each gated
mutation set its own job in nightly, ci and candidate, `reality-store` alone with 180 minutes; the mutation reports
uploaded with `include-hidden-files` (they never were: `.cache/` is hidden); `scripts/upgrade-source.mjs`.
Found on the way: GITHUB_SHA is the branch head on a dispatched run, not the SHA it was asked to test, so the reports
read the checkout's commit. The oracle's diagnostic moves to PR 2, where it is used.

→ next: PR 2, the heavy solver suite (oracle diff, memo profile, partition budget).
