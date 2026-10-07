# 0011 · A scene frame, intentions and a semantic journal (4.1.11)

**Context.** Until 4.1.10 the room view (`dom/room.ts`) decided and painted in one stroke, `App` was both the
Presenter and the place that rendered, a tap reached `engine.act` from wherever the input was read, and the engine said
"something changed" (`onChange()`) without saying what. A second painter (Canvas, D10) and the programme's next lots (the
speedrun splits of 4.1.14 read what happened; a renderer other than the DOM) need the picture, the input and the facts to
be separate contracts. Decision D21 (`docs/dev/DECISIONS.md`): rendering is not a source of state; an intention is the
only thing a renderer sends; the solver and the replay depend on no renderer.

**Decision.** Three contracts, and six properties settled.

- `SceneFrame` (`src/engine/scene/frame.ts`): an immutable picture of the room in logical units (640 × 400 per screen),
  made by a pure function `sceneFrame(state, layouts, anim)`: camera, layers, characters, targets with their hit
  polygons precomputed, effects, a hash. `Renderer` (`mount`, `render`, `onIntent`, `unmount`) draws frames; the DOM and
  Canvas painters are one through `dom/frame-renderer.ts`, `scene/null-renderer.ts` draws nothing.
- `Intent` (`act`, `walk`, `pick`, `skip`, `open`): what goes back, through the presenter's `intent()`
  (`dom/presenter.ts`); `scene/intent.ts` applies the engine's.
- `SemanticJournal` (`core/journal.ts`, `Engine.journal`): what happened, in ids, numbered; emitted by the command
  handlers, a room's entry and the engine's lifecycle, never by the DOM; the same on a replay.

The six properties:

1. **The render loop is the renderer's.** `requestAnimationFrame` lives in the room view and the painters; the engine
   knows no frame (it awaits the presenter's promises: a walk, a wait, a line).
2. **Screen ↔ scene is the renderer's.** The frame is in logical units; the camera (`dom/camera.ts`) converts.
3. **Presentation animations are the renderer's** (walk cycles, mouths, blinks, particles, fades), driven by the
   logical state and `core/timing.ts`; none of them writes the state.
4. **Intentions come from one input layer** (`dom/input.ts`, the shell's tools, the choice rows), all through the
   presenter's `intent()`. The DOM and Canvas painters own no input, so their `onIntent` listeners are never called; a
   renderer with an input of its own (the null one in tests, a future one) sends through them, and `App` wires them to
   the same `intent()`.
5. **Accessibility is the semantic DOM layer's**, synchronised from the frame's targets (`dom/shell.ts`
   `renderA11yTargets` reads `frame().hotspots`), whatever paints the room.
6. **Invalidation.** A frame is made from the state and what the presentation animates; a renderer skips a frame equal
   to the last by its hash. The full frame is made and painted when a room is built; between builds an entity that
   changes paints its own sprite, which is the frame's part that changed (painting a whole frame for every walk step
   would cost the phone what 4.1.5 saved).

**Cost.** One more indirection between a tap and the engine; a frame's hash is a JSON digest computed on each hit
test (cheap at a room's size, measured nowhere yet on a phone). The journal is bounded (10,000 events) and a session
file carries it only while its window still holds the whole session. A slot on `saveMade`/`loadMade` is not set: a
slot is not part of a session, so a replay could not reproduce it.

**Evidence.** `tests/dom/scene-frame.test.ts` (the DOM of every room of the sample game and the reference chapter, in
three states, and the taps on a grid, equal to before the frame), `tests/dom/intent-equivalence.test.ts` (the same
clicks on the DOM and Canvas painters, DPR 1/2/3, phone and desktop, reduced motion or not: the same session and
journal), `tests/journal.test.ts` (replay ⇒ the same journal on the sample game, the reference chapter and 200
generated games), `tests/boundaries.test.ts` (the scene imports only the core; a painter never the engine).

**Would change it.** A renderer that must own its input loop (a WebGL canvas with its own picking): its `onIntent`
becomes the input layer for it, the contract stays. A need for the full frame on every animation step (a recorder of
frames): the room view would then build a frame per tick, at a measured cost.
