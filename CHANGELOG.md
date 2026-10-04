# Changelog

## 3.0.0-beta.1 — 2026-10-04

First public v3 preview. The save envelope and authoring template are v3; existing v2 games remain supported during the beta. This release is not the final v3 compatibility commitment.

### Added

- Exhaustive solver proof mode with softlock classification, explicit assumptions and stable exit codes.
- Schema-v3 compilation boundary and stable persistence IDs.
- Validated v3 save envelopes, verified IndexedDB autosaves and visible storage failures.
- Generic quality commands, production PWA/browser smoke tests and dependency/asset audit separation.
- Complete extraction of verb and built-in minigame text.
- LAN capability-token and same-origin protection for Studio write routes.
- Semantic scene hotspots, live announcements and keyboard focus handling.
- Room-scoped, connection-aware asset warming.

### Changed

- Development servers bind to loopback unless a `:lan` command is used.
- Assistant keys use session storage; custom provider URLs are disabled by default.
- Sample asset licensing now matches the actual generated effects and non-commercial music source.
- Normal builds require a winning witness; exhaustive softlock proof is an explicit `prove:game` release gate, so a
  large game's honest `truncated` proof cannot masquerade as failure to build its playable witness.

### Fixed

- Truncated and unsuccessful solve runs no longer exit successfully.
- State-changing random branches and all nested dialogue choices are explored without a silent 32-variant cap.
- A multi-player demo branch that could consume another player’s required token.
