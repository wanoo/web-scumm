### Changes

- **The Field Kit** (4.1.18, FIELD): a people's pass is a JSON report bound to the candidate run it tried (commit, run,
  the SHA-256 of every file it judged), with four statuses never merged (`not-run`, `blocked`, `failed`, `passed`).
  `npm run field:init` writes the thirteen passes at `not-run`; `field:check` refuses a report of another candidate,
  evidence whose SHA-256 changed, a `passed` without its time, operator, environment, scenario or evidence, two reports
  of one pass, a field the schema does not name, and a key, a token, an address or a bearer; `field:report` generates
  the sheet's people's passes; `field:bundle` packs a report and its listed evidence, logs redacted, refused on a key.
  The release notes count only `passed` as done.
