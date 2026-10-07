## `feature/419-gateways`: the connector SDK and four connectors (email, Telnet, SSH, Open Badges), one pull request

- The sheet's branches 1 to 7 (`docs/dev/plans/4.1.9-gateways.md`) folded into one branch, at the orchestrator's
  request, in their order: D19, ADR 0008 and the four threat models first (their own commit, before any connector
  code); then `reality.connectors` and the sample chapter; the SDK and the four connectors with their tests; abuse,
  fuzz, replays and the build check; docs, packaging and CI. The tests were written with each connector's code, in
  the same commits, not strictly before it: said as such.
- Decided here (ADR 0008). The payload stays in the connector: the Bridge's protocol has no payload field, so the SDK
  sends its SHA-256 as `evidenceHash`; the Bridge is unchanged. IMAP: a bounded client of seven commands
  (`connectors/src/email/imap.ts`) rather than `imapflow` (MIT, but eight runtime packages: a logger, a SOCKS client,
  charset tables); MIME: a bounded reader of our own in a worker rather than `mailparser`. SSH: `ssh2` 1.17.0 (MIT;
  asn1 MIT, bcrypt-pbkdf BSD-3-Clause, safer-buffer MIT, tweetnacl Unlicense), its optional `cpu-features` and `nan`
  mapped by the root `overrides` to `connectors/vendor/refused-native`: `npm ci` builds no `.node` (checked by a test
  and by the CI job). Type declarations for the part of `ssh2` used are local (`@types/ssh2` pins `@types/node` 18).
  Players link a connector with the pause menu's pairing code (typed at a terminal, an email's subject, posted with a
  badge); email also routes by a recipient tag `+p-…` and by a sender linked by a code (in memory, salted hash).
  Telnet and SSH share the source `terminal` in the sample game, which is what makes "one key from two connectors"
  meaningful. The `connectors` mutation set is outside `all`, so the gated sets and their cache key do not move.
- Measured (this machine, Node 22.14, 7 October 2026). `npx vitest run tests/connectors-*.test.ts
  tests/dist-no-server-code.test.ts --maxWorkers=1`: 8 files, 96 tests, 0 failed, under 6 s. Tests overall 1 002
  declarations in 134 files (945 in 126 at 4.1.8; README figures and `tests/quality-baseline.json` written by hand
  with the baseline's own count, not by `npm run quality:baseline`, which was not run). Proposal connector → Bridge
  accepted, 1 000 local proposals (memory store, one player): p50 0.42 ms, p95 0.86 ms (to the Bridge's acceptance,
  not to a player's screen). RSS after 10 000 hostile inputs per connector (`fuzz:connectors --cases=10000`, with GC):
  email 93 → 107 MB, Telnet → 109, SSH → 110, Open Badges → 142; 0 crash; 8 s per connector reached 0.27 to 1.7
  million cases, 0 crash. Coverage of `connectors/src` by its own tests: 88.98 % lines, 71.93 % branches, 83.26 %
  statements (`run.ts`, `registry.ts`, `config.ts` run in a child process: 0 % there). The connectors' tarball:
  27 516 bytes. The signals game built (`npx vite build`): `verify:dist` clean, no server marker in `dist/`.
- Run here: `npm run -s tsc -- --noEmit` clean; `npx biome check` clean on every file touched; `npx knip --no-progress`
  clean; `npm run audit` clean; `npm audit` (dev included) 0 vulnerabilities; `GAME=signals solve:reality` proved
  (closed, 2 scenarios, the replay, adversarial); `node scripts/pack.mjs` then the connectors' tarball installed with
  `--omit=optional --ignore-scripts` outside the repository: `--help` answers, `--disallow-code-generation-from-strings`
  too, and the packaged email connector read a message through its bundled worker. The run under that flag found the
  MIME worker's development boot missing under tsx (`import.meta.url` carries a query there): fixed.
- Not run here (the machine's rule: one suite at a time, no `test:node`, no e2e): the full suite, `test:coverage`,
  `npm run build`, `e2e:reality` (its two new steps, one key from two connectors three times and the replays
  proposed, are unrun), `fresh-install` (its connectors step is unrun; the same commands were run by hand),
  `quality:baseline --check`. CI runs them.
- Not done, said as such: replies to emails by templates (no SMTP); DKIM and SPF; RDF-canonicalised proofs
  (`eddsa-rdfc-2022` and others are `indeterminate`); OB2 signed with keys other than PEM; IMAP STARTTLS and IDLE (TLS
  from the first byte, polling); a per-address limit on Telnet and SSH (20 connections in all: one client can hold
  them, said in the threat model); a coverage floor for `connectors/` in `vite.config.ts` (to set from a full
  `test:coverage`, three points under it); the `connectors` mutation set run and gated; the nightly fuzz gating (after
  two green nights); the Telnet and SSH tests on Windows; the human passes (a real provider, a real badge, SSH and
  Telnet exposed: `experimental`, D12, D19); `tenantId` is in the context, `'default'`, and not sent to the Bridge.

→ next: Claude · `release/4.1.9`
