## 4.1.18 PR 2 — the connectors and the stores under mutation: 322 survivors read, both sets gated

- Measured fresh on 0f5854f on the runner (`mutation.yml`): `reality-store` 170/289 killed, 118 unexplained;
  `connectors` 459/663, 204 unexplained. The tests of those sets never exercised what the plan's §6.4 lists: no MIME
  size, depth or part limit, no JWS of another algorithm against a key (`none` with an Ed25519 key), no private JWK
  turned public, no redirect followed on a 404, no concurrent migration step, no read-only export snapshot.
- Read in seven slices by seven sub-agents in parallel (each its own branch and file of short tests, the mutants run on
  the runner per file, never on the maintainer's Mac; each mutant applied by hand against the new file first):
  store-sqlite 72/72, store-sql 85/85, migrations 20/21 (one named), store-memory 74/74, streams 34/34 (one old
  equivalence now killed and removed), sdk 153/153, mime 158/163 (five named), badges crypto 85/88 and fetch 93/95
  (five named), terminal line 101/101 and vfs 45/45.
- Source changes, each said why: SQLite's statement chain without the `:memory:` special case (never a key); the
  SDK's refusal map takes the code as `unknown`, a 5xx on the last try ends on the same refusal; base58's loops on
  `while (n)` (a BigInt never negative; the mutant was an endless loop); MIME's latin1 by Buffer's codec. One real bug:
  backspace after a multi-byte character in an SSH pty kept the lead byte.
- Then both sets measured whole on the merged branch, and gated: `GATED` lists every set, the four workflows run
  seven jobs, the nightly's separate reality-store job is gone, and `release.yml` reads the tag's own `GATED` (a
  set's presence said nothing: both existed, not gated, since 4.1.9 and 4.1.10).
- The second reading (an automated second context) confirmed the source changes behave as before, and found
  `release.yml`'s new step unsafe: any failure to import the tag's `tools/mutation-sets.ts` (every tag before 4.1.17
  has no `GATED`) was read as "not gated" and skipped every set silently. It now tells 0 gated, 3 not gated, 4 no
  `GATED` (the old detection, never for the two sets gated from 4.1.18 on) and stops the release on anything else
  (the four cases tried locally). One equivalence it doubted — verifyJws's catch, "verify never throws" — is a test
  now (node:crypto mocked to throw: the signature is refused); no real key made OpenSSL throw.

→ next: Claude · 4.1.18 PR 3, the archives consumed outside the repository on three systems
