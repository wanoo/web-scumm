import { Pane } from 'tweakpane';
import type { App } from '../dom/app';
import type { Value } from '../core/types';
import { describeEvent } from '../core/journal';

/** Debug panel (?dev): checkpoints, rooms, inventory, flags, map, the world's characters and scripts. */
export class DevPanel {
  private pane!: Pane;
  private info = { room: '', busy: false };
  /** On a phone screen, the panel starts collapsed and sits on the left, above the scene:
   *  the verb bar and the inventory (on the right) stay tappable at all times. */
  private small = Math.min(innerWidth, innerHeight) < 600;
  private expanded = !this.small;

  constructor(
    private app: App,
    private onRoomChange: () => void,
  ) {
    this.build();
    setInterval(() => {
      const room = this.app.engine.state?.room ?? '';
      const busy = this.app.engine.busy;
      if (room !== this.info.room) {
        this.info.room = room;
        this.onRoomChange();
        this.build();
      }
      if (busy !== this.info.busy) {
        this.info.busy = busy;
        this.pane.refresh();
      }
    }, 400);
  }

  private get eng() {
    return this.app.engine;
  }

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
    pane.on('fold', (ev) => {
      this.expanded = ev.expanded;
    });
    const box = pane.element.parentElement as HTMLElement;
    box.style.zIndex = '9000';
    box.style.pointerEvents = 'none';
    pane.element.style.pointerEvents = 'auto';
    if (this.small)
      Object.assign(box.style, {
        left: '4px',
        right: 'auto',
        top: '4px',
        width: '190px',
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
        opacity: '.9',
      });
    this.pane = pane;
    const eng = this.eng;
    const game = eng.game;
    this.info.room = eng.state?.room ?? '';
    pane.addBinding(this.info, 'room', { readonly: true });
    pane.addBinding(this.info, 'busy', { readonly: true });
    pane.addButton({ title: 'Edit this room' }).on('click', () => {
      location.search = `?edit=${eng.state.room}`;
    });

    const cp = pane.addFolder({ title: 'Checkpoints' });
    for (const id of Object.keys(game.checkpoints ?? {}))
      cp.addButton({ title: id }).on('click', () => void this.run(() => eng.checkpoint(id)));
    cp.addButton({ title: 'New game' }).on('click', () => {
      void eng.store.clear().then(() => eng.newGame());
      setTimeout(() => this.build(), 300);
    });

    const rooms = pane.addFolder({ title: 'Rooms', expanded: false });
    for (const r of game.rooms)
      rooms.addButton({ title: `→ ${r.id}` }).on('click', () => void this.run(() => eng.teleport(r.id)));

    if (!eng.state) return;
    const inv = pane.addFolder({ title: 'Inventory', expanded: false });
    const has: Record<string, boolean> = Object.fromEntries(
      Object.keys(game.items).map((i) => [i, eng.state.inventory.includes(i)]),
    );
    for (const id of Object.keys(game.items)) {
      inv
        .addBinding(has, id)
        .on('change', (ev) => void this.run(() => eng.script([ev.value ? { gain: id } : { lose: id }])));
    }

    const fl = pane.addFolder({ title: 'Flags', expanded: false });
    const flags = eng.state.flags;
    for (const k of Object.keys(flags))
      fl.addBinding(flags, k).on('change', () => {
        eng.save();
        this.app.view.refreshVisibility();
      });
    const nf = { name: '', value: 'true' };
    fl.addBinding(nf, 'name');
    fl.addBinding(nf, 'value');
    fl.addButton({ title: 'Set the flag' }).on('click', () => {
      if (!nf.name) return;
      const v: Value =
        nf.value === 'true'
          ? true
          : nf.value === 'false'
            ? false
            : isNaN(Number(nf.value))
              ? nf.value
              : Number(nf.value);
      void this.run(() => eng.script([{ set: [nf.name, v] }]));
    });

    if (game.players) {
      const pf = pane.addFolder({ title: 'Players', expanded: false });
      for (const pid of eng.playerIds()) {
        const p = eng.state.players?.[pid];
        pf.addButton({
          title: `${pid === eng.heroId() ? '▶ ' : ''}${pid}${p ? ` (${p.room}, ${p.inventory.length} items)` : ''}`,
        }).on('click', () => void this.run(() => eng.switchTo(pid)));
      }
    }
    const where = eng.state.where ?? {};
    if (Object.keys(where).length) {
      const wf = pane.addFolder({ title: 'World', expanded: false });
      for (const [ch, rid] of Object.entries(where)) {
        const row = { room: rid };
        wf.addBinding(row, 'room', { label: ch, options: Object.fromEntries(game.rooms.map((r) => [r.id, r.id])) }).on(
          'change',
          (ev) => void this.run(() => eng.script([{ moveActor: [ch, ev.value] }])),
        );
      }
    }

    const scripts = eng.scriptsHere();
    if (scripts.length) {
      const sf = pane.addFolder({ title: 'Scripts', expanded: false });
      for (const sc of scripts) {
        const st = eng.scriptState(sc.id);
        const row = { at: `${st.off ? 'stopped' : st.done ? 'done' : `${st.pc}/${sc.do.length}`}` };
        sf.addBinding(row, 'at', { label: sc.id, readonly: true });
        if (eng.autoScripts)
          sf.addButton({ title: st.off || st.done ? `▶ ${sc.id}` : `■ ${sc.id}` }).on(
            'click',
            () => void this.run(() => eng.script([st.off || st.done ? { startScript: sc.id } : { stopScript: sc.id }])),
          );
        else
          sf.addButton({ title: `step ${sc.id}` }).on(
            'click',
            () => void this.run(() => eng.advance(sc.id).then(() => undefined)),
          );
      }
    }

    if (eng.trace.length || eng.session?.log.length) {
      const jf = pane.addFolder({ title: 'Journal', expanded: false });
      for (const x of eng.trace.slice(-10).reverse()) {
        const row = { line: x.text };
        jf.addBinding(row, 'line', { label: x.kind, readonly: true });
      }
      jf.addButton({ title: `Export session (${eng.session?.log.length ?? 0} inputs)` }).on(
        'click',
        () =>
          void import('../tools/replay').then(({ sessionFile }) => {
            const blob = new Blob([JSON.stringify(sessionFile(game.id, eng), null, 1)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${game.id}-session.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          }),
      );
    }

    // A speedrun (4.1.14): the clock's readings, and the sealed .wsrun once the finish fired.
    const run = this.app.speedrun;
    if (run) {
      const sf = pane.addFolder({ title: `Speedrun ${run.category.name}`, expanded: false });
      sf.addBinding({ clock: run.text() }, 'clock', { label: 'time', readonly: true });
      sf.addBinding({ steps: String(eng.runClock.logicalSteps()) }, 'steps', { label: 'steps', readonly: true });
      if (run.envelope) sf.addButton({ title: 'Export run (.wsrun)' }).on('click', () => void run.exportRun());
    }

    // The semantic journal (4.1.11): what the core says happened, in ids, latest first.
    const events = eng.journal.since(eng.sessionSeq).slice(-12).reverse();
    if (events.length) {
      const sj = pane.addFolder({ title: `Semantic journal (${eng.journal.seq - eng.sessionSeq})`, expanded: false });
      for (const e of events)
        sj.addBinding({ line: describeEvent(e) }, 'line', { label: `${e.seq} ${e.kind}`, readonly: true });
    }

    if (game.map) {
      const mp = pane.addFolder({ title: 'Map', expanded: false });
      const un: Record<string, boolean> = Object.fromEntries(
        Object.keys(game.map.places).map((p) => [p, eng.state.unlocked.includes(p)]),
      );
      for (const p of Object.keys(game.map.places)) {
        mp.addBinding(un, p).on('change', (ev) => {
          eng.state.unlocked = ev.value
            ? [...new Set([...eng.state.unlocked, p])]
            : eng.state.unlocked.filter((x) => x !== p);
          eng.save();
        });
      }
      mp.addButton({ title: 'Unlock all' }).on(
        'click',
        () =>
          void this.run(() => {
            eng.state.unlocked = Object.keys(game.map!.places);
          }),
      );
    }
  }
}
