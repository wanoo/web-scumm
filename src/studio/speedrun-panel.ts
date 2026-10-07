// The Play tab's speedrun panel (4.1.14 "Time Attack"): for a game that declares `speedrun`, its categories and their
// rules, the splits with an editor (name, trigger, parent; written back to the game with `set_value` on `@game`), a
// preview of the splits on the session being played in the frame (replayed with the run's tape: the times a run would
// record), routes exported and imported as `.wsroute` (the solver's witness as a logical route, never a record), two
// routes compared, and the attempt's `.wsrun` exported once sealed.
import type { Engine } from '@engine/core/engine';
import { canonicalJson } from '@engine/core/canonical';
import { SEMANTIC_KINDS } from '@engine/core/journal';
import type { GameDef, Layout, SessionEntry, SpeedrunManifest, SpeedrunSplit } from '@engine/core/types';
import { replayRun } from '@engine/tools/speedrun/replay-run';
import {
  compareRoutes,
  exportRoute,
  parseRoute,
  routeFromRun,
  routeFromWitness,
  type SpeedrunRoute,
} from '@engine/tools/speedrun/routes';
import { formatDelta, formatTime, rankedTime, type RecordedSplit } from '@engine/tools/speedrun/splits';
import { describeTrigger } from '@engine/tools/speedrun/triggers';
import { h, select, toast, download } from './ui';

/** What the panel reads of the game in the frame (`window.__game`). */
export interface SpeedrunFrame {
  engine: Engine;
  game: GameDef;
  layouts?: Record<string, Layout>;
  speedrun?: { envelope: unknown | null; exportRun(): Promise<boolean> } | null;
}

export interface SpeedrunPanelOptions {
  /** Writes the edited manifest into the game's sources (the dev server's `set_value` on `@game`); absent: copy only. */
  write?: (manifest: SpeedrunManifest) => Promise<unknown>;
  /** The solver's witness from New Game (the logical route). */
  witness?: () => Promise<SessionEntry[]>;
}

export class SpeedrunPanel {
  readonly el = h('div', { class: 'panel speedrun', hidden: true });
  /** The manifest being edited (a copy of the game's). */
  manifest: SpeedrunManifest | null = null;
  categoryId = '';
  private shown = '';
  /** The last preview: the category's splits replayed on the frame's session. */
  preview: { splits: RecordedSplit[]; finish: string | null } | null = null;
  /** Routes loaded for comparison. */
  routes: SpeedrunRoute[] = [];

  constructor(
    private frame: () => SpeedrunFrame | null,
    private o: SpeedrunPanelOptions = {},
  ) {}

  /** Called on the Play tab's refresh: draws once per game. */
  refresh(): void {
    const g = this.frame();
    const m = g?.game.speedrun;
    this.el.hidden = !m;
    if (!g || !m) return;
    const key = `${g.game.id}:${m.rulesVersion}`;
    if (this.shown === key) return;
    this.shown = key;
    this.manifest = structuredClone(m) as SpeedrunManifest;
    this.categoryId ||= m.categories[0]?.id ?? '';
    this.draw();
  }

  private get category() {
    return this.manifest?.categories.find((c) => c.id === this.categoryId);
  }

  draw(): void {
    const m = this.manifest;
    if (!m) return;
    const c = this.category;
    const rules = c
      ? [
          `timed on ${c.timing}`,
          `reload ${c.reload}`,
          c.allowSaves ? 'saves' : 'no saves',
          c.allowPauses ? 'pauses' : 'no pauses',
          c.allowHints ? 'hints' : 'no hints',
          `reality ${c.realityPolicy}`,
          `seed ${c.seed ?? 'random'}`,
          `must match ${c.fingerprint.join(', ')}`,
        ].join(' · ')
      : '';
    const kinds = SEMANTIC_KINDS.map((k) => [k, k] as [string, string]);
    const splitRow = (s: SpeedrunSplit, i: number) => {
      const p = this.preview?.splits.find((x) => x.id === s.id);
      return h(
        'tr',
        { class: 'split' },
        h('td', null, s.parent ? `↳ ${s.id}` : s.id),
        h(
          'td',
          null,
          h('input', {
            value: s.name,
            'aria-label': `name of ${s.id}`,
            oninput: (e: Event) => this.edit(i, { name: (e.target as HTMLInputElement).value }),
          }),
        ),
        h(
          'td',
          null,
          select(
            kinds,
            s.at.event,
            (v) => this.edit(i, { at: { ...s.at, event: v as SpeedrunSplit['at']['event'] } }),
            { 'aria-label': `event of ${s.id}` },
          ),
          ' ',
          describeTrigger(s.at),
        ),
        h('td', { class: 'time' }, p && c ? formatTime(rankedTime(c, p)) : ''),
      );
    };
    this.el.replaceChildren(
      h('h3', null, 'Speedrun ', h('span', { class: 'muted small' }, `rules v${m.rulesVersion}`)),
      h(
        'div',
        { class: 'bar small' },
        'Category ',
        select(
          m.categories.map((x) => [x.id, x.name]),
          this.categoryId,
          (v) => {
            this.categoryId = v;
            this.preview = null;
            this.draw();
          },
          { 'aria-label': 'category' },
        ),
      ),
      h('p', { class: 'muted small rules' }, rules),
      h(
        'table',
        { class: 'splits' },
        h(
          'tr',
          null,
          h('th', null, 'split'),
          h('th', null, 'name'),
          h('th', null, 'trigger'),
          h('th', null, 'preview'),
        ),
        m.splits.map(splitRow),
      ),
      h(
        'div',
        { class: 'bar small' },
        h('button', { onclick: () => this.addSplit() }, '+ split'),
        h('button', { onclick: () => void this.runPreview() }, 'Preview on this session'),
        this.o.write ? h('button', { onclick: () => void this.save() }, 'Write to the game') : '',
        h('button', { onclick: () => void navigator.clipboard?.writeText(canonicalJson(this.manifest)) }, 'Copy'),
      ),
      h(
        'div',
        { class: 'bar small' },
        h('button', { onclick: () => this.exportRoute() }, 'Export route'),
        h('button', { onclick: () => this.importRoute() }, 'Import route'),
        this.o.witness ? h('button', { onclick: () => void this.loadWitness() }, 'Logical route (solver)') : '',
        h('button', { onclick: () => void this.exportRun() }, 'Export run (.wsrun)'),
      ),
      this.comparison(),
    );
  }

  /** Changes a split (the editor). */
  edit(i: number, patch: Partial<SpeedrunSplit>): void {
    if (!this.manifest) return;
    const splits = [...this.manifest.splits];
    splits[i] = { ...splits[i]!, ...patch };
    this.manifest = { ...this.manifest, splits };
  }

  /** Adds a split at the end, on the ending (the author changes its trigger). */
  addSplit(): void {
    if (!this.manifest) return;
    const n = this.manifest.splits.length + 1;
    this.manifest = {
      ...this.manifest,
      splits: [...this.manifest.splits, { id: `split-${n}`, name: `Split ${n}`, at: { event: 'endingReached' } }],
    };
    this.draw();
  }

  private async save() {
    if (!this.manifest || !this.o.write) return;
    try {
      await this.o.write(this.manifest);
      toast('Speedrun manifest written to the game');
    } catch (e) {
      toast(String((e as Error).message), 'error');
    }
  }

  /** The session played in the frame, from its new game: the inputs a route or a preview replays. */
  private steps(): SessionEntry[] | null {
    const s = this.frame()?.engine.session;
    return s && s.start.kind === 'new' ? structuredClone(s.log) : null;
  }

  /** Replays the frame's session with the category's splits (what a run of it would record). */
  async runPreview(): Promise<void> {
    const g = this.frame();
    const c = this.category;
    const steps = this.steps();
    if (!g || !c || !steps || !this.manifest) {
      toast('Start a new game in the frame first: a preview replays its session', 'info');
      return;
    }
    const game = { ...g.game, speedrun: this.manifest };
    const r = await replayRun(game, g.layouts ?? g.engine.layouts, steps, { category: c });
    this.preview = { splits: r.tracker?.splits ?? [], finish: r.tracker?.finish?.logicalTime ?? null };
    this.draw();
  }

  private exportRoute() {
    const g = this.frame();
    const steps = this.steps();
    if (!g || !steps) return toast('Start a new game in the frame first', 'info');
    const r = routeFromRun({
      gameId: g.game.id,
      categoryId: this.categoryId,
      name: 'Studio route',
      steps,
      ...(this.preview ? { splits: this.preview.splits } : {}),
    });
    download(`${g.game.id}.wsroute`, exportRoute(r), 'application/json');
  }

  private importRoute() {
    const inp = h('input', { type: 'file', accept: '.wsroute,application/json' }) as HTMLInputElement;
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        this.addRoute(parseRoute(await f.text()));
      } catch (e) {
        toast(String((e as Error).message), 'error');
      }
    };
    inp.click();
  }

  /** Adds a route to compare (the last two are compared). */
  addRoute(r: SpeedrunRoute): void {
    this.routes = [...this.routes, r].slice(-2);
    this.draw();
  }

  private async loadWitness() {
    const g = this.frame();
    if (!g || !this.o.witness) return;
    this.addRoute(routeFromWitness(g.game.id, await this.o.witness()));
  }

  private comparison(): HTMLElement | string {
    if (this.routes.length < 2)
      return this.routes.length ? h('p', { class: 'muted small' }, `1 route loaded: ${this.routes[0]!.name}`) : '';
    const [a, b] = this.routes as [SpeedrunRoute, SpeedrunRoute];
    const cmp = compareRoutes(a, b);
    return h(
      'div',
      { class: 'compare small' },
      h(
        'p',
        null,
        `${a.name} (${a.kind}) vs ${b.name} (${b.kind}): ${cmp.steps[0]} vs ${cmp.steps[1]} inputs, first difference at ${cmp.firstDifference ?? '—'}`,
      ),
      cmp.splits.map((s) => h('div', null, `${s.id}: ${formatDelta(s.delta === null ? null : BigInt(s.delta))}`)),
      a.kind === 'logical' || b.kind === 'logical'
        ? h('p', { class: 'muted' }, 'A logical route comes from the solver: never a record.')
        : '',
    );
  }

  private async exportRun() {
    const run = this.frame()?.speedrun;
    if (!run?.envelope) return toast('No sealed run in the frame: finish an attempt (pause menu › Speedrun)', 'info');
    await run.exportRun();
  }
}
