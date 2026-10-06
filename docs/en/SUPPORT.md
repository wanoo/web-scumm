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

**The 4.1.x line is the exception, said once (D14).** Since 4.1.1 the project stays on 4.1.x until 4.2, the final
version, and a 4.1.x release may *add*: an optional entry, field, route, command, hook or sub-object (4.1.1's
`web-scumm/reality`, 4.1.2's Bridge options, 4.1.4's `destroy` and hooks, 4.1.5's `sessions`, `camera` and `walker`,
4.1.6's two commands). What it may not do is what a patch may not do either: change or remove a public name or a
format. Every addition is optional, nothing of 4.1.0 changes, and a game or a host written against any 4.1.x runs on
every later 4.1.x. `docs/en/UPGRADING.md` has one section per release that says what, if anything, a host must know.

Supported: the current major's last minor gets fixes; the previous minor gets security fixes for three months after
the next one. The 3.x line ended with 3.9; its games move to 4.0 with `web-scumm migrate` (nothing to rewrite for a
game already on schema 3).

## Support matrix

What the automated gates run on every change, and what only people check (`docs/en/FIELD.md`):

| | Checked by CI on every change | Checked by people (not yet done) |
|---|---|---|
| Player, phone | Chromium and WebKit at a phone's size, touch and keyboard, offline (Chromium), French | a real Android phone, a real iPhone, Safari offline on the device |
| Player, desktop | Chromium, mouse and keyboard | — |
| Player, screen reader | axe-core on every screen (not a WCAG claim) | a VoiceOver or NVDA pass |
| Firefox | not in CI | nothing claimed |
| Node | 22 and 24 on Ubuntu; macOS for the maintainer's daily use | — |
| Windows | the scripts run (`cross-env`, no `mkdir -p`); not in CI | `npm run doctor`, `npm run dev` on Windows |
| Python | optional: the art tools and the audio pipeline, Pillow, NumPy, SciPy pinned in `requirements.txt` | — |
| Reality Bridge | Node 22+, Chromium and WebKit e2e, a Rust cross-check of the protocol | a Bridge behind HTTPS with a real connector |
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
