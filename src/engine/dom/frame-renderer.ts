// A painter as a `Renderer` (4.1.11, ADR 0011): the DOM or Canvas painter (`SceneRenderer`, dom/renderer.ts) given
// whole scene frames. A frame equal to the last (its hash) is skipped; a new room is painted whole (the painter's
// reset, its stage, every sprite in arrival order, the camera); a frame of the same room paints only what changed.
// Between frames, the room view hands it one changed sprite or stage (`sprite`, `stage`): a frame's part, at once.
// The DOM and Canvas painters own no input: the player's intentions come from the input layer (dom/input.ts), so
// nothing here calls the intent listeners; a renderer with an input of its own would.
import type { Id } from '../core/types';
import { type Intent, type Renderer, type SceneFrame, spritesOfFrame, stageOfFrame } from '../scene/frame';
import type { SceneRenderer, SpriteSpec, StageSpec } from './renderer';

export class PainterRenderer implements Renderer {
  private last: SceneFrame | null = null;
  private painted = new Map<Id, string>();
  private staged = '';
  private whole = true;
  private listeners: ((i: Intent) => void)[] = [];

  constructor(public painter: SceneRenderer) {}

  mount(root: HTMLElement) {
    if (this.painter.el.parentElement !== root) root.prepend(this.painter.el);
  }

  render(f: SceneFrame) {
    if (!this.whole && this.last?.hash === f.hash) return;
    const st = stageOfFrame(f);
    if (this.whole || this.last?.room !== f.room) {
      this.painter.reset(st.backdrop.url, f.camera.width);
      this.painted.clear();
      this.staged = '';
    }
    this.stage(st);
    for (const s of spritesOfFrame(f)) if (this.painted.get(s.id) !== JSON.stringify(s)) this.sprite(s);
    this.painter.camera(f.camera.x, f.camera.width, f.camera.y, f.camera.zoom);
    this.last = f;
    this.whole = false;
  }

  /** One sprite of the current frame changed: painted now. */
  sprite(s: SpriteSpec) {
    this.painter.sprite(s);
    this.painted.set(s.id, JSON.stringify(s));
  }

  /** The stage of the current frame changed (a condition shows a layer): given again only when it differs. */
  stage(st: StageSpec) {
    const sig = JSON.stringify(st);
    if (sig === this.staged) return;
    this.staged = sig;
    this.painter.stage(st);
  }

  /** The next frame is painted whole (a room built again, even the same one). */
  invalidate() {
    this.whole = true;
  }

  /** Another painter for the next rooms (`RoomDef.renderer`): the old one is disposed, the next frame painted whole. */
  swap(next: SceneRenderer) {
    this.painter.dispose();
    this.painter = next;
    this.invalidate();
  }

  onIntent(f: (i: Intent) => void) {
    this.listeners.push(f);
  }

  unmount() {
    this.painter.dispose();
    this.listeners = [];
    this.last = null;
    this.invalidate();
  }
}
