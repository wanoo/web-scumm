// npm run page:placement [-- --out <dir|file.html>]
// Phone-friendly placement page: every room's decor (640 × 400 logical) with its props, actors, hotspots, walk area,
// entries and scale lines, draggable by touch or mouse. Saves `{ room, layout }` in the artifact db collection
// `layouts` (doc id = room id) and in localStorage; "Export" gives the same shape as games/<id>/layout/<room>.json.
// Bring the result back with `npm run import-layout <file|dir>`. Simpler than the in-game editor (?edit=<room>):
// no per-state positions; `z`, `on`, `flip`, `flipV` and `rot` are edited in the side panel.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GameDef, Layout, RoomDef } from '../../src/engine/core/types';
import { charImageId, cliArgs, docId, esc, imageSource, isMain, jsonForScript, loadContext, outPath, pageShell, persistBar,
  ROOT, thumbs, writePage, type PageContext } from './lib';

interface Item { kind: 'prop' | 'actor' | 'hotspot'; id: string; name: string; img?: string; aspect?: number; h: number; depth?: boolean }
interface RoomData { id: string; name: string; doc: string; decor?: string; layout: Layout; items: Item[]; hero?: { img?: string; aspect: number; h: number } }

/** The prepared image when the game's manifest has it (same proportions as in the game), else the source file. */
function placeImage(ctx: PageContext, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const man = (ctx.mod.manifest as { images?: Record<string, unknown> } | undefined)?.images;
  const pub = join(ROOT, 'public/assets/img', id + '.webp');
  if (man?.[id] && existsSync(pub)) return pub;
  return imageSource(ctx.gameDir, id);
}

function propImage(r: RoomDef, id: string): string | undefined {
  const p = r.props?.[id];
  if (!p) return undefined;
  return p.img ?? (p.states ? p.states[p.initial ?? Object.keys(p.states)[0]] : undefined);
}

function actorImage(g: GameDef, charId: string, pose = 'idle'): string | undefined {
  const c = g.characters[charId];
  return c?.sprites?.[pose]?.[0] ?? c?.sprites?.idle?.[0] ?? charImageId(c);
}

export function placementData(ctx: PageContext): RoomData[] {
  const g = ctx.game;
  const wanted = new Map<string, string>(); // image id -> file
  const want = (id?: string) => { const f = placeImage(ctx, id); if (id && f) wanted.set(id, f); return f ? id : undefined; };
  const rooms = g.rooms.map((r) => {
    const items: Item[] = [];
    for (const [id, p] of Object.entries(r.props ?? {})) items.push({ kind: 'prop', id, name: p.name ?? id, img: want(propImage(r, id)), h: 60 });
    for (const [id, a] of Object.entries(r.actors ?? {})) {
      const c = g.characters[a.char];
      items.push({ kind: 'actor', id, name: a.name ?? c?.name ?? id, img: want(actorImage(g, a.char, a.pose)), h: c?.height ?? g.skin?.heights?.actor ?? 110, depth: true });
    }
    for (const [id, h] of Object.entries(r.hotspots ?? {})) items.push({ kind: 'hotspot', id, name: h.name ?? id, h: 0 });
    const heroImg = r.hero === false ? undefined : want(actorImage(g, g.hero));
    return { r, items, heroImg, decor: want(r.decor) };
  });
  const sprites = thumbs([...wanted.entries()].filter(([id]) => !id.startsWith('decor/')).map(([, f]) => f), 200);
  const decors = thumbs([...wanted.entries()].filter(([id]) => id.startsWith('decor/')).map(([, f]) => f), 960);
  const uri = (id?: string) => (id ? (id.startsWith('decor/') ? decors : sprites).get(wanted.get(id)!) : undefined);
  return rooms.map(({ r, items, heroImg, decor }) => ({
    id: r.id, name: r.name, doc: docId(r.id), decor: uri(decor)?.uri, layout: ctx.layouts[r.id] ?? {},
    items: items.map((it) => { const t = uri(it.img); return { ...it, img: t?.uri, aspect: t ? t.w / t.h : 0.6 }; }),
    hero: r.hero === false ? undefined : (() => { const t = uri(heroImg); return { img: t?.uri, aspect: t ? t.w / t.h : 0.6, h: g.characters[g.hero]?.height ?? g.skin?.heights?.hero ?? 84 }; })(),
  }));
}

const CSS = `
body { overscroll-behavior: none; }
.app { display: grid; grid-template-columns: minmax(0, 1fr) 280px; height: 100dvh; }
.stagecol { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.top { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.top h1 { font-size: 14px; margin-right: 4px; white-space: nowrap; }
.top select { flex: 1; max-width: 420px; min-width: 0; min-height: 34px; }
.layers { display: flex; gap: 4px; flex-wrap: wrap; }
.layers label { font-size: 12px; border: 1px solid var(--line); border-radius: 999px; padding: 3px 9px; background: var(--panel2); display: inline-flex; gap: 4px; align-items: center; min-height: 30px; cursor: pointer; }
.layers input { accent-color: var(--accent); margin: 0; }
.stage { flex: 1; min-height: 0; display: grid; place-items: center; background: #000; padding: 4px; }
svg#st { width: 100%; height: 100%; max-height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; display: block; }
.side { border-left: 1px solid var(--line); background: var(--panel); overflow-y: auto; padding: 8px 10px 20px; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
.side h2 { font-size: 13px; letter-spacing: 1px; text-transform: uppercase; color: var(--accent); }
.list { display: flex; flex-direction: column; gap: 2px; }
.list button { text-align: left; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 5px 8px; display: flex; gap: 6px; align-items: center; min-height: 32px; }
.list button[aria-current=true] { border-color: var(--accent); background: var(--panel2); }
.list .k { font-size: 10px; text-transform: uppercase; color: var(--dim); width: 52px; flex: none; }
.badge { margin-left: auto; font-size: 10px; font-weight: 700; color: var(--warn); border: 1px solid var(--warn); border-radius: 999px; padding: 0 6px; white-space: nowrap; }
.insp { display: flex; flex-direction: column; gap: 6px; background: var(--panel2); border-radius: 8px; padding: 8px; }
.insp .nm { font-weight: 700; }
.fields { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.fields label { display: flex; flex-direction: column; font-size: 10px; color: var(--dim); }
.fields input { width: 100%; padding: 4px; font-size: 13px; }
.row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.row .btn { min-height: 32px; padding: 4px 10px; font-size: 13px; }
.hint { color: var(--dim); font-size: 12px; }
.ps-bar { font-size: 12px; }
@media (max-width: 700px) and (orientation: portrait) {
  .app { grid-template-columns: 1fr; grid-template-rows: auto auto; height: auto; }
  .stage { aspect-ratio: 8 / 5; flex: none; }
  .stagecol { position: sticky; top: 0; z-index: 2; background: var(--bg); }
  .side { border-left: 0; border-top: 1px solid var(--line); }
}
`;

const SCRIPT = String.raw`
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('st'), sel = document.getElementById('room'), side = document.getElementById('insp'), list = document.getElementById('list');
  var state = {};            // room id -> layout being edited
  ROOMS.forEach(function (r) { state[r.id] = JSON.parse(JSON.stringify(r.layout || {})); });
  var cur = ROOMS[0], selected = null, drag = null, timer = null, vsel = -1;
  var layers = { prop: true, actor: true, hotspot: true, walk: true, entry: true, scale: true };
  var DEF = { walk: [[20, 300], [620, 300], [635, 395], [5, 395]], scale: [[250, 0.8], [396, 1]], entry: [320, 360] };
  var L = function () { return state[cur.id]; };
  var round = function (v) { return Math.round(v); };

  function depth(y) {
    var s = L().scale; if (!s) return 1;
    var t = Math.max(0, Math.min(1, (y - s[0][0]) / (s[1][0] - s[0][0]))); return s[0][1] + (s[1][1] - s[0][1]) * t;
  }
  // Position of an item, and whether it is still "to place" (absent from the layout: shown centred).
  function pos(it) {
    var l = L();
    if (it.kind === 'hotspot') {
      var h = l.hotspots && l.hotspots[it.id];
      if (h && (h.rect || h.poly)) return { v: h, missing: false };
      return { v: Object.assign({}, h || {}, { rect: [280, 160, 80, 80] }), missing: true };
    }
    var m = l[it.kind === 'prop' ? 'props' : 'actors'], p = m && m[it.id];
    if (p) return { v: p, missing: false };
    return { v: { x: 320, y: it.kind === 'prop' ? 300 : 340, h: it.h }, missing: true };
  }
  // Writes an item into the layout (creating it the first time it is moved).
  function own(it) {
    var l = L(), key = it.kind === 'prop' ? 'props' : it.kind === 'actor' ? 'actors' : 'hotspots';
    var m = l[key] = l[key] || {};
    if (!m[it.id] || (it.kind === 'hotspot' && !m[it.id].rect && !m[it.id].poly)) m[it.id] = JSON.parse(JSON.stringify(pos(it).v));
    return m[it.id];
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e); return e;
  }
  function k() { var m = svg.getScreenCTM(); return m ? 1 / m.a : 1; }   // logical units per CSS pixel
  var queue = [];
  // Handles are drawn last, above everything, so a selected item's handles are never covered.
  function handle(x, y, h, color, shape) { queue.push([x, y, h, color, shape]); }
  function drawHandle(x, y, h, color, shape) {
    var r = 8 * k(), hit = 22 * k();
    el('circle', { cx: x, cy: y, r: hit, fill: 'transparent', 'data-h': h });
    if (shape === 'diamond') el('rect', { x: x - r * .8, y: y - r * .8, width: r * 1.6, height: r * 1.6, fill: color, stroke: '#000', 'stroke-width': k() * 1.5, transform: 'rotate(45 ' + x + ' ' + y + ')', 'pointer-events': 'none' });
    else if (shape === 'ring') { el('circle', { cx: x, cy: y, r: r, fill: 'none', stroke: '#000', 'stroke-width': k() * 5, 'pointer-events': 'none' }); el('circle', { cx: x, cy: y, r: r, fill: 'none', stroke: color, 'stroke-width': k() * 3, 'pointer-events': 'none' }); }
    else el('circle', { cx: x, cy: y, r: r, fill: color, stroke: '#000', 'stroke-width': k() * 1.5, 'pointer-events': 'none' });
  }
  function label(x, y, text, color) {
    var t = el('text', { x: x, y: y, fill: color || '#fff', 'font-size': 11 * k(), 'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle',
      stroke: '#000', 'stroke-width': 3 * k(), 'paint-order': 'stroke', 'pointer-events': 'none' }); t.textContent = text;
  }
  function isSel(kind, id) { return selected && selected.kind === kind && selected.id === id; }
  // Effective depth order, as the engine computes it: z, else y + 200 when the prop sits on furniture, else the feet y.
  function zOf(v) { return v.z != null ? v.z : v.on ? v.y + 200 : v.y; }
  function spriteTransform(v, w, dh) {
    var t = [];
    if (v.rot) t.push('rotate(' + v.rot + ' ' + v.x + ' ' + (v.y - dh / 2) + ')');
    if (v.flip) t.push('translate(' + (2 * v.x) + ' 0) scale(-1 1)');
    if (v.flipV) t.push('translate(0 ' + (2 * v.y - dh) + ') scale(1 -1)');
    return t.length ? t.join(' ') : null;
  }

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var l = L(), s = k(), sw = 2 * s;
    var W = l.width || 640;
    svg.setAttribute('viewBox', '0 0 ' + W + ' 400');
    if (cur.decor) el('image', { href: cur.decor, x: 0, y: 0, width: W, height: 400, preserveAspectRatio: 'none' });
    else { el('rect', { x: 0, y: 0, width: W, height: 400, fill: '#2b2e45' }); label(W / 2, 200, 'no decor image'); }
    el('rect', { x: 0, y: 0, width: W, height: 400, fill: 'transparent', 'data-h': 'bg' });
    if (W > 640) for (var cx = 640; cx < W; cx += 640) el('line', { x1: cx, x2: cx, y1: 0, y2: 400, stroke: '#fff', 'stroke-width': s, 'stroke-dasharray': 6 * s, opacity: .5, 'pointer-events': 'none' });
    // Walk area (and holes)
    if (layers.walk) {
      var area = l.walk && l.walk.area || DEF.walk, ghost = !(l.walk && l.walk.area);
      el('polygon', { points: area.join(' '), fill: 'rgba(80,220,140,.15)', stroke: '#5fdc8c', 'stroke-width': sw, 'stroke-dasharray': ghost ? 6 * s : null, 'pointer-events': 'none' });
      ((l.walk && l.walk.holes) || []).forEach(function (h) { el('polygon', { points: h.join(' '), fill: 'rgba(255,90,90,.2)', stroke: '#ff6a6a', 'stroke-width': sw, 'pointer-events': 'none' }); });
      if (isSel('walk', 'walk')) {
        area.forEach(function (p, i) { handle(p[0], p[1], 'wv:-1:' + i, i === vsel ? '#fff' : '#5fdc8c'); });
        ((l.walk && l.walk.holes) || []).forEach(function (h, j) { h.forEach(function (p, i) { handle(p[0], p[1], 'wv:' + j + ':' + i, '#ff6a6a'); }); });
      }
    }
    // Scale lines
    if (layers.scale) {
      var sc = l.scale || DEF.scale;
      sc.forEach(function (row, i) {
        el('line', { x1: 0, x2: W, y1: row[0], y2: row[0], stroke: '#6ab8ff', 'stroke-width': sw, 'stroke-dasharray': (l.scale ? 10 : 4) * s, 'pointer-events': 'none' });
        el('rect', { x: 0, y: row[0] - 12 * s, width: W, height: 24 * s, fill: 'transparent', 'data-h': 'scale:' + i });
        label(600, row[0] - 5 * s, '×' + row[1], '#9fd0ff');
      });
    }
    // Hotspots
    if (layers.hotspot) cur.items.forEach(function (it) {
      if (it.kind !== 'hotspot') return;
      var p = pos(it), v = p.v, on = isSel('hotspot', it.id), color = p.missing ? '#ffb86b' : '#f0c040';
      if (v.poly) {
        el('polygon', { points: v.poly.join(' '), fill: on ? 'rgba(240,192,64,.25)' : 'rgba(240,192,64,.1)', stroke: color, 'stroke-width': sw, 'data-h': 'move:hotspot:' + it.id });
        var c = v.poly.reduce(function (a, q) { return [a[0] + q[0] / v.poly.length, a[1] + q[1] / v.poly.length]; }, [0, 0]);
        label(c[0], c[1], it.name, color);
        if (on) v.poly.forEach(function (q, i) { handle(q[0], q[1], 'pv:' + it.id + ':' + i, color); });
      } else {
        var r = v.rect;
        el('rect', { x: r[0], y: r[1], width: r[2], height: r[3], fill: on ? 'rgba(240,192,64,.25)' : 'rgba(240,192,64,.1)', stroke: color, 'stroke-width': sw,
          'stroke-dasharray': p.missing ? 6 * s : null, 'data-h': 'move:hotspot:' + it.id });
        label(r[0] + r[2] / 2, r[1] + r[3] / 2 + 4 * s, (p.missing ? '? ' : '') + it.name, color);
        if (on) handle(r[0] + r[2], r[1] + r[3], 'size:' + it.id, color);
      }
      if (on && v.approach) handle(v.approach[0], v.approach[1], 'appr:hotspot:' + it.id, '#ff7ad9', 'diamond');
    });
    // Props and actors, back to front
    var sprites = cur.items.filter(function (it) { return it.kind !== 'hotspot' && layers[it.kind]; })
      .map(function (it) { return { it: it, p: pos(it) }; }).sort(function (a, b) { return zOf(a.p.v) - zOf(b.p.v); });
    sprites.forEach(function (o) {
      var it = o.it, v = o.p.v, h = v.h || it.h, dh = it.depth ? h * depth(v.y) : h, w = dh * it.aspect, on = isSel(it.kind, it.id);
      var g = el('g', { opacity: o.p.missing ? .75 : 1 });
      if (it.img) el('image', { href: it.img, x: v.x - w / 2, y: v.y - dh, width: w, height: dh, preserveAspectRatio: 'none',
        transform: spriteTransform(v, w, dh), 'data-h': 'move:' + it.kind + ':' + it.id }, g);
      el('rect', { x: v.x - w / 2, y: v.y - dh, width: w, height: dh, fill: it.img ? 'transparent' : 'rgba(255,255,255,.15)',
        stroke: on ? '#fff' : o.p.missing ? '#ffb86b' : 'rgba(255,255,255,.35)', 'stroke-width': on ? sw : s, 'stroke-dasharray': o.p.missing || !on ? 4 * s : null,
        'data-h': 'move:' + it.kind + ':' + it.id }, g);
      if (o.p.missing || !it.img || on) label(v.x, v.y - dh - (on ? 14 : 4) * s, (o.p.missing ? '? ' : '') + it.name, o.p.missing ? '#ffb86b' : '#fff');
      el('circle', { cx: v.x, cy: v.y, r: 3 * s, fill: '#fff', 'pointer-events': 'none' }, g);
      if (on) {
        handle(v.x, v.y - dh, 'height:' + it.kind + ':' + it.id, '#6ab8ff');
        if (v.approach) handle(v.approach[0], v.approach[1], 'appr:' + it.kind + ':' + it.id, '#ff7ad9', 'diamond');
      }
    });
    // Entries (the hero stands at the default one, at its depth scale, for reference)
    if (layers.entry) {
      var en = l.entries || { 'default': DEF.entry };
      if (cur.hero) {
        var d = en['default'] || DEF.entry, hh = cur.hero.h * depth(d[1]), hw = hh * cur.hero.aspect;
        if (cur.hero.img) el('image', { href: cur.hero.img, x: d[0] - hw / 2, y: d[1] - hh, width: hw, height: hh, opacity: .55, 'pointer-events': 'none' });
      }
      Object.keys(en).forEach(function (id) {
        var q = en[id];
        handle(q[0], q[1], 'entry:' + id, l.entries ? '#c9a0ff' : '#ffb86b', 'ring');
        label(q[0], q[1] + 20 * s, (l.entries ? '' : '? ') + id, '#d8c0ff');
      });
    }
    queue.splice(0).forEach(function (q) { drawHandle.apply(null, q); });
    renderSide();
  }

  // ---- side panel
  function btn(text, fn, cls) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = text; b.onclick = fn; return b; }
  function num(label, value, fn, step) {
    var w = document.createElement('label'); w.textContent = label;
    var i = document.createElement('input'); i.type = 'number'; i.value = value; i.step = step || 1; i.inputMode = 'decimal';
    i.onchange = function () { var v = parseFloat(i.value); if (!isNaN(v)) { fn(v); changed(); } };
    w.appendChild(i); return w;
  }
  function renderSide() {
    list.textContent = '';
    var entries = [{ kind: 'walk', id: 'walk', name: 'Walk area', missing: !(L().walk && L().walk.area) }, { kind: 'scale', id: 'scale', name: 'Scale lines', missing: !L().scale },
      { kind: 'entry', id: 'entries', name: 'Entries', missing: !L().entries }]
      .concat(cur.items.map(function (it) { return { kind: it.kind, id: it.id, name: it.name, missing: pos(it).missing, it: it }; }));
    entries.forEach(function (e) {
      var b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-current', String(isSel(e.kind, e.id)));
      var kk = document.createElement('span'); kk.className = 'k'; kk.textContent = e.kind;
      var nm = document.createElement('span'); nm.textContent = e.name;
      b.append(kk, nm);
      if (e.missing) { var bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = 'to place'; b.append(bd); }
      b.onclick = function () { selected = { kind: e.kind, id: e.id }; vsel = -1; if (layers[e.kind] === false) { layers[e.kind] = true; syncLayers(); } render(); };
      list.appendChild(b);
    });
    side.textContent = '';
    if (!selected) { side.innerHTML = '<p class="hint">Tap something on the decor, or pick it in the list. Drag to move; the blue dot sets a height, the pink diamond the approach point, the corner dot resizes a zone.</p>'; return; }
    var title = document.createElement('p'); title.className = 'nm'; side.appendChild(title);
    var f = document.createElement('div'); f.className = 'fields'; var row = document.createElement('div'); row.className = 'row';
    var it = cur.items.find(function (x) { return x.kind === selected.kind && x.id === selected.id; });
    if (it) {
      var p = pos(it); title.textContent = it.name + ' (' + it.kind + ' ' + it.id + ')' + (p.missing ? ': to place' : '');
      if (it.kind === 'hotspot') {
        if (p.v.rect) ['x', 'y', 'w', 'h'].forEach(function (n, i) { f.appendChild(num(n, p.v.rect[i], function (v) { own(it).rect[i] = round(v); })); });
        else side.appendChild(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Polygon zone: drag its points.' }));
      } else {
        f.appendChild(num('x', p.v.x, function (v) { own(it).x = round(v); }));
        f.appendChild(num('y', p.v.y, function (v) { own(it).y = round(v); }));
        f.appendChild(num('h', p.v.h || it.h, function (v) { own(it).h = round(v); }));
        var flag = function (key, text) {
          var fl = document.createElement('label'); fl.textContent = text;
          var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!p.v[key]; cb.onchange = function () { var o = own(it); if (cb.checked) o[key] = true; else delete o[key]; changed(); };
          fl.appendChild(cb); f.appendChild(fl);
        };
        flag('flip', 'mirror \u2194');
        if (it.kind === 'prop') { flag('flipV', 'mirror \u2195'); flag('on', 'on furniture (z = y + 200)'); }
        // z: empty = automatic (feet y, or y + 200 on furniture); a number forces the depth order
        var zl = document.createElement('label'); zl.textContent = 'z (' + zOf(p.v) + (p.v.z != null ? '' : ' auto') + ')';
        var zi = document.createElement('input'); zi.type = 'number'; zi.step = '1'; zi.placeholder = 'auto'; zi.value = p.v.z != null ? p.v.z : '';
        zi.onchange = function () { var o = own(it); if (zi.value === '') delete o.z; else o.z = round(+zi.value); changed(); };
        zl.appendChild(zi); f.appendChild(zl);
        var zr = document.createElement('div'); zr.className = 'row';
        zr.appendChild(btn('Behind \u2212', function () { var o = own(it); o.z = zOf(o) - 1; changed(); }));
        zr.appendChild(btn('In front +', function () { var o = own(it); o.z = zOf(o) + 1; changed(); }));
        zr.appendChild(btn('Auto z', function () { delete own(it).z; changed(); }));
        f.appendChild(zr);
        if (it.kind === 'prop') f.appendChild(num('rot \u00b0', p.v.rot || 0, function (v) { var o = own(it); if (Math.round(v)) o.rot = round(v); else delete o.rot; }));
      }
      if (p.v.approach) row.appendChild(btn('Remove approach', function () { delete own(it).approach; changed(); }));
      else row.appendChild(btn('Add approach', function () {
        var o = own(it), base = o.rect ? [o.rect[0] + o.rect[2] / 2, Math.min(390, o.rect[1] + o.rect[3] + 20)] : o.poly ? [o.poly[0][0], Math.min(390, o.poly[0][1] + 20)] : [o.x, Math.min(390, o.y + 15)];
        o.approach = base.map(round); changed();
      }));
      if (!p.missing) row.appendChild(btn('Unplace', function () {
        var key = it.kind === 'prop' ? 'props' : it.kind === 'actor' ? 'actors' : 'hotspots'; var o = L()[key][it.id];
        if (it.kind === 'hotspot') { delete o.rect; delete o.poly; if (!Object.keys(o).length) delete L()[key][it.id]; } else delete L()[key][it.id];
        changed();
      }));
    } else if (selected.kind === 'walk') {
      title.textContent = 'Walk area' + (L().walk && L().walk.area ? '' : ': to place (drag a point to create it)');
      side.appendChild(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Drag the green points. Tap a point to select it (white), then add a point after it or delete it.' }));
      row.appendChild(btn('Add point', function () {
        var a = ownWalk(), i = vsel >= 0 ? vsel : a.length - 1, n = a[(i + 1) % a.length];
        a.splice(i + 1, 0, [round((a[i][0] + n[0]) / 2), round((a[i][1] + n[1]) / 2)]); vsel = i + 1; changed();
      }));
      row.appendChild(btn('Delete point', function () { var a = ownWalk(); if (vsel >= 0 && a.length > 3) { a.splice(vsel, 1); vsel = -1; changed(); } }));
    } else if (selected.kind === 'scale') {
      title.textContent = 'Scale lines' + (L().scale ? '' : ': to place');
      var sc = L().scale || DEF.scale;
      [0, 1].forEach(function (i) {
        f.appendChild(num((i ? 'front' : 'back') + ' y', sc[i][0], function (v) { ownScale()[i][0] = round(v); }));
        f.appendChild(num('scale', sc[i][1], function (v) { ownScale()[i][1] = Math.round(v * 100) / 100; }, 0.05));
      });
      side.appendChild(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Characters are drawn at "scale" × their height on each line. Drag a blue line to move it.' }));
    } else if (selected.kind === 'entry') {
      title.textContent = 'Entries' + (L().entries ? '' : ': to place');
      side.appendChild(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Where the hero appears when coming in. The faded hero stands on "default", at its scale.' }));
    }
    if (f.children.length) side.appendChild(f);
    if (row.children.length) side.appendChild(row);
  }
  function ownWalk() { var l = L(); l.walk = l.walk || {}; if (!l.walk.area) l.walk.area = JSON.parse(JSON.stringify(DEF.walk)); return l.walk.area; }
  function ownScale() { var l = L(); if (!l.scale) l.scale = JSON.parse(JSON.stringify(DEF.scale)); return l.scale; }

  // ---- dragging (pointer capture on the svg itself: the scene is redrawn on every move)
  function pt(e) { var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; var q = p.matrixTransform(svg.getScreenCTM().inverse()); return [Math.max(0, Math.min(L().width || 640, q.x)), Math.max(0, Math.min(400, q.y))]; }
  svg.addEventListener('pointerdown', function (e) {
    var h = e.target.getAttribute && e.target.getAttribute('data-h'); if (!h) return;
    var a = h.split(':'), p = pt(e);
    if (h === 'bg') { selected = null; render(); return; }
    e.preventDefault();
    drag = { kind: a[0], a: a, start: p, moved: false };
    if (a[0] === 'move') {
      selected = { kind: a[1], id: a[2] };
      var it = cur.items.find(function (x) { return x.kind === a[1] && x.id === a[2]; });
      drag.it = it; drag.orig = JSON.parse(JSON.stringify(pos(it).v));
    } else if (a[0] === 'wv') { if (+a[1] < 0) vsel = +a[2]; }
    else if (a[0] === 'scale') selected = { kind: 'scale', id: 'scale' };
    else if (a[0] === 'entry') selected = { kind: 'entry', id: 'entries' };
    else drag.it = cur.items.find(function (x) { return x.id === a[a.length - (a[0] === 'pv' ? 2 : 1)] && (a[0] === 'size' || a[0] === 'pv' ? x.kind === 'hotspot' : x.kind === a[1]); });
    svg.setPointerCapture(e.pointerId);
    render();
  });
  svg.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var p = pt(e), dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) < 2 * k()) return;
    drag.moved = true;
    var a = drag.a, it = drag.it, o;
    if (a[0] === 'move') {
      o = own(it); var v = drag.orig;
      if (v.rect && o.rect) o.rect = [round(v.rect[0] + dx), round(v.rect[1] + dy), v.rect[2], v.rect[3]];
      else if (v.poly && o.poly) o.poly = v.poly.map(function (q) { return [round(q[0] + dx), round(q[1] + dy)]; });
      else { o.x = round(v.x + dx); o.y = round(v.y + dy); if (o.h == null) o.h = it.h; }
    } else if (a[0] === 'height') {
      o = own(it); var dd = it.depth ? depth(o.y) : 1; o.h = Math.max(4, round((o.y - p[1]) / dd));
    } else if (a[0] === 'appr') { o = own(it); o.approach = [round(p[0]), round(p[1])]; }
    else if (a[0] === 'size') { o = own(it); o.rect[2] = Math.max(8, round(p[0] - o.rect[0])); o.rect[3] = Math.max(8, round(p[1] - o.rect[1])); }
    else if (a[0] === 'pv') { o = own(it); o.poly[+a[2]] = [round(p[0]), round(p[1])]; }
    else if (a[0] === 'wv') { var arr = +a[1] < 0 ? ownWalk() : L().walk.holes[+a[1]]; arr[+a[2]] = [round(p[0]), round(p[1])]; }
    else if (a[0] === 'scale') { ownScale()[+a[1]][0] = round(p[1]); }
    else if (a[0] === 'entry') { var l = L(); l.entries = l.entries || { 'default': DEF.entry.slice() }; l.entries[a[1]] = [round(p[0]), round(p[1])]; }
    render();
  });
  function end() { if (drag && drag.moved) changed(true); drag = null; }
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);

  // ---- persistence
  function clean(l) { return JSON.parse(JSON.stringify(l)); }
  function changed(fromDrag) {
    if (!fromDrag) render(); else renderSide();
    var room = cur, el = document.getElementById('savestate');
    el.textContent = 'Modified…'; el.className = 'state';
    clearTimeout(timer); timer = setTimeout(function () { PS.save('layouts', room.doc, { room: room.id, layout: clean(state[room.id]) }, el); }, 700);
  }
  PS.start({ page: PAGE_KEY, collections: ['layouts'], onDoc: function (col, id, v) {
    var r = ROOMS.find(function (x) { return x.doc === id || x.id === v.room; });
    if (!r || !v.layout || (drag && r === cur)) return;
    state[r.id] = clean(v.layout);
    if (r === cur) render();
  } });

  // ---- controls
  ROOMS.forEach(function (r) { var o = document.createElement('option'); o.value = r.id; o.textContent = r.name + ' (' + r.id + ')'; sel.appendChild(o); });
  try { var last = localStorage.getItem(PAGE_KEY + ':room'); if (last && state[last]) sel.value = last; } catch (e) {}
  cur = ROOMS.find(function (r) { return r.id === sel.value; }) || ROOMS[0];
  sel.onchange = function () { cur = ROOMS.find(function (r) { return r.id === sel.value; }); selected = null; try { localStorage.setItem(PAGE_KEY + ':room', cur.id); } catch (e) {} render(); };
  function syncLayers() { document.querySelectorAll('.layers input').forEach(function (i) { i.checked = layers[i.value]; }); }
  document.querySelectorAll('.layers input').forEach(function (i) { i.onchange = function () { layers[i.value] = i.checked; render(); }; });
  document.getElementById('ps-export').onclick = function () {
    var all = {}; ROOMS.forEach(function (r) { all[r.id] = clean(state[r.id]); });
    PS.exportJson(GAME_ID + '-layouts.json', { layouts: all });
  };
  document.getElementById('exp-room').onclick = function () { PS.exportJson(cur.id + '.json', clean(L())); };
  document.getElementById('reset').onclick = function () {
    if (!confirm('Go back to the layout of the file for ' + cur.name + '?')) return;
    state[cur.id] = clean(cur.layout); selected = null; changed();
  };
  window.addEventListener('resize', render);
  render();
})();
`;

export function buildPlacement(ctx: PageContext): string {
  const rooms = placementData(ctx);
  const body = `<div class="app">
<div class="stagecol">
  <div class="top">
    <h1>Placement</h1>
    <select id="room" aria-label="Room"></select>
  </div>
  <div class="stage"><svg id="st" viewBox="0 0 640 400" aria-label="Room decor"></svg></div>
</div>
<aside class="side">
  ${persistBar()}
  <div class="row"><button type="button" class="btn primary" id="exp-room">Export room</button><button type="button" class="btn" id="reset">Reset room</button><span id="savestate" class="state"></span></div>
  <div class="insp" id="insp"></div>
  <div class="layers" aria-label="Show">
    ${[['prop', 'props'], ['actor', 'actors'], ['hotspot', 'zones'], ['walk', 'walk area'], ['entry', 'entries'], ['scale', 'scale']].map(([v, l]) => `<label><input type="checkbox" value="${v}" checked>${l}</label>`).join('')}
  </div>
  <h2>In this room</h2>
  <div class="list" id="list"></div>
  <p class="hint">${esc(ctx.game.title)} · ${rooms.length} room(s). "to place" = not in the layout yet: shown in the middle, saved once moved.</p>
</aside>
</div>`;
  const script = `var PAGE_KEY = ${jsonForScript(`placement:${ctx.gameId}`)}; var GAME_ID = ${jsonForScript(ctx.gameId)}; var ROOMS = ${jsonForScript(rooms)};\n${SCRIPT}`;
  return pageShell({ title: `${ctx.game.title} placement`.slice(0, 60), description: 'Drag props, actors, zones and the walk area of each room.', css: CSS, body, script });
}

if (isMain(import.meta.url)) {
  const { out } = cliArgs();
  const ctx = await loadContext();
  writePage(outPath(out, 'placement.html'), buildPlacement(ctx));
}

