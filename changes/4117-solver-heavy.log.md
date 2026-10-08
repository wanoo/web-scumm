## 4.1.17 PR 2 — the heavy solver suite green again, each red explained before anything was rewritten

**Oracle** (`reference proof`, `steps` 77d8e4f8… → a3ff31b3…, `flags` c9d2337e… → 22445e17…). `tools/oracle-case.ts`
ran the case on 570b57d (the fixture's commit, engine 4.1.8) and on 4.1.16: the first different session entry is
#57 of 62, `talk neighbor` with `picks [1,2]` → `[2,3]`; flags added `password_ok`, `pirate_checked`; reachable: the
same 288 states; verdict and path the same. Both come from the reference chapter's content, not the solver:
`hall.neighbor.i-know-the-password` (7bca122, 4.1.15 Remix) is a topic before the one the route picks, and
`pirate_checked` is the code wheel's map (1bc8164). Decision: the reference case written again, alone; the 202 other
cases unchanged, compared without `ORACLE_WRITE` (203 searches, 94 s on a laptop).

**Memo** (`expected 139916 to be less than 136176`). The counter is deterministic per environment: under vitest the
demo's proof took 64 170 tries with the memo on 4.1.14 (129 840 without: a gain of 2.02, passing by 1 %), 69 958 on
4.1.15 (136 176 without: 1.95). Under tsx the same search gives 59 754 — `import.meta.glob` loads no layout there, so
a parked character stands at the default spot. Traced to the memo key: `guests()` reads `players:<id>` for every
parked player and `atomValue` valued it with the whole entry, pixel positions included, which the search's
dimensions (`player:<id>`: room, live bag, live used) leave out. Valued by room, bag and used items: 56 588 tries,
a gain of 2.41; the 26 memo tests green, every skip verified (`memoVerify: 1`). The threshold stays at two.

**Partition** (600 s for eight searches). On a laptop: matrix 12 with 1, 2, 4 workers and 2 without the table takes
46, 25, 16 and 28 s, the stress game under 1 s each; the runner is about six times slower (memo's test: 16 s here,
102 s there) and shared the cores with eight other files. Each search is now its own test with a budget of 480 s, and
the heavy suite runs one file at a time (758 s on a laptop, 150 minutes allowed in the nightly). The budget is checked
against the candidate's three runner measures before the tag (25 % margin, plan §5.3).

→ next: PR 3, the leaderboard at any size.
