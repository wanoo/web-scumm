# The 4.1.8 → 4.1.15 programme, in one page

The decisions live in `docs/dev/PLAN-4.1.8-4.1.15.md`, in French: that file is the source, this page is its English
summary for a reader of the ROADMAP, the CHANGELOG or a pull request. Decided by the maintainer on 7 October 2026
(D18). The plan the releases are run from, with the branches of each version, is the maintainer's; what each release
changes is in the CHANGELOG and the LOG as it lands.

## Why a programme, why now

No production game depends on web-scumm yet: the maintainer's own game stays on engine 3.1.0 (D8), the independent
game is local. The saves, projects and public API of the 4.1 line are therefore oracles of behaviour (the bundled
games, the fixtures, the golden saves), not a park to preserve at any cost. The 4.1.x line becomes an **incubation
line**: a release may break a public name or a format when the programme needs it; each break is documented, ships
with a migration of the official contents where that helps the validation, and no durable compatibility layer is
added only to preserve an API nobody uses yet. 4.2.0 restores strict SemVer and is the first durable contract of the
series. A chosen break must be simpler to explain, easier to test and cheaper to maintain than what it replaces.

## The versions

| Version | Working name | Expected result |
|---|---|---|
| 4.1.8 | Foundation Reset | TypeScript 7, Vite 8, PWA 2; the Reality cursor fixed (P0, reproduced); mutation and coverage gates that block; `doctor --release` predicting `release-check`; only tracked files packed; the three biggest Studio tabs split |
| 4.1.9 | Gateways | email, SSH, Telnet and Open Badges connectors on one SDK, out of the game's process, with a threat model and fuzzing each; experimental until a real pass |
| 4.1.10 | Constellation | a durable Bridge (SQLite locally, PostgreSQL distributed), stateless instances, tenants isolated, at-least-once delivery with idempotent application; `SignalV2` if the threat analysis asks |
| 4.1.11 | Viewport | an immutable `SceneFrame` the renderer draws, intentions back; a semantic journal emitted by the core (room entered, item acquired, objective completed, ending reached) that the presentation subscribes to; the backend chosen after a measured prototype |
| 4.1.12 | Language | `GameIR`, one target for runtime, solver, replay, Studio and docs; a `GameFingerprint` (logic, trusted extensions, presentation, engine); the primitives Gateways and Viewport asked for; the core of the DSL stabilised |
| 4.1.13 | Proof at Scale | a reference matrix fixed before the code (seeds, budgets, machine); compact states, checkpoints, dominance audited against the exhaustive search; two thresholds: a minimum to ship, the matrix within budget as the goal, else the release is named "Solver Research" |
| 4.1.14 | Time Attack | categories, RTA and a logical clock in integer ticks, semantic splits, a chunked and hash-chained journal, a proof package verified headless and by an isolated worker on the server, ghosts, LiveSplit and OBS as local tools (D17 holds for the Bridge) |
| 4.1.15 | Remix | a `VariationManifest` compiled with a seed into an immutable `WorldVariant`; items, actors, clue-and-answer pairs and puzzle order vary under constraints; a valid seed always yields a world; finite catalogues proved entirely, generators publish their coverage; a diegetic code wheel (a playful, optional homage to the 1990s copy-protection wheels, built from the game's own actors and symbols, printable, never a DRM); the DSL frozen after it |
| 4.2.0 | Stable World | the contracts frozen, the compiled package on npm, the narrower host API, the human passes done on every supported surface, a first real reference game of 30 to 45 minutes |

## Rules of every version

1. A fixture or a test that shows the need, before the implementation.
2. An ADR for every new transversal contract.
3. The core stays deterministic, the content declarative.
4. Every primitive reaches the runtime, the validator, the solver, the replay, the Studio, the MCP and the docs.
5. Never `proved`, `verified` or `delivered` when a budget or a check was cut short.
6. Bundle, memory, build time, proof time and coverage measured against the previous version.
7. The packed archives are tested, not only the repository's checkout.
8. A record of decisions and known limits.
9. A human-pass sheet per release, even while it is not blocking (D12); blocking for 4.2.0 (D18).
10. The next version opens only once the current one's blockers are closed.

## How a release is run

A topic branch per lot (`feature/`, `fix/`, `refactor/`, `docs/`, `test/`), a pull request read by a second automated
context before it merges (a second reading, not an independent review), a merge on green CI, a `release/<version>`
branch for the version, the CHANGELOG, the ROADMAP, SUPPORT and the pass sheet; then `npm run ship -- chain <pr>
<version>` (`docs/en/TOOLS.md`): the merge, `main`'s CI, the annotated tag, the tag's CI, the release run, the
download and the verification of the sums and attestations. The riskiest versions (4.1.8, 4.1.10, 4.1.11, 4.1.14,
4.1.15) get a release candidate first, `vX.Y.Z-rc.1`, a GitHub pre-release with the same files and checks, and a
cycle of observation before the final tag.

## Out of the 4.1 line

A hosted commercial platform and billing; financial speedrun rewards; universal cheat detection; general physics; 3D;
consumer multi-device cloud saves; matchmaking and synchronised races; a story or dialogues generated by an AI at
runtime; procedural placement without constraints or a solvability proof; eternal compatibility with the experimental
4.1.x formats.
