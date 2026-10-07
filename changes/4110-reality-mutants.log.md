## `fix/4110-reality-mutants`: the reality set's 20 unnamed survivors

- The `v4.1.10-rc.1` release run: `673/717 mutants killed, 24 survivors explained, 20 not` (18 in
  `bridge/src/bridge.ts`, 2 in `bridge/src/lock.ts:22`). 19 killed by `tests/bridge-mutants-tenant.test.ts` (12 tests;
  the tenant fixture takes a clock); `bridge.ts:113 condition true` named in `docs/dev/mutants.json`, MUTANTS.md
  regenerated (`npx tsx tools/mutate.ts --doc`, 29 named).
- `npx tsx tools/mutate.ts --set=reality --file=bridge/src/bridge.ts`: `230/233 mutants killed, 3 survivors
  explained, 0 not`. `--file=bridge/src/lock.ts`: `2/3 mutants killed, 1 survivors explained, 0 not`. One run at a
  time; the bridge.ts run takes more than ten minutes.
→ next: Claude · the full `--set=reality` on the next candidate tag
