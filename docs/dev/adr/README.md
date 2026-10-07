# Architecture decision records

Decisions that look surprising without their context (4.1.0 "Clarity"). One file each: the context, the decision,
what it costs, what would change it. The maintainer's decisions themselves are dated in `docs/dev/DECISIONS.md`.

| # | Decision |
|---|---|
| [0001](0001-dom-renderer.md) | The DOM is the reference renderer |
| [0002](0002-declarative-content.md) | Content is data; code a game needs is trusted and named |
| [0003](0003-solver-runs-the-engine.md) | The solver runs the real engine |
| [0004](0004-session-unit-of-reproduction.md) | A session is the unit of reproduction |
| [0005](0005-indexeddb-read-back.md) | A save is read back before it counts |
| [0006](0006-double-tap-default-verb.md) | A double tap acts with the verb a player means |
| [0007](0007-biscuit-and-signed-events.md) | Biscuit authorises a connector; a signature attests an event (4.1.1) |
| [0015](0015-compact-state.md) | A search stores its states by index, with exact interned keys (4.1.13) |
