# Support and stability

What web-scumm promises from 4.0 on, and how it changes.

## What is stable

The public API (`docs/en/API.md`): the entries `web-scumm/content`, `/player`, `/minigames`, `/testing` and, since
4.1.1, `/reality`, the
authoring schema (`schemaVersion: 3`), the save envelope, the Studio/MCP tools' schemas and the `web-scumm` command.
Everything else under `src/engine` is internal: it may change in any release, and a game that reaches it through the
`@engine/*` alias takes that risk.

## Versions

Semantic versioning on the public API:

- a **patch** (4.0.x) fixes; it never changes a public name or a format;
- a **minor** (4.x) adds; it may deprecate, never remove;
- a **major** (5.0) may remove what a minor deprecated, and says how to move in `docs/en/UPGRADING.md`.

One exception, chosen by the maintainer (D14): **4.1.1 adds** (the entry `web-scumm/reality`, the content's `reality`,
the save's `reality`, the session's signal entry, the MCP's `solve` argument `reality`), which would be a minor. The
4.1.x line is where the project stays until 4.2, the final version. Every addition is optional, and nothing of 4.1.0
changes. 4.1.2 adds in the same way (optional fields on `RealityClientOptions`, `ExternalEntry` and the Bridge's
routes, a `mismatch` result, a lint code, two Bridge commands): the same exception, nothing of 4.1.1 changes. 4.1.4 adds
`destroy`, `onError`, `beforeSave` and `onLoad` on `Engine`, and `destroy` on `App`: the same again. 4.1.5 adds
`sessions` on `Engine` and `camera` and `walker` on the room view, and moves `@internal` members only: the same again.
4.1.6 adds two commands to the command line, an `optional` field to doctor's checks and `tools/vite/plugins.ts`,
and changes no API: the same again.

Supported: the current major's last minor gets fixes; the previous minor gets security fixes for three months after
the next one. The 3.x line ended with 3.9; its games move to 4.0 with `web-scumm migrate` (nothing to rewrite for a
game already on schema 3).

## Deprecation

A name or an option to be removed is first **deprecated** in a minor: marked `@deprecated` in its type (editors show
it struck through), listed in `docs/en/API.md` with its replacement, and named in the CHANGELOG's "Deprecated"
section. It keeps working for the rest of that major, and is removed in the next one. Deprecated in 4.0: `RevealDef`
(use `EndingDef`).

## Saves

A save written by any release of the 3.x or 4.x line loads in every later 4.x: the envelope is versioned (schema 3),
the game's own `migrations` carry its ids, and `tests/save-v3.test.ts` loads one frozen save of each release. A save
newer than the game it is loaded into is refused, never half read.

## Releases

Each release is built from the commit CI tested, carries its licences inside the archive, attaches an assets manifest,
an SBOM, SHA-256 sums and a provenance attestation, and is never replaced once published (`docs/en/TOOLS.md`). What
only people and real devices can check is reported in its notes (`docs/en/FIELD.md`).
