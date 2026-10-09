## 4.1.18 PR 1 — the Field Kit: a people's pass as a report bound to its candidate

- The plan `docs/dev/PLAN-4.1.18-DRESS-REHEARSAL.md` (the maintainer's, committed here; D32 adopts its §17
  recommendations) starts with what needs nobody: the passes as data. 4.1.17's sheet had thirteen rows "not done",
  read by `scripts/release-notes.mjs` as text; nothing could tell a pass of another commit, evidence that changed, or a
  failure from a pass not made.
- `tools/field/schema.ts` (zod, strict: an unknown field is refused), `tools/field/secrets.ts` (keys and tokens
  refused, addresses, bearers, password values and IPs redacted in logs), `tools/field/field.ts` (`init`, `check`,
  `report`, `bundle`). The thirteen ids are stable and untranslated. A candidate of 4.1.17 lists `.wsrun` files and the
  e2e report, not the tarballs (release.yml packs them): a report is bound to every digest the manifest names; PR 3
  brings the tarballs into the candidate.
- Tests first (`tests/field-kit.test.ts`, the plan's §5.5): another commit, run or digest; evidence missing or
  changed; `passed` without its time, operator, environment, scenario or evidence, or with a failure; a failed pass
  without its failure, a blocked one without its reason, a pass not run with a time; an unknown field, two reports of
  one pass, a missing pass; an address, a bearer or a key in a report or its evidence; `--require`; the sheet's
  thirteen rows and counts; 4.1.17's sheet still read; the bundle's redaction, refusal and `tar`.
- The Postgres service of ci, the candidate and the nightly (and the development compose) is pulled from
  `mirror.gcr.io`, the same digest: a shared runner meets Docker Hub's anonymous pull limit (`toomanyrequests`, seen on
  two jobs on 9 October), and a red `bridge-postgres` for a registry's quota is a red gate for nothing.

→ next: Claude · 4.1.18 PR 2, `connectors` and `reality-store` read and gated
