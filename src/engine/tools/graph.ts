// The world's map, from the content: rooms are nodes, every way from one room to another is an edge (declared exits,
// `goto` commands anywhere, map places). Pure TypeScript: the validator, the Studio and the `world` page use it.
import type { Cmd, GameDef, Id } from '../core/types';
import { eachCmd } from '../core/cmds';
import { layeredSvg, type SvgEdge, type SvgNode } from './svg';

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
  eachCmd(cmds, (c, path) => {
    if (typeof c === 'object' && 'goto' in c) out.push([c.goto, where + path]);
  });
}

export function worldGraph(game: GameDef): WorldGraph {
  const edges: WorldEdge[] = [];
  const ids = new Set(game.rooms.map((r) => r.id));
  for (const r of game.rooms) {
    // Declared exits: the written rules of the room still hold their own gotos (normalizeExits adds rules; the exit
    // itself is what we draw, so the generated "exit" rules are not listed twice).
    const exitTargets = new Set<string>();
    for (const [id, ex] of Object.entries(r.exits ?? {})) {
      edges.push({ from: r.id, to: ex.to, kind: 'exit', via: id, oneWay: ex.oneWay });
      exitTargets.add(`${ex.to}|${id}`);
    }
    const found: [Id, string][] = [];
    gotos(r.onEnter, 'onEnter', found);
    (r.on ?? []).forEach((rule, i) => {
      const list: [Id, string][] = [];
      gotos(rule.do, `on[${i}]`, list);
      // skip the rules generated from exits (same target, rule a = the exit id)
      for (const [to, via] of list)
        if (!(typeof rule.a === 'string' && exitTargets.has(`${to}|${rule.a}`))) found.push([to, via]);
    });
    for (const [actor, topics] of Object.entries(r.talk ?? {}))
      topics.forEach((t, i) => gotos(t.do, `talk.${actor}[${i}]`, found));
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
  for (const [to, via] of global)
    for (const r of game.rooms) if (r.id !== to) edges.push({ from: r.id, to, kind: 'goto', via });
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
    for (const e of edges)
      if (e.from === cur && ids.has(e.to) && !seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
  }
  const unreachable = game.rooms.map((r) => r.id).filter((id) => !seen.has(id));
  const back = (from: Id, to: Id) => edges.some((e) => e.from === to && e.to === from);
  const oneWay = edges.filter((e) => e.kind === 'exit' && !e.oneWay && ids.has(e.to) && !back(e.from, e.to));
  return {
    rooms: game.rooms.map((r) => ({ id: r.id, name: r.name })),
    edges,
    start: game.start.room,
    unreachable,
    oneWay,
  };
}

/** The graph in DOT (Graphviz) form. */
export function toDot(g: WorldGraph): string {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const lines = ['digraph world {', '  rankdir=LR; node [shape=box, style=rounded];'];
  for (const r of g.rooms)
    lines.push(
      `  ${q(r.id)} [label=${q(r.name)}${r.id === g.start ? ', penwidth=2' : ''}${g.unreachable.includes(r.id) ? ', color=red' : ''}];`,
    );
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
  const onMap = new Set(g.edges.filter((e) => e.kind === 'map').map((e) => e.to));
  const nodes: SvgNode[] = g.rooms.map((r) => {
    const bad = g.unreachable.includes(r.id);
    return {
      id: r.id,
      label: r.name,
      sub: `${r.id}${onMap.has(r.id) ? ' ◎' : ''}${bad ? ' · unreachable' : ''}`,
      fill: bad ? '#fde8e8' : '#f3f4f6',
      stroke: bad ? '#d33' : r.id === g.start ? '#333' : '#aaa',
      strokeWidth: r.id === g.start ? 2 : 1,
    };
  });
  const edges: SvgEdge[] = g.edges
    .filter((e) => e.kind !== 'map')
    .map((e) => ({
      from: e.from,
      to: e.to,
      dashed: e.kind === 'goto',
      title: `${e.from} → ${e.to} (${e.kind}: ${e.via})`,
    }));
  return layeredSvg(nodes, edges, { roots: [g.start] });
}
