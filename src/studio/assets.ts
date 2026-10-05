// Assets tab: every image and sound of the game (games/<id>/art, audio), where each one is used, its art prompt, and
// the uploads: a generated sheet (cut by tools/cut-sheet.py), one cell, a decor, a sound. Nothing is ever deleted: a
// replaced file is kept as `<name>_v<N>` next to it. Listing through `api.assets()` (the demo reads its snapshot);
// uploads and "Prepare assets" talk to /__studio/api/assets/* on the dev server only (tools/studio/assets.ts).
import './assets.css';
import type { Layout } from '@engine/core/types';
import {
  api,
  BASE,
  type AssetCell,
  type AssetDecor,
  type AssetPrompt,
  type AssetSheet,
  type AssetSound,
  type AssetsListing,
  type CellReplaceResult,
  type GameInfo,
  type SheetUploadResult,
  type UploadResult,
} from './api';
import { h, modal, toast } from './ui';
import { must } from '../engine/core/must';

export interface AssetsCtx {
  info: GameInfo;
  /** Marks a write as ours (the file watcher's echo is not announced as an outside change). */
  ownWrite(): void;
  /** After "Prepare assets": the engine view reloads with the new images. */
  prepared?(): void;
  /** Opens a room in the Rooms tab. */
  openRoom?(id: string): void;
}

type Sel = { type: 'sheet'; id: string } | { type: 'decor'; id: string } | { type: 'sounds'; kind: 'music' | 'sfx' };
type Filter = 'all' | 'used' | 'unused' | 'missing';
type Group = {
  title: string;
  items: { sel: Sel; label: string; sub?: string; badges: [string, number, string][] }[];
  add?: HTMLElement;
};

class AssetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** POST /__studio/api/assets/<path> (dev server only). */
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/__studio/api/assets/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) throw new AssetsApiError(data.error ?? `${r.status}`, r.status, data);
  return data as T;
}

/** A picked file as base64 (a data URL). */
function readFile(f: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error ?? new Error('cannot read the file'));
    r.readAsDataURL(f);
  });
}

/** Opens the system file picker; resolves with the chosen file (never resolves if cancelled). */
function pickFile(accept: string): Promise<File> {
  return new Promise((ok) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.remove();
      if (f) ok(f);
    });
    document.body.append(input);
    input.click();
  });
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast(`${what} copied`, 'ok', 1600);
}

/** The text inside the ```text fence of a prompt section (what is pasted to the image model), else the whole section. */
const fenced = (md: string) => /```text\n([\s\S]*?)\n```/.exec(md)?.[1] ?? md;
/** Children without the null / false placeholders. */
const nodes = (...k: (Node | string | null | undefined | false)[]) => k.filter((x): x is Node | string => !!x);
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const unprepared = (c: { used: string[]; prepared: boolean; missing?: boolean }) =>
  c.used.length > 0 && !c.prepared && !c.missing;

export class AssetsTab {
  readonly el = h('section', { class: 'tab assets' });
  private data: AssetsListing | null = null;
  private loading: Promise<void> | null = null;
  private sel: Sel | null = null;
  private cell: string | null = null;
  private filter: Filter = 'all';
  private overlayRoom = '';
  private overlay = true;
  private layouts = new Map<string, Layout>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tree = h('nav', { class: 'as-tree', 'aria-label': 'Assets' });
  private center = h('div', { class: 'as-center' });
  private side = h('aside', { class: 'as-side' });
  private prepBtn = h(
    'button',
    { class: 'primary', onclick: () => void this.prepare() },
    'Prepare assets (npm run assets)',
  );
  private prepState = h('span', { class: 'as-chip' });
  private summary = h('span', { class: 'muted small' });
  private drawer = h('details', { class: 'as-drawer', hidden: true });
  private drawerOut = h('pre', { class: 'as-out' });
  private readonly demo = api.mode === 'demo';

  constructor(private ctx: AssetsCtx) {
    this.drawer.append(h('summary', null, 'npm run assets: output'), this.drawerOut);
    this.el.append(
      h(
        'div',
        { class: 'bar as-bar' },
        this.demo
          ? h('span', { class: 'as-hint' }, 'Read-only demo: uploads and Prepare need the dev server (npm run studio).')
          : this.prepBtn,
        this.prepState,
        this.demo ? null : h('button', { onclick: () => this.newSheet() }, 'Upload sheet into a new sheet id…'),
        h('button', { onclick: () => void this.load(true) }, 'Refresh'),
        this.summary,
      ),
      this.drawer,
      h('div', { class: 'as-grid' }, this.tree, this.center, this.side),
    );
    this.center.append(h('p', { class: 'muted pad' }, 'Loading…'));
  }

  /** Loads the listing (once, or again with `force`). */
  load(force = false): Promise<void> {
    if (this.data && !force) return Promise.resolve();
    this.loading ??= (async () => {
      try {
        this.data = await api.assets();
        if (!this.sel) {
          const first = this.data.sheets.find((s) => s.character === this.ctx.info.hero) ?? this.data.sheets[0];
          this.sel = first ? { type: 'sheet', id: first.id } : null;
        }
        this.render();
      } catch (e) {
        this.center.replaceChildren(h('p', { class: 'error pad' }, `The assets do not load: ${(e as Error).message}`));
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** A file of the game changed on disk (SSE): art, audio or the manifest → list again (debounced). */
  onFileChanged(file: string) {
    if (!this.data || !/^(art|audio)\/|^assets\.gen\.json$/.test(file)) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(true), 500);
  }

  // -------------------------------------------------------------- urls

  /** The source file on the dev server; in the demo, the prepared copy in public/assets (if any). */
  private url(x: { file: string; mtime: number; asset?: string }): string | null {
    if (!this.demo)
      return x.file
        ? `/__studio/api/assets/file/${x.file.split('/').map(encodeURIComponent).join('/')}?v=${x.mtime}`
        : null;
    return x.asset ? `${BASE}assets/${x.asset}` : null;
  }

  private sheet(id: string) {
    return this.data?.sheets.find((s) => s.id === id);
  }
  private prompt(id: string): AssetPrompt | undefined {
    return this.data?.prompts.sheets.find((p) => p.id === id);
  }

  // -------------------------------------------------------------- render

  private render() {
    const d = this.data;
    if (!d) return;
    const cells = d.sheets.flatMap((s) => s.cells);
    this.summary.textContent =
      `${plural(d.sheets.length, 'sheet')} · ${plural(cells.filter((c) => !c.missing).length, 'image')} · ${plural(d.decors.length, 'background')} · ${plural(d.sounds.music.length + d.sounds.sfx.length, 'sound')}` +
      (d.missing.length ? ` · ${d.missing.length} missing` : '');
    this.prepState.textContent = d.unprepared ? `${d.unprepared} not prepared` : 'all prepared';
    this.prepState.className = `achip ${d.unprepared ? 'unprep' : 'ok'}`;
    this.renderTree();
    this.renderCenter();
    this.renderSide();
  }

  private badges(cells: (AssetCell | AssetSound)[]): [string, number, string][] {
    const miss = cells.filter((c) => 'missing' in c && c.missing).length;
    const unused = cells.filter((c) => !c.used.length && !('missing' in c && c.missing)).length;
    const unprep = cells.filter(unprepared).length;
    return [
      ['miss', miss, `${miss} missing`],
      ['unprep', unprep, `${unprep} not prepared`],
      ['unused', unused, `${unused} unused`],
    ];
  }

  private renderTree() {
    const d = this.data!;
    const chars = this.ctx.info.characters;
    const entry = (s: AssetSheet) => ({
      sel: { type: 'sheet', id: s.id } as Sel,
      label: s.id,
      badges: this.badges(s.cells),
      sub: s.character
        ? `${chars[s.character]?.name ?? s.character}${s.promptKind === 'poses' ? ' · special poses' : ''}`
        : undefined,
    });
    const charSheets = d.sheets
      .filter((s) => s.kind === 'sprites' && s.character)
      .sort(
        (a, b) =>
          natural(chars[a.character!]?.name ?? a.character!, chars[b.character!]?.name ?? b.character!) ||
          natural(a.id, b.id),
      );
    const groups: Group[] = [
      { title: 'Characters', items: charSheets.map(entry) },
      { title: 'Objects', items: d.sheets.filter((s) => s.kind === 'sprites' && !s.character).map(entry) },
      {
        title: 'Backgrounds',
        items: d.decors.map((x) => ({
          sel: { type: 'decor', id: x.name } as Sel,
          label: x.name.slice(6),
          sub: x.rooms.join(', ') || undefined,
          badges: this.badges([x]),
        })),
        add: this.demo
          ? undefined
          : h('button', { class: 'add small', onclick: () => void this.addDecor() }, '+ background'),
      },
      { title: 'Furniture', items: d.sheets.filter((s) => s.kind === 'furniture').map(entry) },
      { title: 'Talk kits', items: d.sheets.filter((s) => s.kind === 'talk').map(entry) },
      {
        title: 'Sounds',
        items: (['music', 'sfx'] as const).map((k) => ({
          sel: { type: 'sounds', kind: k } as Sel,
          label: k === 'music' ? 'Music' : 'Sound effects',
          sub: plural(d.sounds[k].length, 'file'),
          badges: this.badges(d.sounds[k]),
        })),
      },
    ];
    const same = (a: Sel | null, b: Sel) =>
      !!a &&
      a.type === b.type &&
      (a.type === 'sounds'
        ? a.kind === (b as { kind: string }).kind
        : (a as { id: string }).id === (b as { id: string }).id);
    this.tree.replaceChildren(
      ...groups.map((g) =>
        h(
          'section',
          null,
          h('h3', null, g.title, h('span', { class: 'muted' }, ` ${g.items.length}`), g.add),
          g.items.length
            ? h(
                'ul',
                null,
                g.items.map((it) =>
                  h(
                    'li',
                    null,
                    h(
                      'button',
                      {
                        class: `as-ent${same(this.sel, it.sel) ? ' on' : ''}`,
                        'aria-current': same(this.sel, it.sel) ? 'true' : undefined,
                        onclick: () => {
                          this.sel = it.sel;
                          this.cell = null;
                          this.filter = 'all';
                          this.render();
                        },
                      },
                      h(
                        'span',
                        { class: 'as-label' },
                        h('b', null, it.label),
                        it.sub ? h('small', null, it.sub) : null,
                      ),
                      h(
                        'span',
                        { class: 'as-badges' },
                        it.badges
                          .filter(([, n]) => n > 0)
                          .map(([k, n, t]) => h('span', { class: `as-b ${k}`, title: t }, String(n))),
                      ),
                    ),
                  ),
                ),
              )
            : h('p', { class: 'muted small' }, 'none'),
        ),
      ),
    );
  }

  private renderCenter() {
    const s = this.sel;
    if (!s) {
      this.center.replaceChildren(h('p', { class: 'muted pad' }, 'No asset yet.'));
      return;
    }
    if (s.type === 'sheet') this.renderSheet(s.id);
    else if (s.type === 'decor') void this.renderDecor(s.id);
    else this.renderSounds(s.kind);
  }

  // -------------------------------------------------------------- a sheet

  private shortUse(u: string, s: AssetSheet) {
    const p = s.character ? `cast.${s.character}.` : '';
    return p && u.startsWith(p) ? u.slice(p.length) : u;
  }

  private renderSheet(id: string) {
    const s = this.sheet(id);
    if (!s) {
      this.sel = null;
      this.center.replaceChildren(h('p', { class: 'muted pad' }, `No sheet "${id}".`));
      return;
    }
    const count = (f: Filter) => s.cells.filter((c) => this.keep(c, f)).length;
    const who = s.character ? (this.ctx.info.characters[s.character]?.name ?? s.character) : '';
    const grid = h(
      'div',
      { class: 'as-cells' },
      s.cells.filter((c) => this.keep(c, this.filter)).map((c) => this.cellCard(s, c)),
    );
    this.center.replaceChildren(
      ...nodes(
        h(
          'header',
          { class: 'as-head' },
          h('h2', null, s.id),
          h(
            'span',
            { class: 'muted' },
            [who, s.kind === 'talk' ? 'talk kit' : s.kind, `grid ${s.grid}`].filter(Boolean).join(' · '),
          ),
          h(
            'span',
            { class: 'muted small' },
            `${plural(s.cells.filter((c) => !c.missing).length, 'cell')}, ${count('used')} used`,
          ),
        ),
        this.promptPanel(s),
        h(
          'div',
          { class: 'bar' },
          h(
            'div',
            { class: 'seg', role: 'group', 'aria-label': 'Filter cells' },
            (['all', 'used', 'unused', 'missing'] as Filter[]).map((f) =>
              h(
                'button',
                {
                  class: this.filter === f ? 'on' : undefined,
                  'aria-pressed': String(this.filter === f),
                  onclick: () => {
                    this.filter = f;
                    this.renderSheet(id);
                  },
                },
                `${f.charAt(0).toUpperCase()}${f.slice(1)} (${count(f)})`,
              ),
            ),
          ),
        ),
        grid.childElementCount
          ? grid
          : h(
              'p',
              { class: 'muted' },
              this.filter === 'all'
                ? 'Nothing cut yet: copy the prompt, generate the sheet, then upload it.'
                : `No ${this.filter} cell.`,
            ),
      ),
    );
  }

  private keep(c: AssetCell, f: Filter) {
    return (
      f === 'all' ||
      (f === 'used' && c.used.length > 0 && !c.missing) ||
      (f === 'unused' && !c.used.length && !c.missing) ||
      (f === 'missing' && !!c.missing)
    );
  }

  private cellCard(s: AssetSheet, c: AssetCell) {
    const src = this.url(c);
    const uses = c.used.map((u) => this.shortUse(u, s));
    const state = c.missing ? 'missing' : !c.used.length ? 'unused' : unprepared(c) ? 'unprep' : 'used';
    return h(
      'button',
      {
        class: `as-cell ${state}${this.cell === c.id ? ' on' : ''}`,
        title: c.used.join('\n') || 'not used by the game',
        onclick: () => {
          this.cell = c.id;
          this.renderSheet(s.id);
          this.renderSide();
        },
      },
      h(
        'span',
        { class: 'as-pic' },
        src
          ? h('img', { src, alt: `${s.id}/${c.id}`, loading: 'lazy' })
          : h('span', { class: 'muted small' }, c.missing ? 'missing' : 'no preview'),
      ),
      h(
        'span',
        { class: 'as-meta' },
        h('code', null, c.id),
        state === 'unprep' ? h('span', { class: 'as-b unprep', title: 'not prepared' }, '!') : null,
      ),
      h(
        'span',
        { class: 'as-use' },
        uses.length
          ? `${uses[0]}${uses.length > 1 ? ` +${uses.length - 1}` : ''}`
          : c.missing
            ? 'referenced, no file'
            : 'unused',
      ),
    );
  }

  private promptPanel(s: AssetSheet): HTMLElement {
    const p = this.prompt(s.id);
    const missing = s.cells.filter((c) => c.missing).length;
    const upload = this.demo
      ? null
      : h('button', { class: 'primary', onclick: () => this.uploadDialog(s.id, s.grid) }, 'Upload generated sheet…');
    if (!p) {
      return h(
        'div',
        { class: 'as-prompt panel' },
        h(
          'div',
          { class: 'as-phead flat' },
          h('h3', null, 'Prompt'),
          h(
            'span',
            { class: 'muted small' },
            'No generated prompt for this sheet (the game does not reference it, or its cells are named by hand).',
          ),
          upload,
        ),
      );
    }
    const pre = h('pre', { class: 'as-md' }, p.markdown);
    const show = (e: Event, md: string) => {
      pre.textContent = md;
      const b = e.currentTarget as HTMLElement;
      b.parentElement!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    };
    return h(
      'details',
      { class: 'as-prompt panel' },
      h(
        'summary',
        null,
        h(
          'div',
          { class: 'as-phead' },
          h(
            'h3',
            null,
            'Prompt ',
            h('span', { class: 'muted small' }, `(${p.kind}${missing ? `, ${missing} missing` : ''}: click to show)`),
          ),
          h(
            'button',
            {
              onclick: (e: Event) => {
                e.preventDefault();
                void copy(fenced(p.markdown), 'Prompt');
              },
            },
            'Copy prompt',
          ),
          p.missingMarkdown
            ? h(
                'button',
                {
                  onclick: (e: Event) => {
                    e.preventDefault();
                    void copy(fenced(p.missingMarkdown!), 'Prompt for the missing cells');
                  },
                },
                'Copy prompt for missing cells only',
              )
            : null,
          upload,
        ),
      ),
      p.missingMarkdown
        ? h(
            'div',
            { class: 'seg' },
            h('button', { class: 'on', onclick: (e: Event) => show(e, p.markdown) }, 'Whole sheet'),
            h('button', { onclick: (e: Event) => show(e, p.missingMarkdown!) }, 'Missing cells only'),
          )
        : null,
      pre,
      this.styleDetails(),
      h(
        'p',
        { class: 'muted small' },
        'Copy takes the fenced text block (what goes to the image model); attach the files the section names.',
      ),
    );
  }

  private styleDetails() {
    const style = this.data!.prompts.style;
    return h(
      'details',
      { class: 'as-style' },
      h(
        'summary',
        null,
        'Style block (shared by every prompt) ',
        h(
          'button',
          {
            class: 'small',
            onclick: (e: Event) => {
              e.preventDefault();
              void copy(fenced(style), 'Style block');
            },
          },
          'Copy',
        ),
      ),
      h('pre', { class: 'as-md' }, style),
    );
  }

  // -------------------------------------------------------------- side panel

  private renderSide() {
    const s = this.sel;
    if (s?.type === 'sheet' && this.cell) {
      const sh = this.sheet(s.id);
      const c = sh?.cells.find((x) => x.id === this.cell);
      if (sh && c) {
        this.side.replaceChildren(this.cellPanel(sh, c));
        return;
      }
    }
    if (s?.type === 'decor') {
      const d = this.data?.decors.find((x) => x.name === s.id);
      if (d) {
        this.side.replaceChildren(this.decorPanel(d));
        return;
      }
    }
    this.side.replaceChildren(
      h(
        'div',
        { class: 'as-empty' },
        h(
          'p',
          { class: 'muted' },
          s?.type === 'sounds'
            ? 'Play a sound with its player; Replace keeps the old file as a backup.'
            : 'Click a cell to see it large, where it is used, and to replace it.',
        ),
        h(
          'ul',
          { class: 'as-legend' },
          h('li', null, h('span', { class: 'as-b miss' }, 'n'), ' referenced by the game, no file'),
          h('li', null, h('span', { class: 'as-b unprep' }, 'n'), ' used, not prepared yet (Prepare assets)'),
          h('li', null, h('span', { class: 'as-b unused' }, 'n'), ' cut but not used by the game'),
        ),
      ),
    );
  }

  private usedList(used: string[]) {
    return used.length
      ? h(
          'ul',
          { class: 'as-used' },
          used.map((u) => {
            const room = this.ctx.info.rooms.find((r) => u.startsWith(`${r.id}.`));
            return h(
              'li',
              null,
              h('code', null, u),
              room && this.ctx.openRoom
                ? h('button', { class: 'link', onclick: () => this.ctx.openRoom!(room.id) }, 'Open room')
                : null,
            );
          }),
        )
      : h('p', { class: 'muted small' }, 'Not used by the game.');
  }

  private backupsList(backups: string[], mtime: number) {
    if (!backups.length) return null;
    return h(
      'section',
      null,
      h('h3', null, `Backups (${backups.length})`),
      h(
        'div',
        { class: 'as-backups' },
        backups.map((f) => {
          const src = this.url({ file: f, mtime });
          return h(
            'a',
            { href: src ?? '#', target: '_blank', rel: 'noopener', title: f },
            src && /\.(png|jpe?g|webp|gif)$/i.test(f) ? h('img', { src, alt: f, loading: 'lazy' }) : null,
            h('span', null, f.split('/').pop()),
          );
        }),
      ),
    );
  }

  private cellPanel(s: AssetSheet, c: AssetCell) {
    const src = this.url(c);
    const key = h(
      'select',
      { 'aria-label': 'Background keying', class: 'small' },
      h('option', { value: 'auto' }, 'key a flat background'),
      h('option', { value: 'always' }, 'always key'),
      h('option', { value: 'never' }, 'keep as is'),
    );
    return h(
      'div',
      { class: 'as-panel' },
      h(
        'div',
        { class: 'sheethead' },
        h('h2', null, `${s.id}/${c.id}`),
        h(
          'button',
          {
            class: 'icon',
            title: 'Close',
            onclick: () => {
              this.cell = null;
              this.renderSheet(s.id);
              this.renderSide();
            },
          },
          '✕',
        ),
      ),
      h(
        'div',
        { class: 'as-big' },
        src
          ? h('img', { src, alt: `${s.id}/${c.id}` })
          : h(
              'span',
              { class: 'muted' },
              c.missing ? 'Missing: the game references it, no file yet.' : 'No preview in the demo (not prepared).',
            ),
      ),
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'File'),
        h('dd', null, c.file ? h('code', null, c.file) : '—'),
        c.w ? [h('dt', null, 'Size'), h('dd', null, `${c.w} × ${c.h} px`)] : null,
        h('dt', null, 'Image id'),
        h(
          'dd',
          null,
          c.ids.length
            ? c.ids.map((x) => h('code', null, `${x} `))
            : h('span', { class: 'muted' }, `${s.id}/${c.id} (not referenced)`),
        ),
        h('dt', null, 'Prepared'),
        h(
          'dd',
          null,
          c.missing
            ? '—'
            : !c.used.length
              ? h('span', { class: 'muted' }, 'not needed (unused)')
              : c.prepared
                ? h('span', { class: 'ok' }, '✔ in public/assets')
                : h('span', { class: 'warn' }, 'no: run Prepare assets'),
        ),
      ),
      h('section', null, h('h3', null, 'Used by'), this.usedList(c.used)),
      this.demo
        ? h('p', { class: 'muted small' }, 'Replacing a cell needs the dev server.')
        : h(
            'section',
            null,
            h('h3', null, c.missing ? 'Add the file' : 'Replace'),
            h(
              'div',
              { class: 'bar' },
              h(
                'button',
                {
                  class: 'primary',
                  onclick: () => void this.replaceCell(s, c, key.value as 'auto' | 'always' | 'never'),
                },
                c.missing ? 'Add file…' : 'Replace…',
              ),
              key,
            ),
            h('p', { class: 'muted small' }, c.missing ? '' : 'The current file is kept as a backup first.'),
          ),
      this.backupsList(c.backups, c.mtime),
    );
  }

  private async replaceCell(s: AssetSheet, c: AssetCell, key: 'auto' | 'always' | 'never') {
    const f = await pickFile('image/png,image/jpeg,image/webp');
    try {
      this.ctx.ownWrite();
      const r = await post<CellReplaceResult>('cell', { sheetId: s.id, cell: c.id, data: await readFile(f), key });
      toast(
        `${r.file} ${c.missing ? 'added' : 'replaced'} (${r.keyed})${r.backup ? `, old one kept as ${r.backup.split('/').pop()}` : ''}`,
      );
      await this.load(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  // -------------------------------------------------------------- sheet uploads

  private newSheet() {
    this.uploadDialog('', '6x4');
  }

  /** Upload a generated sheet: sheet id, grid, file → POST assets/sheet; a 409 lists the cells that exist. */
  private uploadDialog(sheetId: string, grid: string) {
    const idIn = h('input', {
      type: 'text',
      value: sheetId,
      placeholder: 'e.g. hero_poses',
      'aria-label': 'Sheet id',
      spellcheck: 'false',
    });
    const gridIn = h('input', { type: 'text', value: grid, 'aria-label': 'Grid (columns x rows)', size: 6 });
    const fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Sheet image' });
    const status = h(
      'p',
      { class: 'muted small' },
      sheetId
        ? 'Cells that already exist are never recut without asking.'
        : 'A new sheet id creates games/<id>/art/<sheet>/.',
    );
    const go = h('button', { class: 'primary' }, 'Upload and cut');
    const body = h(
      'div',
      { class: 'addform' },
      h(
        'div',
        { class: 'row2' },
        h('label', { class: 'field' }, h('span', null, 'Sheet id'), idIn),
        h('label', { class: 'field' }, h('span', null, 'Grid (cols x rows)'), gridIn),
      ),
      h('label', { class: 'field' }, h('span', null, 'Generated image (the flat background is keyed out)'), fileIn),
      status,
      h('div', { class: 'actions' }, go),
    );
    const close = modal(sheetId ? `Upload a generated ${sheetId} sheet` : 'Upload a sheet into a new sheet id', body);
    go.addEventListener('click', async () => {
      const id = idIn.value.trim();
      const f = fileIn.files?.[0];
      if (!/^[A-Za-z0-9][\w-]*$/.test(id) || id === 'decor') {
        status.className = 'error small';
        status.textContent = 'Sheet id: letters, digits, _ and - (not "decor").';
        return;
      }
      if (!/^\d{1,2}x\d{1,2}$/i.test(gridIn.value.trim())) {
        status.className = 'error small';
        status.textContent = 'Grid: COLSxROWS, e.g. 6x4.';
        return;
      }
      if (!f) {
        status.className = 'error small';
        status.textContent = 'Choose the image first.';
        return;
      }
      go.disabled = true;
      status.className = 'muted small';
      status.textContent = 'Cutting…';
      const data = await readFile(f);
      const r = await this.sendSheet({ sheetId: id, grid: gridIn.value.trim().toLowerCase(), data }, body, status);
      go.disabled = false;
      if (r) {
        close();
        this.showCut(id, r);
      }
    });
  }

  /** POST assets/sheet; on 409, asks which existing cells to recut (none checked: only the new cells are cut). */
  private async sendSheet(
    b: { sheetId: string; grid: string; data: string; cells?: string },
    body: HTMLElement,
    status: HTMLElement,
  ): Promise<SheetUploadResult | null> {
    try {
      this.ctx.ownWrite();
      return await post<SheetUploadResult>('sheet', b);
    } catch (e) {
      if (!(e instanceof AssetsApiError) || e.status !== 409) {
        status.className = 'error small';
        status.textContent = (e as Error).message;
        return null;
      }
      const conflicts = (e.body.conflicts as string[]) ?? [];
      // the dialog only sends a grid matching NxM
      const dims = b.grid.split('x').map(Number);
      const cols = must(dims[0], 'grid columns'),
        rows = must(dims[1], 'grid rows');

      const all = Array.from({ length: cols * rows }, (_, i) => `r${Math.floor(i / cols) + 1}c${(i % cols) + 1}`);
      const fresh = all.filter((c) => !conflicts.includes(c));
      const boxes = conflicts.map((c) => h('input', { type: 'checkbox', value: c, 'aria-label': `Recut ${c}` }));
      const sh = this.sheet(b.sheetId);
      status.className = 'warn';
      status.textContent = `${plural(conflicts.length, 'cell')} of ${b.sheetId} already exist. They are kept unless you tick them (a recut keeps the old file as a backup).`;
      return new Promise((ok) => {
        const pick = h(
          'div',
          { class: 'as-conflicts' },
          conflicts.map((c, i) => {
            const cell = sh?.cells.find((x) => x.id === c);
            const src = cell ? this.url(cell) : null;
            return h(
              'label',
              { class: 'as-conf' },
              boxes[i],
              src ? h('img', { src, alt: c }) : null,
              h('code', null, c),
              cell?.used.length ? h('small', null, 'used') : null,
            );
          }),
        );
        const all2 = h(
          'label',
          { class: 'small' },
          h('input', {
            type: 'checkbox',
            onchange: (ev: Event) =>
              boxes.forEach((x) => {
                x.checked = (ev.target as HTMLInputElement).checked;
              }),
          }),
          ' recut all of these cells',
        );
        const cut = h('button', { class: 'primary' }, 'Cut');
        const box = h(
          'div',
          { class: 'addform' },
          pick,
          all2,
          h('p', { class: 'muted small' }, `New cells cut anyway: ${fresh.length ? fresh.join(', ') : 'none'}.`),
          h('div', { class: 'actions' }, cut),
        );
        body.replaceChildren(status, box);
        cut.addEventListener('click', async () => {
          const cells = [...fresh, ...boxes.filter((x) => x.checked).map((x) => x.value)];
          if (!cells.length) {
            status.textContent = 'Nothing to cut: tick a cell to recut, or close.';
            return;
          }
          cut.disabled = true;
          status.className = 'muted small';
          status.textContent = 'Cutting…';
          ok(await this.sendSheet({ ...b, cells: cells.join(',') }, body, status));
        });
      });
    }
  }

  private showCut(sheetId: string, r: SheetUploadResult) {
    toast(`${sheetId}: ${plural(r.written.length, 'cell')} cut`);
    const written = new Set(r.written);
    const body = h(
      'div',
      { class: 'addform' },
      h('pre', { class: 'as-out' }, r.output || 'ok'),
      r.backups.length ? h('p', { class: 'muted small' }, `Backups: ${r.backups.join(', ')}`) : null,
      h(
        'div',
        { class: 'as-cells small' },
        r.cells
          .filter((c) => written.has(c.id))
          .map((c) => {
            const src = this.url(c);
            return h(
              'figure',
              { class: 'as-cut' },
              src ? h('img', { src, alt: c.id }) : null,
              h('figcaption', null, c.id),
            );
          }),
      ),
      h(
        'p',
        { class: 'muted small' },
        `Sheet kept as ${r.file}. Run Prepare assets to see the used cells in the game.`,
      ),
    );
    modal(`Cut result: ${sheetId}`, body);
    this.sel = { type: 'sheet', id: sheetId };
    this.cell = null;
    void this.load(true);
  }

  // -------------------------------------------------------------- decors

  private async renderDecor(name: string) {
    const d = this.data?.decors.find((x) => x.name === name);
    if (!d) {
      this.center.replaceChildren(h('p', { class: 'muted pad' }, `No background "${name}".`));
      return;
    }
    if (!this.overlayRoom || !d.rooms.includes(this.overlayRoom)) this.overlayRoom = d.rooms[0] ?? '';
    const room = this.overlayRoom;
    if (room && !this.layouts.has(room)) {
      try {
        this.layouts.set(room, (await api.room(room)).layout);
      } catch {
        this.layouts.set(room, {});
      }
      if (this.sel?.type !== 'decor' || this.sel.id !== name) return;
    }
    const src = this.url(d);
    const L = room ? this.layouts.get(room) : undefined;
    const roomSel =
      d.rooms.length > 1
        ? h(
            'select',
            {
              'aria-label': 'Room',
              onchange: (e: Event) => {
                this.overlayRoom = (e.target as HTMLSelectElement).value;
                void this.renderDecor(name);
              },
            },
            d.rooms.map((r) => h('option', { value: r, selected: r === room }, r)),
          )
        : null;
    const prompt = this.prompt(name);
    this.center.replaceChildren(
      ...nodes(
        h(
          'header',
          { class: 'as-head' },
          h('h2', null, name),
          h(
            'span',
            { class: 'muted' },
            d.rooms.length
              ? `room${d.rooms.length > 1 ? 's' : ''} ${d.rooms.join(', ')}`
              : 'no room (map, title or credits)',
          ),
          d.w ? h('span', { class: 'muted small' }, `${d.w} × ${d.h} px`) : null,
        ),
        prompt ? this.decorPrompt(prompt) : null,
        h(
          'div',
          { class: 'bar' },
          room
            ? h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: this.overlay,
                  onchange: (e: Event) => {
                    this.overlay = (e.target as HTMLInputElement).checked;
                    void this.renderDecor(name);
                  },
                }),
                " Show the room's spots",
              )
            : null,
          roomSel,
          room && this.ctx.openRoom
            ? h('button', { class: 'link', onclick: () => this.ctx.openRoom!(room) }, `Open ${room} in Rooms`)
            : null,
        ),
        h(
          'div',
          { class: 'as-decor' },
          src
            ? h('img', { src, alt: name })
            : h(
                'div',
                { class: 'nodecor' },
                d.missing ? 'Missing: generate it with the prompt above.' : 'No preview in the demo.',
              ),
          L && this.overlay ? this.overlaySvg(room, L) : null,
        ),
        L && this.overlay
          ? h(
              'p',
              { class: 'muted small' },
              'Dashed band: the empty floor the prompt asks for (58% to 95% of the height). Blue: hotspots; yellow: props (foot and height); green: actors; white: walk area.',
            )
          : null,
      ),
    );
  }

  private decorPrompt(p: AssetPrompt) {
    return h(
      'details',
      { class: 'as-prompt panel' },
      h(
        'summary',
        null,
        h(
          'div',
          { class: 'as-phead' },
          h('h3', null, 'Prompt ', h('span', { class: 'muted small' }, '(click to show)')),
          h(
            'button',
            {
              onclick: (e: Event) => {
                e.preventDefault();
                void copy(fenced(p.markdown), 'Prompt');
              },
            },
            'Copy prompt',
          ),
        ),
      ),
      h('pre', { class: 'as-md' }, p.markdown),
      this.styleDetails(),
    );
  }

  /** The room's hotspots, props, actors and walk area over the decor (logical 640 × 400). */
  private overlaySvg(room: string, L: Layout): SVGSVGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      if (text) e.textContent = text;
      return e;
    };
    const svg = el('svg', {
      viewBox: '0 0 640 400',
      preserveAspectRatio: 'none',
      class: 'as-over',
      role: 'img',
      'aria-label': `Spots of ${room}`,
    }) as SVGSVGElement;
    svg.append(el('rect', { x: 0, y: 232, width: 640, height: 148, class: 'band' }));
    if (L.walk?.area?.length && !L.walkZones)
      svg.append(el('polygon', { points: L.walk.area.map((p) => p.join(',')).join(' '), class: 'walk' }));
    // Several floors (3.4): each zone, and each link as a line between its two ends.
    for (const z of Object.values(L.walkZones ?? {}))
      svg.append(el('polygon', { points: z.area.map((p) => p.join(',')).join(' '), class: 'walk' }));
    for (const [id, k] of Object.entries(L.walkLinks ?? {}))
      svg.append(
        el('line', {
          x1: k.from.at[0],
          y1: k.from.at[1],
          x2: k.to.at[0],
          y2: k.to.at[1],
          class: 'link',
          'data-link': id,
          stroke: '#ffd84d',
          'stroke-width': 2,
          'stroke-dasharray': '4 3',
        }),
      );
    const label = (x: number, y: number, t: string, cls: string) => svg.append(el('text', { x, y, class: cls }, t));
    for (const [id, g] of Object.entries(L.hotspots ?? {})) {
      if (g.rect) {
        svg.append(el('rect', { x: g.rect[0], y: g.rect[1], width: g.rect[2], height: g.rect[3], class: 'hs' }));
        label(g.rect[0] + 3, g.rect[1] + 11, id, 'hst');
      } else if (g.poly?.length) {
        svg.append(el('polygon', { points: g.poly.map((p) => p.join(',')).join(' '), class: 'hs' }));
        const first = must(g.poly[0], 'first point of a hotspot polygon');
        label(first[0] + 3, first[1] + 11, id, 'hst');
      }
    }
    for (const [id, p] of Object.entries(L.props ?? {})) {
      svg.append(
        el('line', { x1: p.x, y1: p.y, x2: p.x, y2: p.y - p.h, class: 'prop' }),
        el('circle', { cx: p.x, cy: p.y, r: 3.5, class: 'propf' }),
      );
      label(p.x + 5, p.y - p.h + 9, id, 'propt');
    }
    for (const [id, a] of Object.entries(L.actors ?? {})) {
      svg.append(el('circle', { cx: a.x, cy: a.y, r: 5, class: 'act' }));
      label(a.x + 7, a.y - 4, id, 'actt');
    }
    return svg;
  }

  private decorPanel(d: AssetDecor) {
    return h(
      'div',
      { class: 'as-panel' },
      h('div', { class: 'sheethead' }, h('h2', null, d.name)),
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'File'),
        h('dd', null, d.file ? h('code', null, d.file) : '—'),
        h('dt', null, 'Prepared'),
        h(
          'dd',
          null,
          d.missing
            ? '—'
            : !d.used.length
              ? h('span', { class: 'muted' }, 'not needed (unused)')
              : d.prepared
                ? h('span', { class: 'ok' }, '✔ in public/assets')
                : h('span', { class: 'warn' }, 'no: run Prepare assets'),
        ),
      ),
      h('section', null, h('h3', null, 'Used by'), this.usedList(d.used)),
      this.demo
        ? h('p', { class: 'muted small' }, 'Replacing a background needs the dev server.')
        : h(
            'section',
            null,
            h('h3', null, d.missing ? 'Add the file' : 'Replace'),
            h(
              'button',
              { class: 'primary', onclick: () => void this.replaceDecor(d.name.slice(6)) },
              d.missing ? 'Add file…' : 'Replace…',
            ),
            h(
              'p',
              { class: 'muted small' },
              'PNG or JPEG, about 1536 × 960 (16:10); the old picture is kept as a backup.',
            ),
          ),
      this.backupsList(d.backups, d.mtime),
    );
  }

  private async replaceDecor(name: string) {
    const f = await pickFile('image/png,image/jpeg');
    try {
      this.ctx.ownWrite();
      const r = await post<UploadResult>('decor', { name, data: await readFile(f) });
      toast(`${r.file} saved${r.backup ? `, old one kept as ${r.backup.split('/').pop()}` : ''}`);
      this.sel = { type: 'decor', id: `decor/${name}` };
      await this.load(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  private async addDecor() {
    const name = prompt('Name of the new background (letters, digits, _ and -): it becomes decor/<name>');
    if (!name) return;
    if (!/^[\w-]+$/.test(name.trim())) {
      toast('Name: letters, digits, _ and -', 'error');
      return;
    }
    await this.replaceDecor(name.trim());
  }

  // -------------------------------------------------------------- sounds

  private renderSounds(kind: 'music' | 'sfx') {
    const list = this.data!.sounds[kind];
    const missing = this.data!.missing.filter((m) => m.startsWith(`audio/${kind}/`));
    this.center.replaceChildren(
      ...nodes(
        h(
          'header',
          { class: 'as-head' },
          h('h2', null, kind === 'music' ? 'Music' : 'Sound effects'),
          h('span', { class: 'muted' }, `games/${this.ctx.info.id}/audio/${kind}/ · ${plural(list.length, 'file')}`),
          this.demo ? null : h('button', { class: 'primary', onclick: () => void this.addSound(kind) }, 'Add sound…'),
        ),
        missing.length
          ? h(
              'p',
              { class: 'error small' },
              `Referenced without a file: ${missing.map((m) => m.split('/').pop()).join(', ')}`,
            )
          : null,
        list.length
          ? h(
              'table',
              { class: 'as-sounds' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, 'File'),
                  h('th', null, 'Play'),
                  h('th', null, 'Used by'),
                  h('th', null, ''),
                ),
              ),
              h(
                'tbody',
                null,
                list.map((s) => this.soundRow(s)),
              ),
            )
          : h(
              'p',
              { class: 'muted' },
              kind === 'music'
                ? 'No music yet. Add a file, then list it in audio.music (game.ts).'
                : 'No sound effect yet.',
            ),
        h(
          'p',
          { class: 'muted small' },
          'Any format ffmpeg reads; Prepare assets encodes what the game references (audio.music / audio.sfx in game.ts). Replace keeps the old file as a backup.',
        ),
      ),
    );
  }

  private soundRow(s: AssetSound) {
    const src = this.url(s);
    return h(
      'tr',
      { class: s.used.length ? undefined : 'unused' },
      h(
        'td',
        null,
        h('code', null, s.id),
        unprepared(s) ? h('span', { class: 'as-b unprep', title: 'not prepared' }, '!') : null,
        s.backups.length
          ? h('div', { class: 'muted small' }, `backups: ${s.backups.map((b) => b.split('/').pop()).join(', ')}`)
          : null,
      ),
      h(
        'td',
        null,
        src
          ? h('audio', { controls: true, preload: 'none', src, 'aria-label': `Play ${s.id}` })
          : h('span', { class: 'muted small' }, 'not prepared'),
      ),
      h(
        'td',
        null,
        s.used.length
          ? s.used.map((u) => h('code', { class: 'as-usechip' }, u))
          : h('span', { class: 'muted small' }, 'unused'),
      ),
      h(
        'td',
        null,
        this.demo ? null : h('button', { class: 'small', onclick: () => void this.replaceSound(s) }, 'Replace…'),
      ),
    );
  }

  private async replaceSound(s: AssetSound) {
    const ext = s.id.slice(s.id.lastIndexOf('.'));
    const f = await pickFile(`audio/*,${ext}`);
    if (!f.name.toLowerCase().endsWith(ext)) {
      toast(`Pick a ${ext} file to replace ${s.id} (or use Add sound for another format).`, 'error');
      return;
    }
    await this.sendSound(s.kind, s.id, f);
  }

  private async addSound(kind: 'music' | 'sfx') {
    const f = await pickFile('audio/*');
    const name = f.name.replace(/[^\w.-]+/g, '_').replace(/^[^A-Za-z0-9_]+/, '');
    if (
      this.data!.sounds[kind].some((x) => x.id === name) &&
      !confirm(`${name} exists: replace it (the old file is kept as a backup)?`)
    )
      return;
    await this.sendSound(kind, name, f);
  }

  private async sendSound(kind: 'music' | 'sfx', file: string, f: File) {
    try {
      this.ctx.ownWrite();
      const r = await post<UploadResult>('sound', { kind, file, data: await readFile(f) });
      toast(`${r.file} saved${r.backup ? `, old one kept as ${r.backup.split('/').pop()}` : ''}`);
      await this.load(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  // -------------------------------------------------------------- prepare

  /** POST assets/prepare?stream=1: `npm run assets` with its output live in the drawer. */
  private async prepare() {
    this.prepBtn.disabled = true;
    this.drawer.hidden = false;
    this.drawer.open = true;
    this.drawerOut.textContent = '$ npm run assets\n';
    let code = 1;
    try {
      const r = await fetch('/__studio/api/assets/prepare?stream=1', { method: 'POST' });
      if (!r.ok || !r.body) throw new Error(`${r.status} ${r.statusText}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.ctx.ownWrite(); // the manifest it rewrites is not an outside change
        this.drawerOut.textContent += dec.decode(value, { stream: true });
        this.drawerOut.scrollTop = this.drawerOut.scrollHeight;
      }
      code = Number(/\[exit (\d+)\]\s*$/.exec(this.drawerOut.textContent ?? '')?.[1] ?? 1);
      toast(code === 0 ? 'Assets prepared' : `npm run assets failed (exit ${code})`, code === 0 ? 'ok' : 'error');
    } catch (e) {
      this.drawerOut.textContent += `\n${(e as Error).message}\n`;
      toast((e as Error).message, 'error');
    } finally {
      this.prepBtn.disabled = false;
    }
    this.ctx.ownWrite();
    await this.load(true);
    if (code === 0) this.ctx.prepared?.();
  }
}
