// The world's map, from the content: rooms are nodes, every way from one room to another is an edge (declared exits,
// `goto` commands anywhere, map places). Pure TypeScript: the validator, the Studio and the `world` page use it.
import type { Cmd, GameDef, Id } from '../core/types';

export interface WorldEdge {
  from: Id;
  to: Id;
  /** `exit` (declared), `goto` (a command in a rule, a topic, a script…), `map` (a place of the world map). */
  kind: 'exit' | 'goto' | 'map';
  /** The exit id, or where the command sits. */
  via: string;
  oneWay?: boolean;
}

export interface WorldGraph {
  rooms: { id: Id; name: string }[];
  edges: WorldEdge[];
  start: Id;
  /** Rooms no edge leads to from the start (ignoring conditions). */
  unreachable: Id[];
  /** Declared exits with no way back to the room they leave (and not marked `oneWay`). */
  oneWay: WorldEdge[];
}

/** `goto` targets in a command list, with their position. */
function gotos(cmds: Cmd[] | undefined, where: string, out: [Id, string][]) {
  cmds?.forEach((c, i) => {
    if (typeof c !== 'object') return;
    const here = `${where}[${i}]`;
    if ('goto' in c) out.push([c.goto, here]);
    else if ('anim' in c) { for (const [i, b] of Object.entries(c.at ?? {})) gotos(b, `${here}.at[${i}]`, out); }
    else if ('if' in c) { gotos(c.then, `${here}.then`, out); gotos(c.else, `${here}.else`, out); }
    else if ('once' in c) gotos(c.once, `${here}.once`, out);
    else if ('nth' in c) c.nth.forEach((b, j) => gotos(b, `${here}.nth[${j}]`, out));
    else if ('cycle' in c) c.cycle.forEach((b, j) => gotos(b, `${here}.cycle[${j}]`, out));
    else if ('random' in c) c.random.forEach((b, j) => gotos(b, `${here}.random[${j}]`, out));
    else if ('parallel' in c) c.parallel.forEach((b, j) => gotos(b, `${here}.parallel[${j}]`, out));
    else if ('cutscene' in c) gotos(c.cutscene, `${here}.cutscene`, out);
    else if ('choice' in c) c.choice.forEach((o, j) => gotos(o.do, `${here}.choice[${j}]`, out));
    else if ('minigame' in c) gotos(c.then, `${here}.then`, out);
    else if ('phone' in c) gotos(c.do, `${here}.phone`, out);
    else if ('ending' in c || 'reveal' in c) gotos(c.after, `${here}.after`, out);
  });
}

export function worldGraph(game: GameDef): WorldGraph {
  const edges: WorldEdge[] = [];
  const ids = new Set(game.rooms.map((r) => r.id));
  for (const r of game.rooms) {
    // Declared exits: the written rules of the room still hold their own gotos (normalizeExits adds rules; the exit
    // itself is what we draw, so the generated "exit" rules are not listed twice).
    const exitTargets = new Set<string>();
    for (const [id, ex] of Object.entries(r.exits ?? {})) { edges.push({ from: r.id, to: ex.to, kind: 'exit', via: id, oneWay: ex.oneWay }); exitTargets.add(`${ex.to}|${id}`); }
    const found: [Id, string][] = [];
    gotos(r.onEnter, 'onEnter', found);
    (r.on ?? []).forEach((rule, i) => { const list: [Id, string][] = []; gotos(rule.do, `on[${i}]`, list);
      // skip the rules generated from exits (same target, rule a = the exit id)
      for (const [to, via] of list) if (!(typeof rule.a === 'string' && exitTargets.has(`${to}|${rule.a}`))) found.push([to, via]); });
    for (const [actor, topics] of Object.entries(r.talk ?? {})) topics.forEach((t, i) => gotos(t.do, `talk.${actor}[${i}]`, found));
    r.scripts?.forEach((sc) => gotos(sc.do, `scripts.${sc.id}`, found));
    r.events?.forEach((ev, i) => gotos(ev.do, `events[${i}]`, found));
    for (const [to, via] of found) if (to !== r.id) edges.push({ from: r.id, to, kind: 'goto', via });
  }
  // Game-wide commands (rules, scripts, events, intro) can move the player from anywhere: edges from every room.
  const global: [Id, string][] = [];
  game.rules.on?.forEach((rule, i) => gotos(rule.do, `rules.on[${i}]`, global));
  game.scripts?.forEach((sc) => gotos(sc.do, `scripts.${sc.id}`, global));
  game.events?.forEach((ev, i) => gotos(ev.do, `events[${i}]`, global));
  gotos(game.start.intro, 'start.intro', global);
  for (const [to, via] of global) for (const r of game.rooms) if (r.id !== to) edges.push({ from: r.id, to, kind: 'goto', via });
  // Map places: reachable from every room once unlocked.
  for (const [pid, p] of Object.entries(game.map?.places ?? {})) {
    if (!ids.has(p.room)) continue;
    for (const r of game.rooms) if (r.id !== p.room) edges.push({ from: r.id, to: p.room, kind: 'map', via: pid });
  }
  // Reachability from the start room.
  const seen = new Set<Id>([game.start.room]);
  const queue = [game.start.room];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) if (e.from === cur && ids.has(e.to) && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
  }
  const unreachable = game.rooms.map((r) => r.id).filter((id) => !seen.has(id));
  const back = (from: Id, to: Id) => edges.some((e) => e.from === to && e.to === from);
  const oneWay = edges.filter((e) => e.kind === 'exit' && !e.oneWay && ids.has(e.to) && !back(e.from, e.to));
  return { rooms: game.rooms.map((r) => ({ id: r.id, name: r.name })), edges, start: game.start.room, unreachable, oneWay };
}

/** The graph in DOT (Graphviz) form. */
export function toDot(g: WorldGraph): string {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const lines = ['digraph world {', '  rankdir=LR; node [shape=box, style=rounded];'];
  for (const r of g.rooms) lines.push(`  ${q(r.id)} [label=${q(r.name)}${r.id === g.start ? ', penwidth=2' : ''}${g.unreachable.includes(r.id) ? ', color=red' : ''}];`);
  const drawn = new Set<string>();
  for (const e of g.edges) {
    if (e.kind === 'map') continue; // the map joins everything: drawn as a note, not as edges
    const k = `${e.from}>${e.to}>${e.kind}`;
    if (drawn.has(k)) continue;
    drawn.add(k);
    lines.push(`  ${q(e.from)} -> ${q(e.to)} [label=${q(e.via)}${e.kind === 'goto' ? ', style=dashed' : ''}];`);
  }
  const places = [...new Set(g.edges.filter((e) => e.kind === 'map').map((e) => e.to))];
  if (places.length) lines.push(`  map [shape=note, label=${q(`map: ${places.join(', ')}`)}];`);
  lines.push('}');
  return lines.join('\n');
}

/**
 * A small SVG of the graph: rooms in columns by distance from the start (breadth first), arrows for exits (solid) and
 * gotos (dashed), rooms on the map marked ◎, unreachable rooms in red. Self-contained (inline styles).
 */
export function toSvg(g: WorldGraph): string {
  const dist = new Map<Id, number>([[g.start, 0]]);
  const queue = [g.start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of g.edges) if (e.from === cur && !dist.has(e.to) && g.rooms.some((r) => r.id === e.to)) { dist.set(e.to, dist.get(cur)! + 1); queue.push(e.to); }
  }
  const maxD = Math.max(0, ...dist.values());
  for (const r of g.rooms) if (!dist.has(r.id)) dist.set(r.id, maxD + 1);
  const cols = new Map<number, Id[]>();
  for (const r of g.rooms) { const d = dist.get(r.id)!; cols.set(d, [...(cols.get(d) ?? []), r.id]); }
  const W = 150, H = 44, GX = 70, GY = 22;
  const pos = new Map<Id, [number, number]>();
  let width = 0, height = 0;
  for (const [d, ids] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, i) => pos.set(id, [20 + d * (W + GX), 20 + i * (H + GY)]));
    width = Math.max(width, 20 + d * (W + GX) + W + 20);
    height = Math.max(height, 20 + ids.length * (H + GY));
  }
  const onMap = new Set(g.edges.filter((e) => e.kind === 'map').map((e) => e.to));
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif" font-size="12">`,
    '<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#888"/></marker></defs>'];
  const drawn = new Set<string>();
  for (const e of g.edges) {
    if (e.kind === 'map') continue;
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const k = `${e.from}>${e.to}`;
    if (drawn.has(k)) continue;
    drawn.add(k);
    const [x1, y1] = [a[0] + (b[0] >= a[0] ? W : 0), a[1] + H / 2], [x2, y2] = [b[0] + (b[0] >= a[0] ? 0 : W), b[1] + H / 2];
    out.push(`<path d="M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="#888" stroke-width="1.5"${e.kind === 'goto' ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#arr)"><title>${esc(`${e.from} → ${e.to} (${e.kind}: ${e.via})`)}</title></path>`);
  }
  for (const r of g.rooms) {
    const [x, y] = pos.get(r.id)!;
    const bad = g.unreachable.includes(r.id);
    out.push(`<g><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8" fill="${bad ? '#fde8e8' : '#f3f4f6'}" stroke="${bad ? '#d33' : r.id === g.start ? '#333' : '#aaa'}" stroke-width="${r.id === g.start ? 2 : 1}"/>`,
      `<text x="${x + 10}" y="${y + 18}" fill="#111" font-weight="600">${esc(r.name)}</text>`,
      `<text x="${x + 10}" y="${y + 34}" fill="#666">${esc(r.id)}${onMap.has(r.id) ? ' ◎' : ''}${bad ? ' · unreachable' : ''}</text></g>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
