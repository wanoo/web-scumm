import { Pane } from 'tweakpane';
import type { App } from '../dom/app';
import type { Value } from '../core/types';

/** Debug panel (?dev): checkpoints, rooms, inventory, flags, map. */
export class DevPanel {
  private pane!: Pane;
  private info = { room: '', busy: false };
  /** On a phone screen, the panel starts collapsed and sits on the left, above the scene:
   *  the verb bar and the inventory (on the right) stay tappable at all times. */
  private small = Math.min(innerWidth, innerHeight) < 600;
  private expanded = !this.small;

  constructor(private app: App, private onRoomChange: () => void) {
    this.build();
    setInterval(() => {
      const room = this.app.engine.state?.room ?? '';
      const busy = this.app.engine.busy;
      if (room !== this.info.room) { this.info.room = room; this.onRoomChange(); this.build(); }
      if (busy !== this.info.busy) { this.info.busy = busy; this.pane.refresh(); }
    }, 400);
  }

  private get eng() { return this.app.engine; }

  private async run(fn: () => Promise<void> | void) {
    await fn();
    this.eng.save();
    this.app.view.refreshVisibility();
    this.onRoomChange();
    this.build();
  }

  build() {
    this.pane?.dispose();
    const pane = new Pane({ title: 'DEV', expanded: this.expanded });
    pane.on('fold', (ev) => { this.expanded = ev.expanded; });
    const box = pane.element.parentElement as HTMLElement;
    box.style.zIndex = '9000';
    box.style.pointerEvents = 'none';
    pane.element.style.pointerEvents = 'auto';
    if (this.small) Object.assign(box.style, { left: '4px', right: 'auto', top: '4px', width: '190px', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', opacity: '.9' });
    this.pane = pane;
    const eng = this.eng;
    const game = eng.game;
    this.info.room = eng.state?.room ?? '';
    pane.addBinding(this.info, 'room', { readonly: true });
    pane.addBinding(this.info, 'busy', { readonly: true });
    pane.addButton({ title: 'Edit this room' }).on('click', () => { location.search = `?edit=${eng.state.room}`; });

    const cp = pane.addFolder({ title: 'Checkpoints' });
    for (const id of Object.keys(game.checkpoints ?? {})) cp.addButton({ title: id }).on('click', () => void this.run(() => eng.checkpoint(id)));
    cp.addButton({ title: 'New game' }).on('click', () => { eng.store.clear(); void eng.newGame(); setTimeout(() => this.build(), 300); });

    const rooms = pane.addFolder({ title: 'Rooms', expanded: false });
    for (const r of game.rooms) rooms.addButton({ title: `→ ${r.id}` }).on('click', () => void this.run(() => eng.enter(r.id, undefined, false)));

    if (!eng.state) return;
    const inv = pane.addFolder({ title: 'Inventory', expanded: false });
    const has: Record<string, boolean> = Object.fromEntries(Object.keys(game.items).map((i) => [i, eng.state.inventory.includes(i)]));
    for (const id of Object.keys(game.items)) {
      inv.addBinding(has, id).on('change', (ev) => void this.run(() => eng.script([ev.value ? { gain: id } : { lose: id }])));
    }

    const fl = pane.addFolder({ title: 'Flags', expanded: false });
    const flags = eng.state.flags;
    for (const k of Object.keys(flags)) fl.addBinding(flags, k).on('change', () => { eng.save(); this.app.view.refreshVisibility(); });
    const nf = { name: '', value: 'true' };
    fl.addBinding(nf, 'name');
    fl.addBinding(nf, 'value');
    fl.addButton({ title: 'Set the flag' }).on('click', () => {
      if (!nf.name) return;
      const v: Value = nf.value === 'true' ? true : nf.value === 'false' ? false : isNaN(Number(nf.value)) ? nf.value : Number(nf.value);
      void this.run(() => eng.script([{ set: [nf.name, v] }]));
    });

    if (game.map) {
      const mp = pane.addFolder({ title: 'Map', expanded: false });
      const un: Record<string, boolean> = Object.fromEntries(Object.keys(game.map.places).map((p) => [p, eng.state.unlocked.includes(p)]));
      for (const p of Object.keys(game.map.places)) {
        mp.addBinding(un, p).on('change', (ev) => {
          eng.state.unlocked = ev.value ? [...new Set([...eng.state.unlocked, p])] : eng.state.unlocked.filter((x) => x !== p);
          eng.save();
        });
      }
      mp.addButton({ title: 'Unlock all' }).on('click', () => void this.run(() => { eng.state.unlocked = Object.keys(game.map!.places); }));
    }
  }
}
