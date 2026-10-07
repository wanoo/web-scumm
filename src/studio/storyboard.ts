// Storyboard tab: edits storyboard.json (boards, panels in play order, lines, sfx, arrival, hints, talks, reactions)
// in memory; Save writes the whole document (PUT storyboard). Beside the editor, the selected panel composed like a
// storyboard frame (room decor, speakers' portraits, the lines as the game shows them) and the notes about it.
// Since 4.1.8 (programme §4.7: the Studio's biggest owners split into model / IO / view) this file keeps the state,
// the IO against the API and the orchestration of the rendering; the rules live in `storyboard-model.ts`, the editor
// blocks in `storyboard-view.ts` and the frame in `storyboard-preview.ts`.
import type { SbBoard, SbPanel } from '../../tools/pages/storyboard-data';
import { api, type CoverageData, type GameInfo } from './api';
import type { NotesStore } from './notes';
import {
  boardCov,
  type Doc,
  findPanel,
  idProblem,
  move,
  nextBoardId,
  nextPanelId,
  normDoc,
  panelList,
} from './storyboard-model';
import { previewContent } from './storyboard-preview';
import { badge, hintsBlock, input, lines, panelCard, reactionsBlock, type SbHost, talksBlock } from './storyboard-view';
import { h, toast } from './ui';
import { must } from '../engine/core/must';

export interface StoryboardCtx {
  info: GameInfo;
  notes: NotesStore;
  ownWrite(): void;
  /** Switches to the Rooms tab on that room. */
  openRoom(id: string): void;
}

export class StoryboardTab {
  readonly el = h('section', { class: 'tab sb' });
  private doc: Doc | undefined;
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
  /** What the editor blocks and the preview see of this tab (storyboard-view.ts). */
  private readonly host: SbHost;

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
    const tab = this;
    this.host = {
      info: ctx.info,
      notes: ctx.notes,
      get doc() {
        return must(tab.doc, 'storyboard document while editing');
      },
      get cov() {
        return tab.cov;
      },
      get board() {
        return tab.board;
      },
      get panel() {
        return tab.panel;
      },
      get pi() {
        return tab.pi;
      },
      set pi(v) {
        tab.pi = v;
      },
      get li() {
        return tab.li;
      },
      set li(v) {
        tab.li = v;
      },
      changed: (structure) => this.changed(structure),
      focus: (key) => {
        this.focusKey = key;
      },
      openRoom: (id) => ctx.openRoom(id),
      selectPanel: (i, li) => this.selectPanel(i, li),
      renderList: () => this.renderList(),
      renderPreview: () => this.renderPreview(),
    };
  }

  get dirty() {
    return !!this.doc && JSON.stringify(this.doc) !== this.savedJson;
  }

  /** Panels in play order: [id, title, board title] (for the Notes tab). */
  panels(): [string, string, string][] {
    return panelList(this.doc);
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
    const at = findPanel(this.doc, id);
    if (!at) return;
    this.bi = at.bi;
    this.pi = at.pi;
    this.li = 0;
    this.renderAll();
    requestAnimationFrame(() => this.editEl.querySelector('.card.on')?.scrollIntoView({ block: 'center' }));
  }

  async save() {
    if (!this.doc) return;
    const problem = idProblem(this.doc);
    if (problem) {
      toast(problem, 'error');
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

  /** Selects panel `i` (and its line `li`) by toggling the cards' `on` class; redraws the preview. */
  private selectPanel(i: number, li?: number) {
    if (this.pi !== i) {
      this.pi = i;
      this.editEl.querySelectorAll('.card').forEach((c, k) => c.classList.toggle('on', k === i));
    }
    if (li !== undefined) this.li = li;
    else if (this.pi !== i) this.li = 0;
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
                  const c = boardCov(this.cov, b.id);
                  return c ? badge(c.status, `${Math.round(c.score * 100)}% of this board is in the game`) : null;
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
    const doc = must(this.doc, 'storyboard document to add a board to');
    doc.boards.push({
      id: nextBoardId(doc),
      title: 'New board',
      room: this.ctx.info.rooms[0]?.id,
      goal: '',
      panels: [],
    });
    this.bi = doc.boards.length - 1;
    this.pi = 0;
    this.focusKey = 'board.title';
    this.changed(true);
  }

  private deleteBoard(i: number) {
    const doc = must(this.doc, 'storyboard document to delete a board from');
    const b = must(doc.boards[i], 'board to delete');
    if (
      !confirm(
        `Delete the board "${b.title}" and its ${b.panels.length} panel(s)? (Nothing is written until you save.)`,
      )
    )
      return;
    doc.boards.splice(i, 1);
    this.bi = Math.max(0, Math.min(this.bi, doc.boards.length - 1));
    this.pi = 0;
    this.changed(true);
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
          input(this.host, b, 'title', { label: 'Board title', fk: 'board.title', onInput: () => this.renderList() }),
        ),
        h('label', { class: 'field' }, h('span', null, 'Id'), input(this.host, b, 'id', { label: 'Board id' })),
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
          input(this.host, b, 'goal', {
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
          input(this.host, b, 'exit', { label: 'Exit', optional: true, placeholder: 'How the board ends (optional)' }),
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
      lines(this.host, b, 'arrival', 'arrival'),
    );

    const cards = b.panels.map((p, i) => panelCard(this.host, b, p, i));
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
      hintsBlock(this.host, b),
    );
    const talks = section(
      'Talk topics',
      Object.values(b.talks ?? {}).reduce((n, t) => n + t.length, 0),
      !!b.talks && Object.keys(b.talks).length > 0,
      talksBlock(this.host, b),
    );
    const reactions = section(
      'Reactions',
      b.reactions?.length ?? 0,
      !!b.reactions?.length,
      h('p', { class: 'muted small' }, 'Optional: not needed to finish the game.'),
      reactionsBlock(this.host, b),
    );

    this.editEl.replaceChildren(head, arrival, panels, hints, talks, reactions);
    this.editEl.scrollTop = scroll;
    if (this.focusKey) {
      const el = this.editEl.querySelector<HTMLElement>(`[data-fk="${CSS.escape(this.focusKey)}"]`);
      this.focusKey = '';
      el?.focus();
    }
  }

  private addPanel(b: SbBoard) {
    b.panels.push({
      id: nextPanelId(must(this.doc, 'storyboard document to add a panel to'), b),
      title: '',
      lines: [],
    });
    this.pi = b.panels.length - 1;
    this.li = 0;
    this.focusKey = `p${this.pi}.title`;
    this.changed(true);
  }

  // -------------------------------------------------------------- preview

  private renderPreview() {
    this.previewEl.replaceChildren(...previewContent(this.host));
  }
}
