// Storyboard tab: edits storyboard.json (boards, panels in play order, lines, sfx, arrival, hints, talks, reactions)
// in memory; Save writes the whole document (PUT storyboard). Beside the editor, the selected panel composed like a
// storyboard frame (room decor, speakers' portraits, the lines as the game shows them) and the notes about it.
import type { SbBoard, SbLine, SbPanel, SbReaction, SbTopic } from '../../tools/pages/storyboard-data';
import { api, imgUrl, type CoverageData, type GameInfo } from './api';
import type { BoardCoverage, Check, CoverStatus, PanelCoverage } from '@engine/tools/coverage';
import { composer, liveBlock, newestFirst, noteItem, type NotesStore } from './notes';
import { autoGrow, h, toast } from './ui';

type Doc = Record<string, unknown> & { title?: string; intro?: string; boards: SbBoard[] };

export interface StoryboardCtx {
  info: GameInfo;
  notes: NotesStore;
  ownWrite(): void;
  /** Switches to the Rooms tab on that room. */
  openRoom(id: string): void;
}

const STAGE = new Set(['action', 'stage']);

/** Lines in their canonical `{ who, text }` form (accepts `[who, text]` and bare strings, like the page generator). */
function fixLines(v: unknown): SbLine[] {
  return (Array.isArray(v) ? v : []).map((l: any) =>
    Array.isArray(l)
      ? { who: String(l[0]), text: String(l[1] ?? '') }
      : typeof l === 'string'
        ? { who: 'hero', text: l }
        : { ...l, who: String(l?.who ?? 'hero'), text: String(l?.text ?? '') },
  );
}

/** Light normalisation in place: lines, `talk` / talk lists, `optional`. Every other field is kept as it is. */
function normDoc(raw: any): Doc {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Doc;
  if (!Array.isArray(doc.boards)) doc.boards = [];
  for (const b of doc.boards as any[]) {
    if (!Array.isArray(b.panels)) b.panels = [];
    for (const p of b.panels) {
      if (p.lines !== undefined) p.lines = fixLines(p.lines);
      if (p.id === undefined) p.id = '';
      if (p.title === undefined) p.title = '';
    }
    if (b.arrival !== undefined) b.arrival = fixLines(b.arrival);
    if (b.talk !== undefined && b.talks === undefined) {
      b.talks = b.talk;
      delete b.talk;
    }
    if (Array.isArray(b.talks))
      b.talks = Object.fromEntries(b.talks.map((x: any) => [String(x.who ?? x.actor), x.topics ?? []]));
    if (b.talks && typeof b.talks === 'object') {
      for (const k of Object.keys(b.talks)) {
        b.talks[k] = (Array.isArray(b.talks[k]) ? b.talks[k] : []).map((t: any) => {
          const { q, answer, ...rest } = t ?? {};
          return { ...rest, topic: String(t?.topic ?? q ?? ''), lines: fixLines(t?.lines ?? answer ?? t?.do) };
        });
      }
    }
    if (b.optional !== undefined && b.reactions === undefined) {
      b.reactions = b.optional;
      delete b.optional;
    }
    if (Array.isArray(b.reactions))
      b.reactions = b.reactions.map((r: any) =>
        Array.isArray(r)
          ? { action: String(r[0] ?? ''), lines: r[1] ? [{ who: 'hero', text: String(r[1]) }] : [] }
          : { ...r, lines: fixLines(r.lines) },
      );
  }
  return doc;
}

function move<T>(list: T[], i: number, d: number): boolean {
  const j = i + d;
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}

export class StoryboardTab {
  readonly el = h('section', { class: 'tab sb' });
  private doc: Doc | null = null;
  private savedJson = '';
  private bi = 0;
  private pi = 0;
  private li = 0;
  private error = '';
  private focusKey = '';
  private banner = h('div', { class: 'sbbanner', hidden: true });
  private stateEl = h('span', { class: 'sbstate' });
  private saveBtn = h(
    'button',
    { class: 'primary', onclick: () => void this.save(), title: 'Save storyboard.json (Ctrl/Cmd+S)' },
    'Save',
  );
  private listEl = h('nav', { class: 'sbboards', 'aria-label': 'Boards' });
  private editEl = h('div', { class: 'sbedit' });
  private previewEl = h('aside', { class: 'sbpreview', 'aria-label': 'Panel preview' });
  /** The saved storyboard checked against the content (badges on boards and panels). */
  private cov: CoverageData | null = null;
  private covEl = h('span', { class: 'muted small' });

  constructor(private ctx: StoryboardCtx) {
    this.el.append(
      h(
        'div',
        { class: 'bar sbbar' },
        this.saveBtn,
        this.stateEl,
        this.covEl,
        h(
          'button',
          {
            onclick: () => void this.exportMd(),
            title: 'Write games/<id>/storyboard.md from the saved storyboard.json',
          },
          'Export Markdown',
        ),
        h(
          'button',
          { onclick: () => void this.reload(), title: 'Read storyboard.json again (drops unsaved edits)' },
          api.mode === 'demo' ? 'Reload saved' : 'Reload from disk',
        ),
      ),
      this.banner,
      h('div', { class: 'sbgrid' }, this.listEl, this.editEl, this.previewEl),
    );
    addEventListener('beforeunload', (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  get dirty() {
    return !!this.doc && JSON.stringify(this.doc) !== this.savedJson;
  }

  /** Panels in play order: [id, title, board title] (for the Notes tab). */
  panels(): [string, string, string][] {
    return (this.doc?.boards ?? []).flatMap((b) =>
      b.panels.map((p) => [p.id, p.title, b.title] as [string, string, string]),
    );
  }

  /** First load (later calls keep the in-memory edits; use reload()). */
  async load() {
    if (!this.doc) await this.reload(true);
  }

  /** Checks the saved storyboard against the content; redraws the badges. */
  async refreshCoverage() {
    try {
      this.cov = await api.coverage();
      const c = this.cov.coverage;
      this.covEl.replaceChildren(
        h(
          'span',
          {
            class: `cov ${c.score >= 0.95 ? 'ok' : c.score >= 0.7 ? 'partial' : 'missing'}`,
            title: 'How much of the saved storyboard the game implements (Check tab for the detail)',
          },
          `${Math.round(c.score * 100)}%`,
        ),
        ` ${c.totals.ok} implemented · ${c.totals.partial} partial · ${c.totals.missing} missing`,
      );
    } catch {
      this.cov = null;
      this.covEl.replaceChildren();
    }
    if (this.doc) {
      this.renderList();
      this.renderEditor();
    }
  }

  private boardCov(id: string): BoardCoverage | undefined {
    return this.cov?.coverage.boards.find((b) => b.id === id);
  }
  private panelCov(id: string): PanelCoverage | undefined {
    return this.cov?.coverage.boards.flatMap((b) => b.panels).find((p) => p.id === id);
  }
  private badge(status: CoverStatus, title: string): HTMLElement {
    return h('span', { class: `cov ${status}`, title }, { ok: '✓', partial: '~', missing: '✗', unknown: '?' }[status]);
  }

  async reload(silent = false) {
    if (!silent && this.dirty && !confirm('Drop your unsaved storyboard edits and read storyboard.json again?')) return;
    void this.refreshCoverage();
    try {
      const raw = await api.storyboardRaw();
      this.savedJson = JSON.stringify(raw);
      this.doc = normDoc(raw);
      this.error = '';
      this.banner.hidden = true;
      this.bi = Math.min(this.bi, Math.max(0, this.doc.boards.length - 1));
      this.pi = Math.min(this.pi, Math.max(0, (this.board?.panels.length ?? 1) - 1));
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.renderAll();
  }

  /** storyboard.json changed on disk (not by us). */
  onDiskChange() {
    if (!this.doc) {
      void this.reload(true);
      return;
    }
    this.banner.hidden = false;
    this.banner.className = `sbbanner ${this.dirty ? 'warn' : 'info'}`;
    this.banner.replaceChildren(
      h(
        'span',
        null,
        this.dirty
          ? 'storyboard.json changed on disk while you have unsaved edits. Saving will overwrite that change; reloading drops your edits.'
          : 'storyboard.json changed on disk (an AI, an editor, git).',
      ),
      h(
        'button',
        { class: this.dirty ? '' : 'primary', onclick: () => void this.reload(true) },
        this.dirty ? 'Reload (drop my edits)' : 'Reload',
      ),
      h(
        'button',
        {
          class: 'icon',
          title: 'Dismiss',
          onclick: () => {
            this.banner.hidden = true;
          },
        },
        '✕',
      ),
    );
  }

  /** The selected panel as edited (the Assistant's context). */
  currentPanel(): { id: string; title?: string; board?: string; data: unknown } | undefined {
    const p = this.panel;
    return p ? { id: p.id, title: p.title, board: this.board?.title, data: p } : undefined;
  }

  /** Selects a panel by id (from the Notes tab). */
  showPanel(id: string) {
    const bi = this.doc?.boards.findIndex((b) => b.panels.some((p) => p.id === id)) ?? -1;
    if (bi < 0) return;
    this.bi = bi;
    this.pi = this.doc!.boards[bi].panels.findIndex((p) => p.id === id);
    this.li = 0;
    this.renderAll();
    requestAnimationFrame(() => this.editEl.querySelector('.card.on')?.scrollIntoView({ block: 'center' }));
  }

  async save() {
    if (!this.doc) return;
    const ids = this.doc.boards.flatMap((b) => b.panels.map((p) => p.id));
    const dup = ids.find((x, i) => ids.indexOf(x) !== i);
    if (dup) {
      toast(`Two panels have the id "${dup}": notes are attached to panel ids, make them unique.`, 'error');
      return;
    }
    if (ids.some((x) => !x.trim())) {
      toast('A panel has no id.', 'error');
      return;
    }
    try {
      this.saveBtn.disabled = true;
      this.ctx.ownWrite();
      const json = JSON.stringify(this.doc);
      const r = await api.setStoryboard(this.doc);
      this.savedJson = json;
      this.banner.hidden = true;
      toast(r.changed ? 'Storyboard saved' : 'Nothing to save');
      void this.refreshCoverage();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      this.saveBtn.disabled = false;
      this.updateState();
    }
  }

  private async exportMd() {
    if (this.dirty) {
      if (!confirm('The export reads the saved storyboard.json. Save your edits first?')) return;
      await this.save();
      if (this.dirty) return;
    }
    try {
      this.ctx.ownWrite();
      const r = await api.storyboardMarkdown();
      toast(
        `${api.mode === 'demo' ? 'Downloaded storyboard.md' : `Wrote ${r.file}`} · ${r.boards} boards, ${r.panels} panels`,
      );
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  // -------------------------------------------------------------- state

  private get board(): SbBoard | undefined {
    return this.doc?.boards[this.bi];
  }
  private get panel(): SbPanel | undefined {
    return this.board?.panels[this.pi];
  }

  private updateState() {
    const d = this.dirty;
    this.stateEl.textContent = !this.doc ? '' : d ? '● Unsaved changes' : '✔ Saved';
    this.stateEl.className = `sbstate ${d ? 'dirty' : 'clean'}`;
    this.saveBtn.disabled = !d;
  }

  /** After an edit. `structure`: lists changed (re-render the editor); otherwise only the state and the preview. */
  private changed(structure = false) {
    this.updateState();
    if (structure) {
      this.renderList();
      this.renderEditor();
    }
    this.renderPreview();
  }

  private renderAll() {
    this.updateState();
    if (this.error) {
      this.editEl.replaceChildren(h('p', { class: 'error pad' }, this.error));
      return;
    }
    this.renderList();
    this.renderEditor();
    this.renderPreview();
  }

  // -------------------------------------------------------------- boards

  private renderList() {
    const doc = this.doc;
    if (!doc) return;
    const rooms = this.ctx.info.rooms;
    this.listEl.replaceChildren(
      h('h3', null, 'Boards ', h('span', { class: 'muted' }, String(doc.boards.length))),
      h(
        'ol',
        null,
        doc.boards.map((b, i) => {
          const on = i === this.bi;
          return h(
            'li',
            { class: on ? 'on' : '' },
            h(
              'button',
              {
                class: 'bsel',
                'aria-current': on ? 'true' : undefined,
                onclick: () => {
                  this.bi = i;
                  this.pi = 0;
                  this.li = 0;
                  this.renderAll();
                },
              },
              h(
                'span',
                { class: 'btitle' },
                `${i + 1}. ${b.title || b.id}`,
                (() => {
                  const c = this.boardCov(b.id);
                  return c ? this.badge(c.status, `${Math.round(c.score * 100)}% of this board is in the game`) : null;
                })(),
              ),
              h(
                'span',
                { class: 'broom' },
                b.room ? (rooms.find((r) => r.id === b.room)?.name ?? b.room) : 'no room',
                ` · ${b.panels.length} panel(s)`,
              ),
              b.goal ? h('span', { class: 'bgoal' }, b.goal) : null,
            ),
            on
              ? h(
                  'span',
                  { class: 'bops' },
                  h(
                    'button',
                    {
                      class: 'icon',
                      title: 'Move up',
                      'aria-label': 'Move board up',
                      disabled: i === 0,
                      onclick: () => {
                        if (move(doc.boards, i, -1)) {
                          this.bi--;
                          this.changed(true);
                        }
                      },
                    },
                    '↑',
                  ),
                  h(
                    'button',
                    {
                      class: 'icon',
                      title: 'Move down',
                      'aria-label': 'Move board down',
                      disabled: i === doc.boards.length - 1,
                      onclick: () => {
                        if (move(doc.boards, i, 1)) {
                          this.bi++;
                          this.changed(true);
                        }
                      },
                    },
                    '↓',
                  ),
                  h(
                    'button',
                    {
                      class: 'icon del',
                      title: 'Delete board',
                      'aria-label': 'Delete board',
                      onclick: () => this.deleteBoard(i),
                    },
                    '✕',
                  ),
                )
              : null,
          );
        }),
      ),
      h('button', { class: 'add', onclick: () => this.addBoard() }, '+ Board'),
    );
  }

  private addBoard() {
    const doc = this.doc!;
    let n = doc.boards.length + 1;
    while (doc.boards.some((b) => b.id === `board-${n}`)) n++;
    doc.boards.push({ id: `board-${n}`, title: 'New board', room: this.ctx.info.rooms[0]?.id, goal: '', panels: [] });
    this.bi = doc.boards.length - 1;
    this.pi = 0;
    this.focusKey = 'board.title';
    this.changed(true);
  }

  private deleteBoard(i: number) {
    const b = this.doc!.boards[i];
    if (
      !confirm(
        `Delete the board "${b.title}" and its ${b.panels.length} panel(s)? (Nothing is written until you save.)`,
      )
    )
      return;
    this.doc!.boards.splice(i, 1);
    this.bi = Math.max(0, Math.min(this.bi, this.doc!.boards.length - 1));
    this.pi = 0;
    this.changed(true);
  }

  // -------------------------------------------------------------- inputs

  /** A text input bound to `obj[key]` (an empty optional field is removed). */
  private input(
    obj: any,
    key: string,
    opts: {
      placeholder?: string;
      label: string;
      area?: boolean;
      optional?: boolean;
      fk?: string;
      cls?: string;
      onInput?: () => void;
    },
  ) {
    const el = opts.area
      ? autoGrow(
          h('textarea', {
            rows: 1,
            value: obj[key] ?? '',
            placeholder: opts.placeholder,
            'aria-label': opts.label,
            class: opts.cls,
            dataset: { fk: opts.fk ?? '' },
          }),
        )
      : h('input', {
          type: 'text',
          value: obj[key] ?? '',
          placeholder: opts.placeholder,
          'aria-label': opts.label,
          class: opts.cls,
          dataset: { fk: opts.fk ?? '' },
        });
    el.addEventListener('input', () => {
      if (opts.optional && !el.value) delete obj[key];
      else obj[key] = el.value;
      opts.onInput?.();
      this.changed();
    });
    return el;
  }

  private speakerOptions(current: string): [string, string][] {
    const { characters, hero } = this.ctx.info;
    const opts: [string, string][] = [
      ['hero', `hero (${characters[hero]?.name ?? hero})`],
      ['action', 'action'],
      ['stage', 'stage'],
    ];
    for (const [id, c] of Object.entries(characters))
      if (id !== hero) opts.push([id, c.name === id ? id : `${c.name} (${id})`]);
    if (!opts.some(([v]) => v === current)) opts.push([current, `${current} (unknown)`]);
    return opts;
  }

  private colorOf(who: string): string | undefined {
    if (STAGE.has(who)) return undefined;
    return this.ctx.info.characters[who === 'hero' ? this.ctx.info.hero : who]?.color;
  }

  /** Editable list of lines at `owner[field]` (created on the first added line). */
  private lines(owner: any, field: string, fk: string, onLine?: (i: number) => void): HTMLElement {
    const list: SbLine[] = owner[field] ?? [];
    const box = h('div', { class: 'sblines' });
    list.forEach((l, i) => {
      const who = h(
        'select',
        { 'aria-label': `Speaker of line ${i + 1}`, class: 'who' },
        this.speakerOptions(l.who).map(([v, t]) => h('option', { value: v, selected: v === l.who }, t)),
      );
      const paint = () => {
        who.style.color = this.colorOf(l.who) ?? '';
        row.classList.toggle('stage', STAGE.has(l.who));
      };
      const text = autoGrow(
        h('textarea', {
          rows: 1,
          value: l.text,
          placeholder: STAGE.has(l.who) ? 'What happens…' : 'Line…',
          'aria-label': `Line ${i + 1}`,
          dataset: { fk: `${fk}.${i}` },
        }),
      );
      text.addEventListener('input', () => {
        l.text = text.value;
        this.changed();
      });
      text.addEventListener('focus', () => onLine?.(i));
      who.addEventListener('change', () => {
        l.who = who.value;
        paint();
        this.changed();
      });
      const row = h(
        'div',
        { class: 'sbline' },
        who,
        text,
        h(
          'span',
          { class: 'lops' },
          h(
            'button',
            {
              class: 'icon',
              title: 'Move up',
              'aria-label': `Move line ${i + 1} up`,
              disabled: i === 0,
              onclick: () => {
                move(list, i, -1);
                this.focusKey = `${fk}.${i - 1}`;
                this.changed(true);
              },
            },
            '↑',
          ),
          h(
            'button',
            {
              class: 'icon',
              title: 'Move down',
              'aria-label': `Move line ${i + 1} down`,
              disabled: i === list.length - 1,
              onclick: () => {
                move(list, i, 1);
                this.focusKey = `${fk}.${i + 1}`;
                this.changed(true);
              },
            },
            '↓',
          ),
          h(
            'button',
            {
              class: 'icon del',
              title: 'Delete line',
              'aria-label': `Delete line ${i + 1}`,
              onclick: () => {
                list.splice(i, 1);
                this.changed(true);
              },
            },
            '✕',
          ),
        ),
      );
      paint();
      box.append(row);
    });
    box.append(
      h(
        'button',
        {
          class: 'add small',
          onclick: () => {
            const arr: SbLine[] = (owner[field] ??= []);
            arr.push({ who: arr.at(-1)?.who ?? 'hero', text: '' });
            this.focusKey = `${fk}.${arr.length - 1}`;
            onLine?.(arr.length - 1);
            this.changed(true);
          },
        },
        '+ line',
      ),
    );
    return box;
  }

  // -------------------------------------------------------------- the board editor

  private renderEditor() {
    const scroll = this.editEl.scrollTop;
    const b = this.board;
    if (!b) {
      this.editEl.replaceChildren(h('p', { class: 'muted pad' }, 'No board yet: "+ Board" creates one.'));
      return;
    }
    const info = this.ctx.info;
    const roomSel = h(
      'select',
      { 'aria-label': 'Room' },
      h('option', { value: '', selected: !b.room }, '(no room)'),
      info.rooms.map((r) => h('option', { value: r.id, selected: r.id === b.room, title: r.id }, r.name)),
      b.room && !info.rooms.some((r) => r.id === b.room)
        ? h('option', { value: b.room, selected: true }, `${b.room} (unknown)`)
        : null,
    );
    roomSel.addEventListener('change', () => {
      if (roomSel.value) b.room = roomSel.value;
      else delete b.room;
      this.renderList();
      this.changed();
    });

    const head = h(
      'div',
      { class: 'panel sbhead' },
      h(
        'div',
        { class: 'sbfields' },
        h(
          'label',
          { class: 'field wide' },
          h('span', null, 'Board title'),
          this.input(b, 'title', { label: 'Board title', fk: 'board.title', onInput: () => this.renderList() }),
        ),
        h('label', { class: 'field' }, h('span', null, 'Id'), this.input(b, 'id', { label: 'Board id' })),
        h(
          'label',
          { class: 'field' },
          h('span', null, 'Room'),
          h(
            'div',
            { class: 'inrow' },
            roomSel,
            h(
              'button',
              {
                class: 'small',
                title: 'Open this room in the Rooms tab',
                disabled: !b.room,
                onclick: () => b.room && this.ctx.openRoom(b.room),
              },
              'Open in Rooms',
            ),
          ),
        ),
        h(
          'label',
          { class: 'field wide' },
          h('span', null, 'Goal'),
          this.input(b, 'goal', {
            label: 'Goal',
            area: true,
            optional: true,
            placeholder: 'What the player has to do here',
            onInput: () => this.renderList(),
          }),
        ),
        h(
          'label',
          { class: 'field wide' },
          h('span', null, 'Exit'),
          this.input(b, 'exit', { label: 'Exit', optional: true, placeholder: 'How the board ends (optional)' }),
        ),
      ),
    );

    const section = (title: string, count: number, open: boolean, ...body: (HTMLElement | null)[]) =>
      h(
        'details',
        { class: 'sbsec', open: open || undefined },
        h('summary', null, h('h3', null, title, ' ', h('span', { class: 'muted' }, String(count)))),
        ...body,
      );

    const arrival = section(
      'On arrival',
      b.arrival?.length ?? 0,
      !!b.arrival?.length,
      h('p', { class: 'muted small' }, 'Lines said on entering the room the first time.'),
      this.lines(b, 'arrival', 'arrival'),
    );

    const cards = b.panels.map((p, i) => this.card(b, p, i));
    const panels = h(
      'section',
      { class: 'sbpanels' },
      h('h3', null, 'Panels ', h('span', { class: 'muted' }, `${b.panels.length} · in play order`)),
      cards,
      h('button', { class: 'add', onclick: () => this.addPanel(b) }, '+ Panel'),
    );

    const hints = section(
      'Hints',
      b.hints?.length ?? 0,
      !!b.hints?.length,
      h('p', { class: 'muted small' }, 'From vague to precise: the first one whose step is not done yet is given.'),
      this.hints(b),
    );
    const talks = section(
      'Talk topics',
      Object.values(b.talks ?? {}).reduce((n, t) => n + t.length, 0),
      !!b.talks && Object.keys(b.talks).length > 0,
      this.talks(b),
    );
    const reactions = section(
      'Reactions',
      b.reactions?.length ?? 0,
      !!b.reactions?.length,
      h('p', { class: 'muted small' }, 'Optional: not needed to finish the game.'),
      this.reactions(b),
    );

    this.editEl.replaceChildren(head, arrival, panels, hints, talks, reactions);
    this.editEl.scrollTop = scroll;
    if (this.focusKey) {
      const el = this.editEl.querySelector<HTMLElement>(`[data-fk="${CSS.escape(this.focusKey)}"]`);
      this.focusKey = '';
      el?.focus();
    }
  }

  private uniquePanelId(base: string): string {
    const ids = new Set(this.doc!.boards.flatMap((x) => x.panels.map((p) => p.id)));
    if (!ids.has(base)) return base;
    let n = 2;
    while (ids.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  }

  private addPanel(b: SbBoard) {
    const ids = new Set(this.doc!.boards.flatMap((x) => x.panels.map((p) => p.id)));
    let n = b.panels.length + 1;
    while (ids.has(`${b.id}-${n}`)) n++;
    b.panels.push({ id: `${b.id}-${n}`, title: '', lines: [] });
    this.pi = b.panels.length - 1;
    this.li = 0;
    this.focusKey = `p${this.pi}.title`;
    this.changed(true);
  }

  private card(b: SbBoard, p: SbPanel, i: number): HTMLElement {
    const on = i === this.pi;
    const select = (li?: number) => {
      if (this.pi !== i) {
        this.pi = i;
        this.editEl.querySelectorAll('.card').forEach((c, k) => c.classList.toggle('on', k === i));
      }
      if (li !== undefined) this.li = li;
      else if (this.pi !== i) this.li = 0;
      this.renderPreview();
    };
    const sfx = p.sfx ?? [];
    const known = this.ctx.info.sfx ?? [];
    const addSfx = h(
      'select',
      { 'aria-label': 'Add a sound effect', class: 'addsfx' },
      h('option', { value: '' }, '+ sfx'),
      known.filter((s) => !sfx.includes(s)).map((s) => h('option', { value: s }, s)),
    );
    addSfx.addEventListener('change', () => {
      if (!addSfx.value) return;
      (p.sfx ??= []).push(addSfx.value);
      this.changed(true);
    });
    const idIn = this.input(p, 'id', { label: `Panel ${i + 1} id`, cls: 'pid', onInput: () => this.renderPreview() });
    const pc = this.panelCov(p.id);
    const notOk = (list: Check[]) => list.filter((x) => x.status === 'partial' || x.status === 'missing');
    const issues = pc ? notOk([...(pc.action ? [pc.action] : []), ...pc.lines, ...pc.sfx]) : [];
    const card = h(
      'article',
      { class: `card${on ? ' on' : ''}`, onfocusin: () => select(), onclick: () => select() },
      h(
        'header',
        null,
        h('span', { class: 'num' }, String(i + 1)),
        pc
          ? this.badge(
              pc.status,
              pc.status === 'ok'
                ? 'Everything in this panel is in the game'
                : `${Math.round(pc.score * 100)}% of this panel is in the game (saved version)`,
            )
          : null,
        this.input(p, 'title', {
          label: `Panel ${i + 1} title`,
          placeholder: 'Panel title',
          cls: 'ptitle',
          fk: `p${i}.title`,
        }),
        idIn,
        h(
          'span',
          { class: 'cops' },
          h(
            'button',
            {
              class: 'icon',
              title: 'Move panel up',
              'aria-label': `Move panel ${i + 1} up`,
              disabled: i === 0,
              onclick: (e: Event) => {
                e.stopPropagation();
                move(b.panels, i, -1);
                this.pi = i - 1;
                this.changed(true);
              },
            },
            '↑',
          ),
          h(
            'button',
            {
              class: 'icon',
              title: 'Move panel down',
              'aria-label': `Move panel ${i + 1} down`,
              disabled: i === b.panels.length - 1,
              onclick: (e: Event) => {
                e.stopPropagation();
                move(b.panels, i, 1);
                this.pi = i + 1;
                this.changed(true);
              },
            },
            '↓',
          ),
          h(
            'button',
            {
              class: 'icon',
              title: 'Duplicate panel',
              'aria-label': `Duplicate panel ${i + 1}`,
              onclick: (e: Event) => {
                e.stopPropagation();
                const copy: SbPanel = JSON.parse(JSON.stringify(p));
                copy.id = this.uniquePanelId(`${p.id}-copy`);
                copy.title = p.title ? `${p.title} (copy)` : '';
                b.panels.splice(i + 1, 0, copy);
                this.pi = i + 1;
                this.changed(true);
              },
            },
            '⧉',
          ),
          h(
            'button',
            {
              class: 'icon del',
              title: 'Delete panel',
              'aria-label': `Delete panel ${i + 1}`,
              onclick: (e: Event) => {
                e.stopPropagation();
                const n = this.ctx.notes.about(p.id).length;
                if (
                  !confirm(
                    `Delete panel ${p.id} "${p.title}"?${n ? ` Its ${n} note(s) stay in notes.json.` : ''} (Nothing is written until you save.)`,
                  )
                )
                  return;
                b.panels.splice(i, 1);
                this.pi = Math.max(0, Math.min(this.pi, b.panels.length - 1));
                this.changed(true);
              },
            },
            '✕',
          ),
        ),
      ),
      h(
        'label',
        { class: 'act' },
        h('span', null, 'Action'),
        this.input(p, 'action', {
          label: `Panel ${i + 1} action`,
          optional: true,
          placeholder: 'What the player does (empty: it just happens)',
        }),
      ),
      this.lines(p, 'lines', `p${i}`, (li) => select(li)),
      h(
        'div',
        { class: 'sfx' },
        h('span', { class: 'muted small' }, 'SFX'),
        sfx.map((s, k) =>
          h(
            'span',
            {
              class: `chipx${known.length && !known.includes(s) ? ' unknown' : ''}`,
              title: known.includes(s) ? s : `${s}: not in audio.sfx`,
            },
            s,
            h(
              'button',
              {
                class: 'icon',
                'aria-label': `Remove sound ${s}`,
                onclick: () => {
                  sfx.splice(k, 1);
                  this.changed(true);
                },
              },
              '✕',
            ),
          ),
        ),
        addSfx,
      ),
      issues.length
        ? h(
            'ul',
            { class: 'covlist' },
            issues.map((x) =>
              h(
                'li',
                { class: x.status, title: x.path ?? '' },
                `${x.status === 'missing' ? '✗' : '~'} ${x.what}${x.detail ? ` — ${x.detail}` : ''}`,
              ),
            ),
          )
        : null,
      this.ctx.notes.about(p.id).length
        ? h('span', { class: 'ncount', title: 'Notes about this panel' }, `✎ ${this.ctx.notes.about(p.id).length}`)
        : null,
    );
    return card;
  }

  private hints(b: SbBoard): HTMLElement {
    const list = b.hints ?? [];
    return h(
      'div',
      { class: 'sblines' },
      list.map((t, i) => {
        const ta = autoGrow(
          h('textarea', { rows: 1, value: t, 'aria-label': `Hint ${i + 1}`, dataset: { fk: `hint.${i}` } }),
        );
        ta.addEventListener('input', () => {
          list[i] = ta.value;
          this.changed();
        });
        return h(
          'div',
          { class: 'sbline' },
          h('span', { class: 'num' }, String(i + 1)),
          ta,
          h(
            'span',
            { class: 'lops' },
            h(
              'button',
              {
                class: 'icon',
                'aria-label': `Move hint ${i + 1} up`,
                disabled: i === 0,
                onclick: () => {
                  move(list, i, -1);
                  this.changed(true);
                },
              },
              '↑',
            ),
            h(
              'button',
              {
                class: 'icon',
                'aria-label': `Move hint ${i + 1} down`,
                disabled: i === list.length - 1,
                onclick: () => {
                  move(list, i, 1);
                  this.changed(true);
                },
              },
              '↓',
            ),
            h(
              'button',
              {
                class: 'icon del',
                'aria-label': `Delete hint ${i + 1}`,
                onclick: () => {
                  list.splice(i, 1);
                  this.changed(true);
                },
              },
              '✕',
            ),
          ),
        );
      }),
      h(
        'button',
        {
          class: 'add small',
          onclick: () => {
            (b.hints ??= []).push('');
            this.focusKey = `hint.${b.hints.length - 1}`;
            this.changed(true);
          },
        },
        '+ hint',
      ),
    );
  }

  private talks(b: SbBoard): HTMLElement {
    const info = this.ctx.info;
    const talks = b.talks ?? {};
    const box = h('div', { class: 'talks' });
    for (const [c, topics] of Object.entries(talks)) {
      const ch = info.characters[c];
      box.append(
        h(
          'div',
          { class: 'talk' },
          h(
            'div',
            { class: 'talkhead' },
            h('b', { style: ch?.color ? { color: ch.color } : undefined }, ch?.name ?? c),
            h('code', null, c),
            h(
              'button',
              {
                class: 'icon del',
                title: `Remove ${c}'s topics`,
                'aria-label': `Remove the topics of ${c}`,
                onclick: () => {
                  if (topics.length && !confirm(`Remove the ${topics.length} topic(s) of ${ch?.name ?? c}?`)) return;
                  delete talks[c];
                  this.changed(true);
                },
              },
              '✕',
            ),
          ),
          topics.map((t: SbTopic, i) =>
            h(
              'div',
              { class: 'topic' },
              h(
                'div',
                { class: 'inrow' },
                h('span', { class: 'muted small' }, '“'),
                this.input(t, 'topic', {
                  label: `Topic ${i + 1} of ${c}`,
                  placeholder: 'What the hero asks',
                  fk: `talk.${c}.${i}`,
                }),
                h(
                  'span',
                  { class: 'lops' },
                  h(
                    'button',
                    {
                      class: 'icon',
                      'aria-label': `Move topic ${i + 1} up`,
                      disabled: i === 0,
                      onclick: () => {
                        move(topics, i, -1);
                        this.changed(true);
                      },
                    },
                    '↑',
                  ),
                  h(
                    'button',
                    {
                      class: 'icon',
                      'aria-label': `Move topic ${i + 1} down`,
                      disabled: i === topics.length - 1,
                      onclick: () => {
                        move(topics, i, 1);
                        this.changed(true);
                      },
                    },
                    '↓',
                  ),
                  h(
                    'button',
                    {
                      class: 'icon del',
                      'aria-label': `Delete topic ${i + 1}`,
                      onclick: () => {
                        topics.splice(i, 1);
                        this.changed(true);
                      },
                    },
                    '✕',
                  ),
                ),
              ),
              this.lines(t, 'lines', `talk.${c}.${i}.l`),
            ),
          ),
          h(
            'button',
            {
              class: 'add small',
              onclick: () => {
                topics.push({ topic: '', lines: [{ who: c, text: '' }] });
                this.focusKey = `talk.${c}.${topics.length - 1}`;
                this.changed(true);
              },
            },
            '+ topic',
          ),
        ),
      );
    }
    const free = Object.keys(info.characters).filter((c) => !(c in talks) && c !== info.hero);
    if (free.length) {
      const add = h(
        'select',
        { 'aria-label': 'Add topics for a character' },
        h('option', { value: '' }, '+ character…'),
        free.map((c) => h('option', { value: c }, `${info.characters[c].name} (${c})`)),
      );
      add.addEventListener('change', () => {
        if (!add.value) return;
        (b.talks ??= {})[add.value] = [{ topic: '', lines: [{ who: add.value, text: '' }] }];
        this.focusKey = `talk.${add.value}.0`;
        this.changed(true);
      });
      box.append(add);
    }
    return box;
  }

  private reactions(b: SbBoard): HTMLElement {
    const list: SbReaction[] = b.reactions ?? [];
    return h(
      'div',
      { class: 'reactions' },
      list.map((r, i) =>
        h(
          'div',
          { class: 'topic' },
          h(
            'div',
            { class: 'inrow' },
            this.input(r, 'action', {
              label: `Reaction ${i + 1} action`,
              placeholder: 'Player action, e.g. Push garden gnome',
              fk: `react.${i}`,
            }),
            h(
              'span',
              { class: 'lops' },
              h(
                'button',
                {
                  class: 'icon',
                  'aria-label': `Move reaction ${i + 1} up`,
                  disabled: i === 0,
                  onclick: () => {
                    move(list, i, -1);
                    this.changed(true);
                  },
                },
                '↑',
              ),
              h(
                'button',
                {
                  class: 'icon',
                  'aria-label': `Move reaction ${i + 1} down`,
                  disabled: i === list.length - 1,
                  onclick: () => {
                    move(list, i, 1);
                    this.changed(true);
                  },
                },
                '↓',
              ),
              h(
                'button',
                {
                  class: 'icon del',
                  'aria-label': `Delete reaction ${i + 1}`,
                  onclick: () => {
                    list.splice(i, 1);
                    this.changed(true);
                  },
                },
                '✕',
              ),
            ),
          ),
          this.lines(r, 'lines', `react.${i}.l`),
        ),
      ),
      h(
        'button',
        {
          class: 'add small',
          onclick: () => {
            (b.reactions ??= []).push({ action: '', lines: [{ who: 'hero', text: '' }] });
            this.focusKey = `react.${b.reactions.length - 1}`;
            this.changed(true);
          },
        },
        '+ reaction',
      ),
    );
  }

  // -------------------------------------------------------------- preview

  private renderPreview() {
    const b = this.board;
    const p = this.panel;
    if (!b || !p) {
      this.previewEl.replaceChildren(h('p', { class: 'muted pad' }, b ? 'This board has no panel yet.' : ''));
      return;
    }
    const info = this.ctx.info;
    const room = info.rooms.find((r) => r.id === b.room);
    const lines = p.lines ?? [];
    this.li = Math.max(0, Math.min(this.li, lines.length - 1));
    const cur = lines[this.li];
    const charOf = (who: string) => (who === 'hero' ? info.hero : who);
    const speakers = [...new Set(lines.filter((l) => !STAGE.has(l.who)).map((l) => charOf(l.who)))];
    const curId = cur && !STAGE.has(cur.who) ? charOf(cur.who) : '';
    const name = (who: string) => info.characters[charOf(who)]?.name ?? who;

    const frame = h(
      'div',
      { class: 'sbframe' },
      room
        ? h('img', { class: 'decor', src: imgUrl(room.decor), alt: room.name })
        : h('div', { class: 'nodecor' }, 'no room'),
      h(
        'div',
        { class: 'portraits' },
        speakers.map((id) => {
          const c = info.characters[id];
          return c?.portrait
            ? h(
                'figure',
                { class: `pt${id === curId ? ' on' : ''}`, title: c.name },
                h('img', { src: imgUrl(c.portrait), alt: c.name }),
                h('figcaption', { style: { color: c.color } }, c.name),
              )
            : null;
        }),
      ),
      cur
        ? STAGE.has(cur.who)
          ? h('div', { class: 'stagecap' }, cur.who === 'action' ? '▶ ' : '', cur.text || '…')
          : h('div', { class: 'speech', style: { color: this.colorOf(cur.who) ?? '#ddd' } }, cur.text || '…')
        : null,
      p.action ? h('div', { class: 'sbaction' }, h('b', null, p.action)) : null,
    );

    const step = (d: number) => {
      this.li = Math.max(0, Math.min(lines.length - 1, this.li + d));
      this.renderPreview();
    };
    const notes = liveBlock(this.ctx.notes, 'pnotes', (el) => {
      const list = this.ctx.notes.about(p.id).sort(newestFirst);
      const c = composer(this.ctx.notes, p.id, `A note about ${p.id}…`);
      el.replaceChildren(
        h('h3', null, 'Notes ', h('span', { class: 'muted' }, `about ${p.id} · ${list.length}`)),
        list.length
          ? h(
              'ul',
              { class: 'notes' },
              list.map((n) => noteItem(n, this.ctx.notes, { onReply: () => c.text.focus() })),
            )
          : h('p', { class: 'muted small' }, 'No notes about this panel yet.'),
        c.el,
      );
    });

    this.previewEl.replaceChildren(
      h(
        'header',
        { class: 'pvhead' },
        h(
          'div',
          null,
          h('div', { class: 'muted small' }, `${b.title} · panel ${this.pi + 1}/${b.panels.length}`),
          h('h2', null, p.title || p.id),
          h('code', null, p.id),
        ),
        b.room ? h('button', { class: 'small', onclick: () => this.ctx.openRoom(b.room!) }, `Open in Rooms ›`) : null,
      ),
      frame,
      lines.length > 1
        ? h(
            'div',
            { class: 'stepper' },
            h(
              'button',
              { class: 'small', 'aria-label': 'Previous line', disabled: this.li === 0, onclick: () => step(-1) },
              '‹',
            ),
            h('span', { class: 'muted small' }, `line ${this.li + 1} / ${lines.length}`),
            h(
              'button',
              {
                class: 'small',
                'aria-label': 'Next line',
                disabled: this.li >= lines.length - 1,
                onclick: () => step(1),
              },
              '›',
            ),
          )
        : '',
      h(
        'ol',
        { class: 'script' },
        lines.map((l, i) =>
          h(
            'li',
            {
              class: `${i === this.li ? 'on' : ''}${STAGE.has(l.who) ? ' stage' : ''}`,
              onclick: () => {
                this.li = i;
                this.renderPreview();
              },
            },
            STAGE.has(l.who)
              ? h('i', null, `${l.who.toUpperCase()}: ${l.text}`)
              : [h('b', { style: { color: this.colorOf(l.who) } }, name(l.who)), ' ', h('span', null, l.text)],
          ),
        ),
      ),
      p.sfx?.length
        ? h(
            'div',
            { class: 'sfx' },
            h('span', { class: 'muted small' }, 'SFX'),
            p.sfx.map((s) => h('span', { class: 'chipx' }, s)),
          )
        : '',
      notes,
    );
  }
}
