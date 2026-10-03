import type { App } from '../dom/app';
import { Editor, type EditorOptions } from './editor';
import { Overlay } from './overlay';
import { DevPanel } from './panel';

/**
 * Development tools, loaded only by the dev server:
 * - `?dev`: zone overlay + panel (checkpoints, rooms, inventory, flags, map). Press D to hide the overlay.
 * - `?edit=<room>`: placement editor, which saves layout/<room>.json.
 * - `?at=<checkpoint>`: starts on a checkpoint.
 */
export async function startDev(app: App, o: { edit: string | null; checkpoint: string | null } & EditorOptions) {
  const eng = app.engine;
  const game = eng.game;

  if (o.edit) {
    if (!game.rooms.some((r) => r.id === o.edit)) throw new Error(`unknown room: ${o.edit}`);
    const cp = o.checkpoint ?? Object.entries(game.checkpoints ?? {}).find(([, c]) => c.room === o.edit)?.[0];
    if (cp) await eng.checkpoint(cp);
    if (!cp || eng.state.room !== o.edit) {
      // without a checkpoint: fresh state, without playing the room's arrival script
      if (!eng.state) eng.state = eng.fresh();
      await eng.enter(o.edit, undefined, false);
    }
    const ed = new Editor(app, { saveOffline: o.saveOffline });
    app.view.onCamera = (cam) => ed.overlay.pan(cam);
    window.addEventListener('resize', () => setTimeout(() => ed.overlay.draw(), 50));
    (window as unknown as { __editor: Editor }).__editor = ed;
    return;
  }

  const at = o.checkpoint ?? Object.keys(game.checkpoints ?? {})[0];
  if (at) await eng.checkpoint(at);
  else void eng.newGame(); // arrival may wait on a player action (tutorial): we don't wait

  const ov = new Overlay(app, { edit: false, all: false });
  app.view.onCamera = (cam) => ov.pan(cam);
  const redraw = () => setTimeout(() => ov.draw(), 60);
  new DevPanel(app, redraw);
  ov.draw();
  // The overlay follows changes (props, visibility) without hooking anything into the engine.
  const prev = eng.onChange;
  eng.onChange = () => { prev(); redraw(); };
  window.addEventListener('resize', redraw);

  const toggle = () => ov.setVisible(!ov.visible);
  window.addEventListener('keydown', (e) => { if (e.key === 'd' || e.key === 'D') toggle(); });
  const btn = document.createElement('button');
  btn.textContent = 'DEV';
  Object.assign(btn.style, { position: 'fixed', left: '4px', bottom: '4px', zIndex: '9001', font: '10px monospace', padding: '4px 6px', opacity: '.7' });
  btn.onclick = toggle;
  document.body.append(btn);
}
