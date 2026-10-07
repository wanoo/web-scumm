# 0013 · One intermediate representation of a game (GameIR) and its fingerprint (4.1.12)

**Context.** Until 4.1.11 a game existed in two forms: its sources (`GameSource`, a `GameDef`) and the frozen object
`compileGame` returns (`CompiledGame`). The runtime, the solver, the replay, the validator, the Studio and the docs
each read `CompiledGame` field by field, and nothing said which fields are the game's logic and which only its looks.
The programme's next lots need that line drawn: 4.1.14 (Time Attack) must tell whether two runs played the *same game*
(the same rules, possibly another decor), 4.1.15 (Remix) must extend the world without rewriting the compiled form,
and the Studio must show where an id comes from. A hash of the sources (`tools/proof-cache.ts`, `gameSourceHash`) is
Node-only, moves with a comment, and cannot tell a rule from a picture.

**Decision.** Three contracts, in `src/engine/core/`.

- `canonicalJson(v)` (`core/canonical.ts`): one text per value, the same in Node, Chromium, WebKit and Firefox. Strings
  and keys in Unicode NFC, keys sorted by UTF-16 code unit, `-0` written `0`, `NaN` and the infinities refused, an
  integer beyond 2^53 and a `bigint` written as a decimal string, `undefined` dropped from objects, a cycle, a function,
  a symbol or an object that is not plain (a `Date`, a `Map`) refused. `tools/proof-cache.ts` keys the solver's cache
  with it (`stableJson` writes functions as their source, then hands the data to it).
- `compileIR(compiled, { extensions })` (`core/ir.ts`): the **logic** of a compiled game as plain data, schema 1: its
  rooms (names, hotspot and exit ids, looks, hints, walk links' conditions), entities (props, actors, hotspots, items,
  characters: ids, names, kinds, states, visibility), rules (written reactions, topics, listeners, reactions by kind,
  fallback lines), scripts (world scripts, each room's arrival, the intro), objectives, the Reality policies (the
  signals and their fallbacks; the Bridge's address is deployment, left out), the world (hero, players, verbs, start,
  map, checkpoints, invariants, save version and migrations), the trusted extensions *by name* (custom commands with
  their declared `effects`, minigames, plugins) and `variant: { mode: 'story' }`, reserved for 4.1.15. Each id carries
  its provenance (`file`, `line`) when the sources are given (`provenanceOf`). Pure and deterministic: two compilations
  of one game give the same `canonicalJson`. Every field of `GameDef`, `RoomDef` and the entity types is classified
  `logic`, `presentation` or `meta` in one table (`core/ir-fields.ts`), checked by the compiler: a new field that
  says nothing does not compile, and a test reads the table against the IR.
- `fingerprint(ir, { presentation, engine })` (`core/fingerprint.ts`): `{ logic, trustedExtensions, presentation,
  engine }`, each a SHA-256 in hex over a canonical text, computed with WebCrypto (`crypto.subtle`, present in the
  browser and in Node 22), so `async` everywhere; no synchronous hash hides behind a polyfill. `logic` hashes the IR
  without its provenance (a comment added above a rule moves no line of logic) and without the extensions' hash;
  `trustedExtensions` is the hash of the extension sources (`hashSources`, given by the build: `sealBuild` writes it
  into the built `site.json` and the player receives it as `__TRUSTED_EXTENSIONS__`); `presentation` hashes
  `presentationOf(game, manifest)` (every `presentation` field: decors, stage layers and lights, sprites, icons, audio
  and voices, skin, interface texts, title and credits) with the asset manifest; `engine` hashes the engine version and
  `prngVersion`, reserved (0) until 4.1.14 fixes the random generator. The pause menu shows the short form.

**The runtime and the IR.** The sheet asked to choose at the opening between "the runtime consumes the IR" and
"`CompiledGame` derives from the IR", by the size of the diff. Measured on this branch (`grep -rhoE "\bgame\.[a-zA-Z]+"`):
641 reads of the game object in `src/engine` (core 171 in 19 files, dom 132 in 14, tools 300 in 20, the rest in dev,
ending and reality), plus the Studio's. Making the runtime read the IR rewrites those reads, and the IR would have to
carry the presentation the DOM reads (audio, skin, interface texts), which is exactly what the fingerprint keeps out
of `logic`. Making `CompiledGame` derive from the IR has the same flaw in the other direction (the IR is lossy by
design). The cheapest honest path, taken: **the IR is a projection of `CompiledGame`**, computed by a pure function,
read by the fingerprint, the Studio's IR view and forms, the generated DSL page and the tests; the runtime, the solver
and the replay keep `CompiledGame`. What makes that safe is the field table: every field the runtime can read is
classified, and `tests/ir.test.ts` checks that every `logic` field of the bundled games reaches the IR and no
`presentation` field does. It is said here so that 4.1.13 or 4.1.15 can revisit it with a measure.

**Cost.** One more pass over the game when a fingerprint is asked for (the pause menu computes it on demand, in a
chunk loaded then). Text is logic: a line's wording lives in its command, so fixing a typo moves `logic` (4.1.14
chooses per category which components a run must match; a text-free view can be added then, additively). The
fingerprint is computed on the game as written, before a translation is applied. Provenance is read from the sources'
object keys by a small scanner that skips strings and comments and knows which key or variable owns each object
(`core/source-keys.ts`): `id: '<id>'`, or the key under `items`, `characters`, `objectives`, `checkpoints`, or a
room's `props`, `actors`, `hotspots` and `exits` in that room's file. No TypeScript compiler in the core (it runs in
the browser too). An id written by a helper function, not literally, has none, and says so (`provenance` lacks it)
rather than pointing at a wrong line.

**Evidence.** `tests/canonical-json.test.ts` (50 edge values, the expected texts written out; `scripts/e2e-canonical.mjs`
compares the same 50 in Chromium, WebKit and Firefox, run by CI's e2e gate), `tests/ir.test.ts` (determinism on
`demo`, `reference`, `signals` and 50 generated games; the field table; provenance on the sample game),
`tests/fingerprint.test.ts` (a rule changed moves `logic` only, a decor `presentation` only, a custom command's code
`trustedExtensions` only; the Node and WebCrypto hashes agree).

**Would change it.** A lot that needs the runtime to run from a serialised IR (a game shipped without its TypeScript
sources, a remote solver): then `CompiledGame` derives from a lossless IR plus a presentation document, and the field
table is the map of that split.
