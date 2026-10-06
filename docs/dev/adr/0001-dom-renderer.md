# 0001 · The DOM is the reference renderer

**Context.** A point-and-click game is mostly still pictures, text, menus and a few moving sprites, played on phones.
Accessibility (screen readers, keyboard, text size) and crisp text matter more than thousands of sprites.

**Decision.** The room is painted with DOM elements (`src/engine/dom/render-dom.ts`), and every interface element
and accessible target stays in the DOM. A Canvas 2D painter (`src/engine/dom/render-canvas.ts`) is allowed beside
it for a room that asks for it (D10), loaded on demand since 4.1.0; both implement the same `SceneRenderer`
contract (`src/engine/dom/renderer.ts`) and are compared by the visual and e2e tests. WebGL, Phaser and a physics
engine are out.

**Cost.** Effects a GPU would make cheap need care; the frame loop of `dom/room.ts` is shared by both painters.

**Would change it.** An effect Canvas 2D measurably cannot hold at 30 FPS on the phones the project tests.
