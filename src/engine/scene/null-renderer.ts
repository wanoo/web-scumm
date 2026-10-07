// The null renderer (4.1.11, ADR 0012): it draws nothing. It keeps the frames it was given (an equal one, by its hash,
// is skipped, as any renderer may), and a test or a headless host plays through it by sending intentions.
import type { Intent, Renderer, SceneFrame } from './frame';

export class NullRenderer implements Renderer {
  /** The frames rendered, an unchanged one skipped. */
  readonly frames: SceneFrame[] = [];
  private listeners: ((i: Intent) => void)[] = [];
  mounted = false;

  mount(_root: unknown) {
    this.mounted = true;
  }
  render(frame: SceneFrame) {
    if (this.frames.at(-1)?.hash === frame.hash) return;
    this.frames.push(frame);
  }
  onIntent(f: (i: Intent) => void) {
    this.listeners.push(f);
  }
  /** What a player's input would say: given to every listener. */
  intend(i: Intent) {
    for (const f of this.listeners) f(i);
  }
  unmount() {
    this.mounted = false;
    this.listeners = [];
  }
}
