// npm run page:review [-- --out <dir|file.html>]
// Every cell of every sheet in games/<id>/art/ as a thumbnail, with a keep / redo / unused decision and a note per cell
// (artifact db collection `decide`, doc id `<sheet>__<cell>`). Cells the game references are marked "used", with the
// image ids that cite them (tools/refs.ts); ids the game cites but no file provides are listed as missing.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { collectRefs } from '../refs';
import { cliArgs, docId, esc, imageSource, isImageFile, isMain, jsonForScript, loadContext, outPath, pageShell, persistBar,
  thumbs, writePage, type PageContext } from './lib';

export interface Cell { sheet: string; cell: string; file: string; usedBy: string[] }
export interface Sheet { id: string; cells: Cell[] }

/** Natural order: r2c10 after r2c9. */
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** Image files under a folder, as relative paths (talk kits nest one folder per pose: `<sheet>/<pose>/t1.png`). */
function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir).sort(natural)) {
    if (f.startsWith('.') || f.startsWith('_')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, `${prefix}${f}/`));
    else if (isImageFile(f)) out.push(prefix + f);
  }
  return out;
}

/** Sheets = folders of games/<id>/art (one level, `_`-prefixed and hidden folders skipped), cells = their images. */
export function listSheets(ctx: PageContext): { sheets: Sheet[]; missing: string[] } {
  const art = join(ctx.gameDir, 'art');
  const refs = collectRefs(ctx.mod);
  // Which file each referenced id resolves to (same rules as tools/assets.py, overrides included).
  const byFile = new Map<string, string[]>();
  const missing: string[] = [];
  for (const id of refs.images) {
    const f = imageSource(ctx.gameDir, id);
    if (!f) { missing.push(id); continue; }
    const k = resolve(f);
    byFile.set(k, [...(byFile.get(k) ?? []), id]);
  }
  const sheets: Sheet[] = [];
  if (existsSync(art)) {
    for (const d of readdirSync(art).sort(natural)) {
      if (d.startsWith('.') || d.startsWith('_') || !statSync(join(art, d)).isDirectory()) continue;
      const cells = walk(join(art, d)).map((rel) => {
        const file = resolve(art, d, rel);
        return { sheet: d, cell: rel.slice(0, -extname(rel).length), file, usedBy: byFile.get(file) ?? [] };
      });
      if (cells.length) sheets.push({ id: d, cells });
    }
  }
  // Ids served from public/assets (prepared earlier, source gone) are not "missing", but have no cell either.
  return { sheets, missing };
}

const CSS = `
main { max-width: 1200px; margin: 0 auto; padding: 20px 16px 60px; display: flex; flex-direction: column; gap: 16px; }
.kicker { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: var(--accent); }
h1 { font-size: 26px; line-height: 1.2; }
.lede { color: var(--dim); max-width: 72ch; }
.tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; position: sticky; top: 0; z-index: 2; background: var(--bg); padding: 8px 0; border-bottom: 1px solid var(--line); }
.tools button[aria-pressed=true] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.count { font-size: 13px; color: var(--dim); margin-left: auto; }
.sheet { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.sheet h2 { font-size: 18px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.sheet h2 small { font-size: 13px; color: var(--dim); font-weight: 400; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.cell { background: var(--bg); border: 2px solid var(--line); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.cell[data-choice=keep] { border-color: var(--ok); } .cell[data-choice=redo] { border-color: var(--err); } .cell[data-choice=unused] { border-color: var(--dim); opacity: .8; }
.pic { aspect-ratio: 1; border-radius: 6px; display: grid; place-items: center; overflow: hidden;
  background: repeating-conic-gradient(var(--check1) 0 25%, var(--check2) 0 50%) 0 0 / 16px 16px; }
.pic img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.meta { display: flex; justify-content: space-between; gap: 6px; align-items: center; font-size: 12px; }
.meta code { font-size: 12px; }
.tag { font-size: 10.5px; letter-spacing: .5px; text-transform: uppercase; border-radius: 999px; padding: 1px 7px; font-weight: 700; }
.tag.used { background: color-mix(in srgb, var(--ok) 25%, transparent); color: var(--ok); }
.tag.unref { background: var(--panel2); color: var(--dim); }
.ids { font-size: 11px; color: var(--dim); overflow-wrap: anywhere; min-height: 1em; }
.choice { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.choice label { position: relative; }
.choice input { position: absolute; opacity: 0; inset: 0; }
.choice span { display: block; text-align: center; font-size: 12px; padding: 6px 0; border-radius: 6px; border: 1px solid var(--line); background: var(--panel2); min-height: 32px; }
.choice input:checked + span.k { background: var(--ok); color: var(--bg); border-color: var(--ok); }
.choice input:checked + span.r { background: var(--err); color: var(--bg); border-color: var(--err); }
.choice input:checked + span.u { background: var(--dim); color: var(--bg); border-color: var(--dim); }
.choice input:focus-visible + span { outline: 2px solid var(--accent); }
.cell input[type=text] { width: 100%; font-size: 13px; padding: 5px 7px; }
.missing { background: var(--panel); border: 1px solid var(--err); border-radius: 12px; padding: 14px; }
.missing ul { columns: 3 180px; margin: 8px 0 0; padding-left: 18px; font: 13px ui-monospace, Menlo, monospace; }
.cell.hide, .sheet.hide { display: none; }
`;

const SCRIPT = String.raw`
(function () {
  var cells = {};
  document.querySelectorAll('.cell').forEach(function (c) { cells[c.dataset.key] = c; });
  var timers = {};
  function save(c) {
    var r = c.querySelector('input[type=radio]:checked');
    var v = { choice: r ? r.value : '', note: c.querySelector('input[type=text]').value, sheet: c.dataset.sheet, cell: c.dataset.cell, used: c.dataset.used === '1' };
    c.dataset.choice = v.choice;
    PS.save('decide', c.dataset.key, v, c.querySelector('.state'));
    refresh();
  }
  Object.keys(cells).forEach(function (k) {
    var c = cells[k], n = c.querySelector('input[type=text]');
    c.querySelectorAll('input[type=radio]').forEach(function (r) { r.addEventListener('change', function () { save(c); }); });
    n.addEventListener('input', function () { clearTimeout(timers[k]); timers[k] = setTimeout(function () { save(c); }, 1000); });
    n.addEventListener('blur', function () { clearTimeout(timers[k]); save(c); });
  });
  var filter = 'all';
  function refresh() {
    var shown = 0, n = { keep: 0, redo: 0, unused: 0, none: 0 };
    Object.keys(cells).forEach(function (k) {
      var c = cells[k], ch = c.dataset.choice || '';
      n[ch || 'none']++;
      var ok = filter === 'all' || (filter === 'used' && c.dataset.used === '1') || (filter === 'unref' && c.dataset.used !== '1')
        || (filter === 'none' && !ch) || filter === ch;
      c.classList.toggle('hide', !ok); if (ok) shown++;
    });
    document.querySelectorAll('.sheet').forEach(function (s) { s.classList.toggle('hide', !s.querySelector('.cell:not(.hide)')); });
    document.getElementById('count').textContent = shown + ' shown · ' + n.keep + ' keep · ' + n.redo + ' redo · ' + n.unused + ' unused · ' + n.none + ' undecided';
  }
  document.querySelectorAll('.tools button[data-f]').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.f;
      document.querySelectorAll('.tools button[data-f]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      refresh();
    });
  });
  PS.start({ page: PAGE_KEY, collections: ['decide'], onDoc: function (col, id, v) {
    var c = cells[id]; if (!c) return;
    var r = v.choice && c.querySelector('input[value="' + v.choice + '"]'); if (r) r.checked = true;
    c.dataset.choice = v.choice || '';
    var n = c.querySelector('input[type=text]'); if (document.activeElement !== n && typeof v.note === 'string') n.value = v.note;
    refresh();
  } });
  document.getElementById('ps-export').addEventListener('click', function () {
    PS.exportJson(PAGE_KEY.replace(/[^a-z0-9-]+/gi, '-') + '.json', { page: 'review', game: GAME_ID, exportedAt: new Date().toISOString(), decide: PS.all().decide || {} });
  });
  refresh();
})();
`;

export function buildReview(ctx: PageContext): string {
  const { sheets, missing } = listSheets(ctx);
  const files = sheets.flatMap((s) => s.cells.map((c) => c.file));
  const th = thumbs(files, 160, { trim: true });
  const total = files.length;
  const used = sheets.reduce((n, s) => n + s.cells.filter((c) => c.usedBy.length).length, 0);

  const sheetHtml = sheets.map((s) => {
    const u = s.cells.filter((c) => c.usedBy.length).length;
    return `<section class="sheet" id="s-${esc(docId(s.id))}"><h2>${esc(s.id)} <small>${s.cells.length} cell(s), ${u} used</small></h2><div class="grid">`
      + s.cells.map((c) => {
        const key = docId(`${c.sheet}__${c.cell}`);
        const t = th.get(c.file);
        const name = `d-${key}`;
        return `<div class="cell" data-key="${esc(key)}" data-sheet="${esc(c.sheet)}" data-cell="${esc(c.cell)}" data-used="${c.usedBy.length ? 1 : 0}">`
          + `<div class="pic">${t ? `<img src="${t.uri}" alt="${esc(`${c.sheet}/${c.cell}`)}" loading="lazy" width="${t.w}" height="${t.h}">` : ''}</div>`
          + `<div class="meta"><code>${esc(c.cell)}</code>${c.usedBy.length ? '<span class="tag used">used</span>' : '<span class="tag unref">not used</span>'}</div>`
          + `<div class="ids">${esc(c.usedBy.filter((id) => id !== `${c.sheet}/${c.cell}`).join(', '))}</div>`
          + `<div class="choice" role="radiogroup" aria-label="Decision for ${esc(c.sheet)} ${esc(c.cell)}">`
          + `<label><input type="radio" name="${esc(name)}" value="keep"><span class="k">keep</span></label>`
          + `<label><input type="radio" name="${esc(name)}" value="redo"><span class="r">redo</span></label>`
          + `<label><input type="radio" name="${esc(name)}" value="unused"><span class="u">unused</span></label></div>`
          + `<input type="text" placeholder="Note…" aria-label="Note for ${esc(c.sheet)} ${esc(c.cell)}"><span class="state"></span></div>`;
      }).join('') + '</div></section>';
  }).join('\n');

  const missingHtml = missing.length
    ? `<section class="missing"><h2>Referenced but missing (${missing.length})</h2><p class="lede">The game cites these image ids, but no file provides them yet.</p><ul>${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></section>`
    : '';

  const body = `<main>
<header>
  <p class="kicker">Sprite review · ${esc(ctx.gameId)}</p>
  <h1>${esc(ctx.game.title)}: every cell</h1>
  <p class="lede">${sheets.length} sheet(s), ${total} cell(s), ${used} used by the game. For each cell: keep it, ask for a redo, or mark it unused, and add a note if needed. Everything is saved as you go.</p>
  ${persistBar()}
</header>
<div class="tools" role="toolbar" aria-label="Filter">
  <button type="button" class="btn" data-f="all" aria-pressed="true">All</button>
  <button type="button" class="btn" data-f="used" aria-pressed="false">Used</button>
  <button type="button" class="btn" data-f="unref" aria-pressed="false">Not used</button>
  <button type="button" class="btn" data-f="none" aria-pressed="false">Undecided</button>
  <button type="button" class="btn" data-f="redo" aria-pressed="false">Redo</button>
  <span class="count" id="count"></span>
</div>
${missingHtml}
${sheetHtml || '<p class="lede">No sheet yet: cut one into games/&lt;id&gt;/art/&lt;sheet&gt;/ first.</p>'}
</main>`;
  const script = `var PAGE_KEY = ${jsonForScript(`review:${ctx.gameId}`)}; var GAME_ID = ${jsonForScript(ctx.gameId)};\n${SCRIPT}`;
  return pageShell({ title: `${ctx.game.title} sprite review`.slice(0, 60), description: 'Keep, redo or unused, cell by cell.', css: CSS, body, script });
}

if (isMain(import.meta.url)) {
  const { out } = cliArgs();
  const ctx = await loadContext();
  writePage(outPath(out, 'review.html'), buildReview(ctx));
}
