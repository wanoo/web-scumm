# 0003 · The solver runs the real engine

**Context.** A model of the game written for the solver would drift from the engine, and then a proof would prove
the model, not the game.

**Decision.** The solver (`src/engine/tools/solve/`) drives the same `Engine` the player uses, with a silent
`FakePresenter`: whatever it finds, a player can do, and its paths replay as sessions. Its speed comes from
abstractions over what a state is made of (`solve/abstractions.ts`), each one audited against the explicit search
(`npm run solve -- --audit-abstractions`, `npm run audit:corpus`), and from the engine's read and write traces.

**Cost.** Proofs are slower than on a hand-written model; large games prove by chapter and on workers.

**Would change it.** A game too large to prove by chapters, with an abstraction that cannot be audited.
