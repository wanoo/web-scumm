// Rooms tab: the room rendered by the real engine (the placement editor in an iframe) and, beside it, the room's
// props / actors / hotspots with the selected one's sheet: name, states, visibility, look lines, reactions, talk
// topics. Every text is edited in place in rooms/<id>.ts through PUT room/:id/text.
import type { Cmd, Cond, Id, RoomDef, Rule } from '@engine/core/types';
import { api, BASE, imgUrl, type EditorToStudio, type EntityKind, type GameInfo, type RoomData, type StudioToEditor, type TextRef } from './api';
import { autoGrow, h, modal, select, toast } from './ui';

export interface RoomsCtx {
  info: GameInfo;
  /** Called after every successful write (runs Check in the background). */
  saved(): void;
  /** Marks a write as ours, so the file watcher's echo is not announced as an outside change. */
  ownWrite(): void;
  /** Optional: the "Notes (n)" block of a room, appended at the bottom of the room section (src/studio/notes.ts). */
  notesBlock?(room: Id): HTMLElement;
}

type Sel = { kind: EntityKind; id: Id } | null;

const KIND_LABEL: Record<EntityKind, string> = { prop: 'Prop', actor: 'Actor', hotspot: 'Hotspot' };
const SECTION: Record<EntityKind, 'props' | 'actors' | 'hotspots'> = { prop: 'props', actor: 'actors', hotspot: 'hotspots' };
const MAX_TEXT = 140;

// ---------------------------------------------------------------------------
// Readable conditions and commands
// ---------------------------------------------------------------------------

export function condText(c: Cond | undefined): string {
  if (c === undefined) return '';
  if (typeof c === 'string') return c.startsWith('!') ? `not ${c.slice(1)}` : c;
  if ('has' in c) return `has ${c.has}`;
  if ('not' in c) return `not (${condText(c.not)})`;
  if ('all' in c) return c.all.map(condText).join(' and ');
  if ('any' in c) return c.any.map(condText).join(' or ');
  if ('visited' in c) return `visited ${c.visited}`;
  if ('room' in c) return `in ${c.room}`;
  if ('prop' in c) return `${c.prop[0]} is ${c.prop[1]}`;
  if ('unlocked' in c) return `${c.unlocked} unlocked`;
  if ('seen' in c) return `heard ${c.seen}`;
  if ('flag' in c) {
    const op = c.eq !== undefined ? `= ${JSON.stringify(c.eq)}` : c.gte !== undefined ? `≥ ${c.gte}` : c.lt !== undefined ? `< ${c.lt}` : 'set';
    return `${c.flag} ${op}`;
  }
  return JSON.stringify(c);
}

function chipText(c: Exclude<Cmd, string>): string {
  const [k, v] = Object.entries(c)[0] ?? ['?', ''];
  const val = (x: unknown): string => (Array.isArray(x) ? x.map(val).join(' → ') : typeof x === 'object' && x ? JSON.stringify(x) : String(x));
  const rest = Object.entries(c).slice(1).filter(([kk]) => !['then', 'else', 'do', 'after'].includes(kk)).map(([kk, x]) => `${kk} ${val(x)}`);
  const s = `${k} ${v === true ? '' : val(v)}${rest.length ? ` (${rest.join(', ')})` : ''}`.trim();
  return s.length > 70 ? s.slice(0, 68) + '…' : s;
}

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export class RoomsTab {
  readonly el = h('section', { class: 'tab rooms' });
  private roomId: Id;
  private checkpoint = '';
  private data: RoomData | null = null;
  private byPath = new Map<string, TextRef>();
  private sel: Sel = null;
  private search = '';
  private frame!: HTMLIFrameElement;
  private listEl = h('div', { class: 'entities' });
  private sheetEl = h('div', { class: 'sheet' });
  private roomSheetEl = h('div', { class: 'roomsheet' });
  private frameStatus = h('span', { class: 'muted small' });
  private editorDirty = false;
  private savedWaiters: ((ok: boolean) => void)[] = [];
  private lastReady = 0;
  private pendingRender = false;
  private pendingSelect: Sel = null;

  constructor(private ctx: RoomsCtx, initialRoom?: string) {
    const rooms = ctx.info.rooms;
    this.roomId = rooms.some((r) => r.id === initialRoom) ? initialRoom! : rooms[0]?.id ?? '';
    window.addEventListener('message', (e) => this.onMessage(e));
    this.build();
  }

  get room() { return this.roomId; }
  /** The selected entity, if any (the Assistant's context). */
  get selection(): Sel { return this.sel; }

  // -------------------------------------------------------------- layout

  private build() {
    const info = this.ctx.info;
    const cps = Object.entries(info.checkpoints);
    this.frame = h('iframe', { class: 'engine', title: 'Room editor', src: this.frameUrl() });
    const bar = h('div', { class: 'bar' },
      h('label', null, 'Room ', select(info.rooms.map((r) => [r.id, `${r.name} (${r.id})`]), this.roomId, (v) => this.openRoom(v), { 'aria-label': 'Room' })),
      h('label', null, 'State ', select([['', 'auto'], ...cps.map(([k, c]) => [k, `${k} (${c.room})`] as [string, string])], this.checkpoint, (v) => { this.checkpoint = v; this.reloadFrame(); }, { 'aria-label': 'Checkpoint' })),
      h('button', { onclick: () => this.post({ source: 'web-scumm-studio', type: 'save' }), title: 'Save the layout edited in the view' }, 'Save layout'),
      h('button', { onclick: () => this.reloadFrame(), title: 'Reload the view (drops unsaved placement)' }, 'Reload view'),
      this.frameStatus,
    );
    const search = h('input', { type: 'search', placeholder: 'Search props, actors, hotspots…', value: this.search, 'aria-label': 'Search' });
    search.addEventListener('input', () => { this.search = search.value.trim().toLowerCase(); this.renderList(); });
    this.el.replaceChildren(
      h('div', { class: 'stage' }, bar, h('div', { class: 'frame' }, this.frame), this.roomSheetEl),
      h('aside', { class: 'side' },
        h('div', { class: 'listhead' }, search, h('button', { class: 'primary', onclick: () => this.addDialog() }, '+ Add')),
        this.listEl, this.sheetEl),
    );
    void this.load();
  }

  private frameUrl() {
    const q = new URLSearchParams({ edit: this.roomId });
    if (this.checkpoint) q.set('at', this.checkpoint);
    return `${BASE}?${q}`;
  }

  reloadFrame() {
    this.editorDirty = false;
    this.frameStatus.textContent = 'loading…';
    this.frame.src = this.frameUrl();
  }

  openRoom(id: Id) {
    if (id === this.roomId) return;
    this.roomId = id;
    this.sel = null;
    const pick = this.el.querySelector<HTMLSelectElement>('select[aria-label="Room"]');
    if (pick) pick.value = id; // when opened from elsewhere (Storyboard, Notes)
    history.replaceState(null, '', `#rooms/${id}`);
    this.reloadFrame();
    void this.load();
  }

  async load() {
    try {
      this.data = await api.room(this.roomId);
      this.byPath = new Map(this.data.texts.map((t) => [t.path, t]));
      if (this.sel && !this.entityDef(this.sel)) this.sel = null;
      this.render();
    } catch (e) {
      this.sheetEl.replaceChildren(h('p', { class: 'error' }, (e as Error).message));
    }
  }

  /** Re-render now, or after the text being typed is saved. */
  private render() {
    const a = document.activeElement;
    if (a instanceof HTMLTextAreaElement && this.el.contains(a) && a.value !== a.defaultValue) { this.pendingRender = true; return; }
    this.pendingRender = false;
    this.renderList();
    this.renderSheet();
    this.renderRoomSheet();
  }

  // -------------------------------------------------------------- bridge with the editor (iframe)

  private post(m: StudioToEditor) { this.frame.contentWindow?.postMessage(m, location.origin); }

  private onMessage(e: MessageEvent) {
    const m = e.data as EditorToStudio;
    if (e.origin !== location.origin || m?.source !== 'web-scumm-editor' || e.source !== this.frame.contentWindow) return;
    if (m.type === 'ready') {
      this.lastReady = Date.now();
      this.editorDirty = false;
      this.frameStatus.textContent = m.missing.length ? `${m.missing.length} without a place: ${m.missing.map((x) => x.id).join(', ')}` : '';
      const s = this.pendingSelect ?? this.sel;
      this.pendingSelect = null;
      if (s) this.post({ source: 'web-scumm-studio', type: m.missing.some((x) => x.id === s.id) ? 'create' : 'select', kind: s.kind, id: s.id });
    } else if (m.type === 'select' && m.kind && m.id) {
      if (this.sel?.kind !== m.kind || this.sel?.id !== m.id) { this.sel = { kind: m.kind, id: m.id }; this.renderList(); this.renderSheet(); }
    } else if (m.type === 'dirty') {
      this.editorDirty = m.dirty;
      this.frameStatus.textContent = m.dirty ? 'placement not saved' : '';
    } else if (m.type === 'saved') {
      void this.onSaved(m);
    }
  }

  private async onSaved(m: Extract<EditorToStudio, { type: 'saved' }>) {
    let { ok, error } = m;
    // The editor could not write the file (demo mode): the layout is stored through the Studio's backend.
    if (ok && m.layout) {
      try { await api.setLayout(m.room, m.layout); } catch (e) { ok = false; error = (e as Error).message; }
    }
    this.editorDirty = !ok;
    this.frameStatus.textContent = ok ? '' : error ?? 'save failed';
    if (ok) { this.ctx.ownWrite(); toast(api.mode === 'demo' ? 'Layout saved in this browser' : 'Layout saved'); this.ctx.saved(); } else toast(error ?? 'Layout not saved', 'error');
    if (ok && m.layout && this.data && m.room === this.roomId) this.data.layout = m.layout;
    this.savedWaiters.splice(0).forEach((f) => f(ok));
  }

  /** Before touching the room file (the view reloads when it changes): save the placement in progress. */
  private async flushEditor() {
    if (!this.editorDirty) return;
    const done = new Promise<boolean>((res) => { this.savedWaiters.push(res); setTimeout(() => res(false), 4000); });
    this.post({ source: 'web-scumm-studio', type: 'save' });
    await done;
  }

  /** Called on a file change on disk (SSE). */
  onFileChanged(file: string) {
    if (!this.data) return;
    if (file === `layout/${this.roomId}.json`) {
      // Vite reloads the view by itself when the layout module changes; make sure it does.
      const since = Date.now();
      setTimeout(() => { if (this.lastReady < since) this.reloadFrame(); }, 1200);
      void this.load();
    } else if (file.endsWith('.ts') || file === 'assets.gen.json') {
      void this.load();
    }
  }

  // -------------------------------------------------------------- list

  private entityDef(s: NonNullable<Sel>) { return this.data?.def[SECTION[s.kind]]?.[s.id]; }

  private entityName(kind: EntityKind, id: Id): string {
    const d = this.data!.def;
    if (kind === 'actor') { const a = d.actors![id]; return a.name ?? this.ctx.info.characters[a.char]?.name ?? a.char; }
    return (kind === 'prop' ? d.props![id].name : d.hotspots![id].name) ?? '';
  }

  private renderList() {
    if (!this.data) return;
    const d = this.data.def;
    const groups: [EntityKind, Id[]][] = [['prop', Object.keys(d.props ?? {})], ['actor', Object.keys(d.actors ?? {})], ['hotspot', Object.keys(d.hotspots ?? {})]];
    const q = this.search;
    this.listEl.replaceChildren(...groups.map(([kind, ids]) => {
      const shown = ids.filter((id) => !q || id.toLowerCase().includes(q) || this.entityName(kind, id).toLowerCase().includes(q));
      return h('div', { class: 'group' },
        h('h3', null, `${KIND_LABEL[kind]}s `, h('span', { class: 'muted' }, shown.length === ids.length ? String(ids.length) : `${shown.length}/${ids.length}`)),
        h('ul', null, shown.map((id) => {
          const name = this.entityName(kind, id);
          const interactive = kind === 'hotspot' || (kind === 'prop' ? !!d.props![id].name : d.actors![id].interactive !== false);
          const noLook = interactive && !d.look?.[id];
          const on = this.sel?.kind === kind && this.sel.id === id;
          return h('li', null, h('button', {
            class: `ent${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
            onclick: () => this.selectEntity({ kind, id }),
          }, h('span', { class: `kind k-${kind}` }, kind[0].toUpperCase()), h('span', { class: 'id' }, id),
          name && name !== id ? h('span', { class: 'name' }, name) : null,
          noLook ? h('span', { class: 'warn', title: 'No look line' }, 'no look') : null,
          !interactive ? h('span', { class: 'muted small' }, 'decor') : null));
        })));
    }));
    this.listEl.querySelector('.ent.on')?.scrollIntoView({ block: 'nearest' });
  }

  selectEntity(s: NonNullable<Sel>) {
    this.sel = s;
    this.renderList();
    this.renderSheet();
    this.post({ source: 'web-scumm-studio', type: 'select', kind: s.kind, id: s.id });
  }

  // -------------------------------------------------------------- text editing

  /** An editable line for the text at `path` (null if the room file has no literal there). */
  private line(path: string, opts: { label?: string; color?: string; deletable?: boolean } = {}): HTMLElement | null {
    const ref = this.byPath.get(path);
    if (!ref) return null;
    const t = autoGrow(h('textarea', { rows: 1, value: ref.value, spellcheck: true, 'aria-label': `${opts.label ?? ref.kind}: ${path}` }));
    t.defaultValue = ref.value;
    const count = h('span', { class: 'count' });
    const showCount = () => { const n = t.value.length; count.textContent = n > MAX_TEXT - 20 ? String(n) : ''; count.classList.toggle('over', n > MAX_TEXT); };
    showCount();
    const row = h('div', { class: 'line', title: `${path} · ${ref.file}:${ref.line}` },
      opts.label ? h('span', { class: 'who', style: opts.color ? { color: opts.color } : undefined }, opts.label) : null,
      t, count,
      opts.deletable ? h('button', { class: 'icon del', title: 'Delete this line', 'aria-label': `Delete ${path}`, onclick: () => void this.write(path, null) }, '✕') : null);
    const commit = async () => {
      const v = t.value;
      if (v === t.defaultValue) { if (this.pendingRender) this.render(); return; }
      if (!v.trim()) { toast('A line cannot be empty (✕ deletes it)', 'error'); t.value = t.defaultValue; return; }
      row.classList.add('saving');
      const ok = await this.write(path, v, false);
      row.classList.remove('saving');
      if (ok) { t.defaultValue = v; ref.value = v; }
      if (this.pendingRender) this.render();
    };
    t.addEventListener('input', showCount);
    t.addEventListener('blur', () => void commit());
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); t.blur(); }
      else if (e.key === 'Escape') { t.value = t.defaultValue; t.blur(); }
    });
    return row;
  }

  /** "+ line" input appending to the list at `path` (`look.piano`, `hints[2].lines`). */
  private appender(path: string, placeholder: string): HTMLElement {
    const t = h('input', { type: 'text', placeholder, 'aria-label': placeholder });
    const go = async () => { const v = t.value.trim(); if (!v) return; if (await this.write(`${path}[+]`, v)) t.value = ''; };
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void go(); } });
    return h('div', { class: 'line add' }, t, h('button', { onclick: () => void go() }, '+ line'));
  }

  /** PUT text; `reload` re-reads the room afterwards (needed when paths shift: append, delete). */
  private async write(path: string, value: string | null, reload = true): Promise<boolean> {
    try {
      await this.flushEditor();
      this.ctx.ownWrite();
      const r = await api.setText(this.roomId, path, value);
      if (r.changed) {
        toast(`${value === null ? 'Deleted' : path.endsWith('[+]') ? 'Added' : 'Saved'} · ${this.data?.file.split('/').pop()}:${r.line}`);
        this.ctx.saved();
      }
      if (reload || !r.changed) await this.load();
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
  }

  // -------------------------------------------------------------- commands as lines

  private speaker(who: string): { label: string; color?: string } {
    const id = who === 'hero' ? this.ctx.info.hero : who;
    const c = this.ctx.info.characters[id];
    return { label: c?.name ?? who, color: c?.color };
  }

  private cmds(list: Cmd[] | undefined, path: string): HTMLElement {
    const box = h('div', { class: 'cmds' });
    (list ?? []).forEach((c, i) => {
      const p = `${path}[${i}]`;
      if (typeof c === 'string') { const s = this.speaker('hero'); box.append(this.line(p, s) ?? h('div', { class: 'chip' }, c)); return; }
      if ('say' in c) { const s = this.speaker(c.say[0]); box.append(this.line(`${p}.say[1]`, s) ?? h('div', { class: 'chip' }, chipText(c))); return; }
      if ('toast' in c) { box.append(this.line(`${p}.toast`, { label: 'toast' }) ?? h('div', { class: 'chip' }, chipText(c))); return; }
      if ('guide' in c) { box.append(this.line(`${p}.guide.say`, { label: 'guide' }) ?? h('div', { class: 'chip' }, chipText(c))); return; }
      const nest = (label: string, sub: Cmd[] | undefined, subPath: string) => h('div', { class: 'nest' }, h('div', { class: 'chip k' }, label), this.cmds(sub, subPath));
      if ('if' in c && 'then' in c) {
        box.append(nest(`if ${condText(c.if)}`, c.then, `${p}.then`));
        if (c.else) box.append(nest('else', c.else, `${p}.else`));
        return;
      }
      for (const k of ['once', 'cutscene'] as const) if (k in c) { box.append(nest(k, (c as Record<string, Cmd[]>)[k], `${p}.${k}`)); return; }
      for (const k of ['nth', 'cycle', 'random', 'parallel'] as const) {
        if (k in c) {
          const branches = (c as Record<string, Cmd[][]>)[k];
          box.append(h('div', { class: 'nest' }, h('div', { class: 'chip k' }, k),
            branches.map((b, j) => nest(`${k === 'nth' ? `time ${j + 1}` : `#${j + 1}`}`, b, `${p}.${k}[${j}]`))));
          return;
        }
      }
      if ('choice' in c) {
        box.append(h('div', { class: 'nest' }, h('div', { class: 'chip k' }, 'choice'), c.choice.map((o, j) => h('div', { class: 'nest' },
          this.line(`${p}.choice[${j}].text`, { label: `option${o.if ? ` (if ${condText(o.if)})` : ''}` }) ?? h('div', { class: 'chip' }, o.text),
          this.cmds(o.do, `${p}.choice[${j}].do`)))));
        return;
      }
      if ('phone' in c) { box.append(nest(`phone ${asList(c.phone).join(', ')}`, c.do, `${p}.do`)); return; }
      if ('minigame' in c && c.then) { box.append(h('div', { class: 'chip' }, chipText(c)), nest('then', c.then, `${p}.then`)); return; }
      if (('ending' in c || 'reveal' in c) && c.after) { box.append(h('div', { class: 'chip' }, chipText(c)), nest('after', c.after, `${p}.after`)); return; }
      box.append(h('div', { class: 'chip' }, chipText(c)));
    });
    return box;
  }

  // -------------------------------------------------------------- the selected entity's sheet

  private verbLabel(v: string) { return this.ctx.info.verbs.find((x) => x.id === v)?.label ?? v; }

  private ruleHead(r: Rule): string {
    const verbs = asList(r.verb).map((v) => this.verbLabel(v)).join(' / ');
    const a = asList(r.a).join(' / ');
    const b = r.b ? ` → ${asList(r.b).join(' / ')}` : '';
    return `${verbs} ${a}${b}`;
  }

  private renderSheet() {
    const s = this.sel;
    const d = this.data?.def;
    if (!d || !s || !this.entityDef(s)) {
      this.sheetEl.replaceChildren(h('p', { class: 'muted hint' }, 'Select a prop, an actor or a hotspot in the list or in the view.'));
      return;
    }
    const info = this.ctx.info;
    const id = s.id;
    const sec = SECTION[s.kind];
    const parts: (HTMLElement | null)[] = [];

    // Header: name
    const nameLine = this.line(`${sec}.${id}.name`, { label: 'name' });
    const title = this.entityName(s.kind, id);
    parts.push(h('header', { class: 'sheethead' }, h('span', { class: `kind k-${s.kind}` }, KIND_LABEL[s.kind]), h('h2', null, id),
      title && title !== id ? h('span', { class: 'muted' }, title) : null));
    if (nameLine) parts.push(nameLine);

    // Facts (read-only)
    const facts: HTMLElement[] = [];
    if (s.kind === 'prop') {
      const p = d.props![id];
      if (p.img) facts.push(h('div', { class: 'fact' }, h('b', null, 'image'), thumb(p.img), h('code', null, p.img)));
      if (p.states) facts.push(h('div', { class: 'fact' }, h('b', null, 'states'), h('div', { class: 'states' },
        Object.entries(p.states).map(([st, im]) => h('figure', { class: st === p.initial ? 'initial' : '' }, thumb(im), h('figcaption', null, st, st === p.initial ? ' ★' : ''))))));
      if (!p.name) facts.push(h('div', { class: 'fact muted' }, 'No name: scenery, not clickable.'));
    }
    if (s.kind === 'actor') {
      const a = d.actors![id];
      facts.push(h('div', { class: 'fact' }, h('b', null, 'character'), h('code', null, a.char),
        a.pose ? h('span', null, ` pose ${a.pose}`) : null, a.facing ? h('span', null, ` facing ${a.facing}`) : null,
        a.interactive === false ? h('span', { class: 'muted' }, ' (not interactive)') : null));
    }
    const vis = (this.entityDef(s) as { visible?: Cond }).visible;
    facts.push(h('div', { class: 'fact' }, h('b', null, 'visible'), vis === undefined ? 'always' : h('code', null, condText(vis))));
    parts.push(h('div', { class: 'facts' }, facts));

    // Look lines
    const look = d.look?.[id];
    const lookPaths = look === undefined ? [] : Array.isArray(look) ? look.map((_, i) => `look.${id}[${i}]`) : [`look.${id}`];
    parts.push(h('section', null, h('h3', null, 'Look ', h('span', { class: 'muted small' }, lookPaths.length > 1 ? 'one line per look, in turn' : '')),
      lookPaths.length ? lookPaths.map((p) => this.line(p, { deletable: true })) : h('p', { class: 'warn' }, 'No look line yet: everything visible should have one.'),
      this.appender(`look.${id}`, 'New look line…')));

    // Reactions touching this entity
    const rules = (d.on ?? []).map((r, i) => [r, i] as const).filter(([r]) => asList(r.a).includes(id) || asList(r.b).includes(id));
    parts.push(h('section', null, h('h3', null, 'Reactions ', h('span', { class: 'muted' }, String(rules.length))),
      rules.length ? rules.map(([r, i]) => h('div', { class: 'rule' },
        h('div', { class: 'rulehead' }, h('span', null, this.ruleHead(r)), r.if !== undefined ? h('code', { class: 'cond' }, `if ${condText(r.if)}`) : null,
          h('span', { class: 'muted small' }, `on[${i}]`)),
        this.cmds(r.do, `on[${i}].do`)))
      : h('p', { class: 'muted' }, 'None in this room: the game\'s fallback answers apply.')));

    // Talk topics
    if (s.kind === 'actor') {
      const topics = d.talk?.[id] ?? [];
      parts.push(h('section', null, h('h3', null, 'Talk topics ', h('span', { class: 'muted' }, String(topics.length))),
        topics.length ? topics.map((t, i) => h('div', { class: 'rule' },
          h('div', { class: 'rulehead' }, this.line(`talk.${id}[${i}].topic`, { label: 'topic' }) ?? h('span', null, t.topic),
            t.if !== undefined ? h('code', { class: 'cond' }, `if ${condText(t.if)}`) : null),
          this.cmds(t.do, `talk.${id}[${i}].do`)))
        : h('p', { class: 'muted' }, 'No topics (only the game-wide ones).')));
    }
    this.sheetEl.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
    void info;
  }

  // -------------------------------------------------------------- room-wide texts

  private renderRoomSheet() {
    const d = this.data?.def;
    if (!d) return;
    const hints = d.hints ?? [];
    this.roomSheetEl.replaceChildren(
      h('section', null, h('h3', null, 'Room ', h('span', { class: 'muted small' }, this.data!.file)),
        this.line('name', { label: 'name' }) ?? h('p', null, d.name)),
      h('section', null, h('h3', null, 'Hints ', h('span', { class: 'muted small' }, 'the first one whose condition is still false is given')),
        hints.length ? hints.map((hd, i) => h('div', { class: 'rule' },
          h('div', { class: 'rulehead' }, h('code', { class: 'cond' }, `until ${condText(hd.until)}`), h('span', { class: 'muted small' }, `hints[${i}]`)),
          hd.lines.map((_, j) => this.line(`hints[${i}].lines[${j}]`, { deletable: hd.lines.length > 1 })),
          this.appender(`hints[${i}].lines`, 'New hint line…')))
        : h('p', { class: 'muted' }, 'No hints in this room.')),
      h('section', null, h('h3', null, 'On enter'), d.onEnter?.length ? this.cmds(d.onEnter, 'onEnter') : h('p', { class: 'muted' }, 'Nothing happens on entering.')),
    );
    const notes = this.ctx.notesBlock?.(this.roomId);
    if (notes) this.roomSheetEl.append(notes);
  }

  // -------------------------------------------------------------- add a prop / hotspot / actor

  private addDialog() {
    const info = this.ctx.info;
    const d = this.data?.def as RoomDef | undefined;
    let kind: EntityKind = 'prop';
    let img = '';
    const id = h('input', { type: 'text', required: true, pattern: '[A-Za-z_][A-Za-z0-9_]*', placeholder: 'e.g. vase', 'aria-label': 'Id' });
    const name = h('input', { type: 'text', placeholder: 'e.g. blue vase', 'aria-label': 'Name' });
    const look = h('input', { type: 'text', placeholder: 'What the hero says when looking at it', 'aria-label': 'Look line' });
    const chars = Object.entries(info.characters);
    const char = select(chars.map(([k, c]) => [k, `${c.name} (${k})`]), chars[0]?.[0] ?? '', () => undefined, { 'aria-label': 'Character' });
    const imgSearch = h('input', { type: 'search', placeholder: 'Filter images…', 'aria-label': 'Filter images' });
    const grid = h('div', { class: 'imggrid' });
    const picked = h('span', { class: 'muted small' }, 'no image');
    const drawGrid = () => {
      const q = imgSearch.value.trim().toLowerCase();
      const ids = Object.keys(info.images).filter((k) => !q || k.toLowerCase().includes(q)).slice(0, 240);
      grid.replaceChildren(...ids.map((k) => h('button', { class: `imgpick${k === img ? ' on' : ''}`, title: k, type: 'button',
        onclick: () => { img = img === k ? '' : k; picked.textContent = img || 'no image'; drawGrid(); } },
        h('img', { src: imgUrl(k), loading: 'lazy', alt: k }), h('span', null, k))));
    };
    imgSearch.addEventListener('input', drawGrid);
    const imgRow = h('div', { class: 'field' }, h('span', null, 'Image ', picked), imgSearch, grid);
    const charRow = h('label', { class: 'field' }, h('span', null, 'Character'), char);
    const nameLabel = h('span', null, 'Name');
    const sync = () => {
      imgRow.hidden = kind !== 'prop';
      charRow.hidden = kind !== 'actor';
      nameLabel.textContent = kind === 'actor' ? 'Name (optional)' : 'Name';
    };
    const kinds = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Kind' }, (['prop', 'hotspot', 'actor'] as EntityKind[]).map((k) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': k === kind ? 'true' : 'false', class: k === kind ? 'on' : '',
        onclick: () => { kind = k; kinds.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); }); sync(); } }, KIND_LABEL[k]);
      return b;
    }));
    const err = h('p', { class: 'error' });
    const form = h('form', { class: 'addform' },
      kinds,
      h('label', { class: 'field' }, h('span', null, 'Id'), id),
      h('label', { class: 'field' }, nameLabel, name),
      imgRow, charRow,
      h('label', { class: 'field' }, h('span', null, 'Look line'), look),
      h('p', { class: 'muted small' }, 'It is placed in the middle of the room: drag it into place in the view, then Save layout.'),
      err,
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, 'Add to the room')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const nid = id.value.trim();
      if (d && [d.props, d.actors, d.hotspots].some((o) => o && nid in o)) { err.textContent = `"${nid}" already exists in this room.`; return; }
      const at: [number, number] = kind === 'hotspot' ? [320, 200] : [320, 320];
      try {
        await this.flushEditor();
        this.ctx.ownWrite();
        const r = await api.add(this.roomId, { kind, id: nid, name: name.value.trim() || undefined, img: kind === 'prop' ? img || undefined : undefined,
          char: kind === 'actor' ? char.value : undefined, at, look: look.value.trim() || undefined });
        close();
        toast(`Added ${kind} ${nid} · line ${r.line}`);
        this.ctx.saved();
        this.sel = { kind, id: nid };
        this.pendingSelect = this.sel;
        await this.load();
        this.post({ source: 'web-scumm-studio', type: 'select', kind, id: nid });
        // The view reloads by itself (the room module changed); force it if it doesn't.
        const since = Date.now();
        setTimeout(() => { if (this.lastReady < since) this.reloadFrame(); }, 1500);
      } catch (x) { err.textContent = (x as Error).message; }
    });
    sync();
    drawGrid();
    const close = modal('Add to the room', form);
    id.focus();
  }
}

function thumb(id: string) {
  return h('img', { class: 'thumb', src: imgUrl(id), alt: id, title: id, loading: 'lazy' });
}
