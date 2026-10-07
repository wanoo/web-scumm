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
| [0008](0008-connector-sdk.md) | A connector is a process of its own, behind one small SDK (4.1.9) |
| [0009](0009-reality-store.md) | The Bridge keeps its state behind an asynchronous `RealityStore` (4.1.10) |
| [0010](0010-signal-v2.md) | `SignalV2`: a signed signal names the context it was signed for (4.1.10) |
| [0011](0011-scene-frame-intents-journal.md) | A scene frame, intentions and a semantic journal (4.1.11) |
| [0012](0012-canvas-backend.md) | Canvas 2D stays the complete backend; WebGL/Pixi not measured in 4.1.11 |
| [0013](0013-game-ir-and-fingerprint.md) | One intermediate representation of a game (GameIR) and its fingerprint (4.1.12) |
| [0014](0014-objectives.md) | Objectives and the quest journal, the one primitive family admitted in 4.1.12 |
| [0016](0016-run-clock-and-envelope.md) | A run clock that observes, a seeded generator, a chained proof of a run (4.1.14) |
| [0017](0017-speedrun-verdicts-and-trust.md) | Speedrun verdicts and trust levels (4.1.14) |
