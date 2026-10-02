// Check tab: the validator and the solver (run after every save), and a screenshot of a room at a checkpoint.
import { api, type GameInfo, type SolveData, type ValidateResult } from './api';
import { append, h, select, toast } from './ui';

export class CheckTab {
  readonly el = h('section', { class: 'tab check' });
  private v: ValidateResult | null = null;
  private s: SolveData | null = null;
  private err = '';
  private running = false;
  private from = '';
  private shotRoom: string;
  private shotCp = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private out = h('div', { class: 'checkout' });
  private shot = h('div', { class: 'shot' });
  private runBtn = h('button', { class: 'primary', onclick: () => void this.run() }, 'Run again');
  private stamp = h('span', { class: 'muted small' });

  constructor(private info: GameInfo, private badge: (state: 'ok' | 'warn' | 'error' | 'busy', text: string) => void) {
    this.shotRoom = info.rooms[0]?.id ?? '';
    const cps: [string, string][] = Object.entries(info.checkpoints).map(([k, c]) => [k, `${k} (${c.room})`]);
    const shotBtn = h('button', { onclick: () => void this.screenshot() }, 'Screenshot room at checkpoint');
    this.el.append(
      h('div', { class: 'bar' }, this.runBtn,
        h('label', null, 'Solve from ', select([['', 'New game'], ...cps], this.from, (x) => { this.from = x; void this.run(); }, { 'aria-label': 'Solve from' })),
        this.stamp),
      h('div', { class: 'checkgrid' }, this.out,
        h('div', { class: 'panel' }, h('h3', null, 'Screenshot'),
          h('div', { class: 'bar' },
            select(info.rooms.map((r) => [r.id, r.name]), this.shotRoom, (x) => { this.shotRoom = x; }, { 'aria-label': 'Room to screenshot' }),
            select([['', 'auto state'], ...cps], this.shotCp, (x) => { this.shotCp = x; }, { 'aria-label': 'Checkpoint' }),
            shotBtn),
          this.shot)));
    this.render();
  }

  /** Run soon (debounced): after every save. */
  schedule(ms = 700) { clearTimeout(this.timer); this.timer = setTimeout(() => void this.run(), ms); }

  async run() {
    if (this.running) { this.schedule(400); return; }
    this.running = true;
    this.runBtn.disabled = true;
    this.badge('busy', '…');
    try {
      this.err = '';
      this.v = await api.validate();
      this.s = await api.solve(this.from);
    } catch (e) {
      this.err = (e as Error).message;
    } finally {
      this.running = false;
      this.runBtn.disabled = false;
      this.stamp.textContent = `checked at ${new Date().toLocaleTimeString()}`;
      this.render();
    }
  }

  private render() {
    const { v, s } = this;
    if (this.err) this.badge('error', '!');
    else if (v && s) {
      const bad = v.errors.length + s.errors.length + (s.finished ? 0 : 1);
      this.badge(bad ? 'error' : v.warnings.length ? 'warn' : 'ok', bad ? String(bad) : v.warnings.length ? String(v.warnings.length) : '✔');
    }
    if (!v && !s && !this.err) { this.out.replaceChildren(h('p', { class: 'muted' }, 'Not run yet.')); return; }
    this.out.replaceChildren();
    append(this.out, [
      this.err ? h('p', { class: 'error' }, this.err) : null,
      ...(v ? [h('div', { class: 'panel' },
        h('h3', null, 'Validator ', h('span', { class: v.ok ? 'ok' : 'bad' }, v.ok ? '✔ no error' : `✖ ${v.errors.length} error(s)`),
          h('span', { class: 'muted small' }, ` ${v.warnings.length} warning(s) · ${v.ms} ms`)),
        v.errors.length ? h('ul', { class: 'msgs errors' }, v.errors.map((e) => h('li', null, e))) : null,
        v.warnings.length ? h('ul', { class: 'msgs warnings' }, v.warnings.map((e) => h('li', null, e))) : null)] : []),
      ...(s ? [h('div', { class: 'panel' },
        h('h3', null, 'Solver ', h('span', { class: s.finished ? 'ok' : 'bad' }, s.finished ? '✔ the game can be finished' : '✖ no ending reached'),
          h('span', { class: 'muted small' }, ` from ${s.from ?? 'a new game'} · ${s.states} states · ${s.ms} ms${s.truncated ? ' · limit reached' : ''}`)),
        s.errors.length ? h('ul', { class: 'msgs errors' }, s.errors.map((e) => h('li', null, e))) : null,
        h('ol', { class: 'path' }, s.path.map((p) => h('li', null, p))),
        h('dl', { class: 'facts' },
          h('dt', null, 'Rooms reached'), h('dd', null, s.roomsReached.join(', ') || '—'),
          h('dt', null, 'Unlocked'), h('dd', null, s.unlockedReached.join(', ') || '—'),
          s.itemsNeverUsed.length ? [h('dt', null, 'Items never used'), h('dd', null, s.itemsNeverUsed.join(', '))] : null,
          s.unusedItems.length ? [h('dt', null, 'Items never obtained'), h('dd', null, s.unusedItems.join(', '))] : null),
        s.deadEnds.length ? h('div', null, h('h4', null, `Dead ends (${s.deadEnds.length})`),
          h('ul', { class: 'msgs warnings' }, s.deadEnds.slice(0, 8).map((d) => h('li', null, `${d.room}, [${d.inventory.join(', ')}] after ${d.path.slice(-3).join(' › ') || 'the start'}`)))) : null)] : []),
    ]);
  }

  private async screenshot() {
    this.shot.replaceChildren(h('p', { class: 'muted' }, 'Rendering…'));
    try {
      const r = await api.screenshot(this.shotRoom, this.shotCp);
      this.shot.replaceChildren(h('img', { src: r.url, alt: `${this.shotRoom} screenshot` }), h('p', { class: 'muted small' }, r.file));
    } catch (e) {
      this.shot.replaceChildren(h('p', { class: 'error' }, (e as Error).message));
      toast((e as Error).message, 'error');
    }
  }
}
