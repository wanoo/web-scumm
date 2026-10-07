# 0015 · A search stores its states by index, with exact interned keys

**Context.** Up to 4.1.8 the search kept, for every state it had seen, a `SearchNode` object: the whole engine state
(`GameState`), its dimensions as an array of pairs, the copied steps of its last move, and a key that was the JSON of
those dimensions. On the open instances of the proof matrix (`docs/dev/PROOF-MATRIX.md`) that is about 35 KB a state:
the heap, not the clock, decides how far a proof goes on a 4 GB budget. The engine runs that produce the states stay
the cost per state (ADR 0003): a representation cannot make them cheaper, only smaller to keep.

**Decision.** `src/engine/tools/solve/search/compact.ts`. A state seen is an index into growable `Int32Array` columns:
its parent's index (the witness is rebuilt by walking them), its path length, its last step's labels and session
entries, its room and bag (each interned: the same strings are stored once), and the transitions as two columns
(from, to) for the reverse reachability that finds softlocks. Its key is its (dimension, value) pairs, each interned to
a number, sorted, written as a short string: equal exactly when the dimensions are equal, as the JSON key was, so no
hash collision can merge two states. The engine state is kept only while the node waits in the frontier, and for the
goal states a chapter's next proof starts from. A 64-bit hash (FNV-1a 64 of each pair, summed, so a transition updates
it by what it changed) exists for the workers' shared visited table (`solve/search/partition.ts`), where it is never the
authority: a worker's "already stored" the exact keys do not confirm is expanded again. The flat columns are also what
the checkpoint writes (`solve/search/checkpoint.ts`). `representation: 'objects'` keeps the 4.1.8 storage, for the
partial-order reduction (which expands a stored state again) and as the reference of the differential tests.

**Checked.** `tests/solver-oracle.test.ts`: the sample game, the reference game and 200 generated games give, with the
compact store, the verdict, path, session entries, softlocks, causes and reachable set (state for state) that the
4.1.8 implementation wrote in `tests/fixtures/solver-oracle.json`. `tests/compact.test.ts`: compact against objects,
field for field.

**Cost.** Decoding a stored state's dimensions (the profile, the `reachable` list) and a path (the witness, the softlock
samples) costs a walk and a parse; both happen once, at the end. A checkpoint of a large search is a large file.

**Would change it.** A proof whose frontier, not its stored states, fills the heap (the frontier keeps engine states);
then the frontier's states would be stored as deltas against their parent.
