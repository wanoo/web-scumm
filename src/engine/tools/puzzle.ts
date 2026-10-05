// The puzzle graph, from the content: what each rule, topic, script and listener needs (conditions, items) and what it
// changes (items, flags, props, places, events, rooms, characters moved). Pure TypeScript: the validator, the Studio's
// Check tab, the `puzzles` page and the `puzzle_graph` tool read it. "Where does the key come from, what does it open,
// what depends on it" is one lookup (`puzzleFor`).
import type { Cmd, Cond, GameDef, Id, RoomDef } from '../core/types';
import { condAtoms, type CondAtom } from '../core/cond';
import { eachCmd } from '../core/cmds';
import { normalizeExits } from '../core/define';
import { listenerActionId, ruleActionId, topicActionId } from '../core/content-ids';
import { esc, layeredSvg, type SvgEdge, type SvgNode } from './svg';

/** State nodes (what the world is) and action nodes (what changes it). */
export type PuzzleKind =
  | 'item'
  | 'flag'
  | 'prop'
  | 'room'
  | 'player'
  | 'place'
  | 'event'
  | 'actor'
  | 'end'
  | 'rule'
  | 'topic'
  | 'script'
  | 'listener'
  | 'goal';
export const STATE_KINDS: ReadonlySet<PuzzleKind> = new Set<PuzzleKind>([
  'item',
  'flag',
  'prop',
  'room',
  'player',
  'place',
  'event',
  'actor',
  'end',
]);

export interface PuzzleNode {
  id: string;
  kind: PuzzleKind;
  label: string /** The room (actions), or where it is defined. */;
  where?: string;
}
export interface PuzzleEdge {
  from: string;
  to: string;
  /** `requires`: a gate of the action (its `if`, the items it takes); `reads`: a condition inside its commands; `produces` / `consumes`: an effect. */
  kind: 'requires' | 'reads' | 'produces' | 'consumes';
  detail?: string;
}
export interface PuzzleGraph {
  nodes: PuzzleNode[];
  edges: PuzzleEdge[];
}

const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** `commands`: the game's custom commands (their declared `effects` count as effects). */
export function puzzleGraph(
  gameIn: GameDef,
  opts: { commands?: Record<string, { effects?: unknown[] }> } = {},
): PuzzleGraph {
  const game = normalizeExits(structuredClone(gameIn));
  const nodes = new Map<string, PuzzleNode>();
  const edges: PuzzleEdge[] = [];
  const node = (kind: PuzzleKind, name: string, label = name, where?: string) => {
    const id = `${kind}:${name}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, ...(where ? { where } : {}) });
    return id;
  };
  const edge = (from: string, to: string, kind: PuzzleEdge['kind'], detail?: string) => {
    if (!edges.some((e) => e.from === from && e.to === to && e.kind === kind && e.detail === detail))
      edges.push({ from, to, kind, ...(detail ? { detail } : {}) });
  };
  const itemLabel = (id: Id) => game.items[id]?.name ?? id;
  const atomNode = (a: CondAtom): string => {
    switch (a.kind) {
      case 'has':
        return node('item', a.id, itemLabel(a.id));
      case 'flag':
        return node('flag', a.id);
      case 'seen':
        return node('flag', `seen:${a.id}`, `seen ${a.id}`);
      case 'prop':
        return node('prop', a.id);
      case 'visited':
      case 'room':
        return node('room', a.id, game.rooms.find((r) => r.id === a.id)?.name ?? a.id);
      case 'unlocked':
        return node('place', a.id, game.map?.places?.[a.id]?.name ?? a.id);
      case 'actorIn':
        return node('actor', a.id);
      case 'player':
        return node('player', a.id, game.characters[a.id]?.name ?? a.id);
    }
  };
  const requires = (
    action: string,
    c: Cond | undefined,
    room: RoomDef | undefined,
    kind: 'requires' | 'reads' = 'requires',
  ) => {
    for (const a of condAtoms(c, room?.id))
      edge(
        atomNode(a),
        action,
        kind,
        `${a.neg ? 'not ' : ''}${a.kind === 'visited' ? 'visited' : ''}${a.detail ?? ''}`.trim() || undefined,
      );
  };
  const effects = (action: string, cmds: Cmd[] | undefined, room: RoomDef | undefined) =>
    eachCmd(cmds, (c) => {
      if (typeof c === 'string') return;
      if ('if' in c) requires(action, c.if, room, 'reads');
      else if ('choice' in c) c.choice.forEach((o) => requires(action, o.if, room, 'reads'));
      else if ('waitUntil' in c) requires(action, c.waitUntil, room);
      else if ('waitEvent' in c) edge(node('event', c.waitEvent), action, 'requires');
      else if ('gain' in c) edge(action, node('item', c.gain, itemLabel(c.gain)), 'produces');
      else if ('lose' in c) edge(action, node('item', c.lose, itemLabel(c.lose)), 'consumes');
      else if ('used' in c)
        asList(c.used).forEach((u) => edge(action, node('item', u, itemLabel(u)), 'consumes', 'used'));
      else if ('set' in c)
        edge(
          action,
          node('flag', Array.isArray(c.set) ? c.set[0] : c.set),
          'produces',
          Array.isArray(c.set) ? `= ${JSON.stringify(c.set[1])}` : undefined,
        );
      else if ('unset' in c) edge(action, node('flag', c.unset), 'consumes');
      else if ('inc' in c) edge(action, node('flag', c.inc), 'produces', `${(c.by ?? 1) < 0 ? '' : '+'}${c.by ?? 1}`);
      else if ('prop' in c)
        edge(
          action,
          node('prop', c.prop[0].includes('.') || !room ? c.prop[0] : `${room.id}.${c.prop[0]}`),
          'produces',
          c.prop[1],
        );
      else if ('unlock' in c)
        edge(action, node('place', c.unlock, game.map?.places?.[c.unlock]?.name ?? c.unlock), 'produces');
      else if ('goto' in c)
        edge(action, node('room', c.goto, game.rooms.find((r) => r.id === c.goto)?.name ?? c.goto), 'produces', 'goto');
      else if ('emit' in c) edge(action, node('event', c.emit), 'produces');
      else if ('moveActor' in c) edge(action, node('actor', `${c.moveActor[0]}@${c.moveActor[1]}`), 'produces');
      else if ('switchPlayer' in c)
        edge(
          action,
          node('player', c.switchPlayer, game.characters[c.switchPlayer]?.name ?? c.switchPlayer),
          'produces',
        );
      else if ('transfer' in c)
        edge(action, node('item', c.transfer[0], itemLabel(c.transfer[0])), 'produces', `to ${c.transfer[1]}`);
      else if ('startScript' in c)
        edge(action, node('script', c.startScript, `script ${c.startScript}`), 'produces', 'start');
      else if ('stopScript' in c)
        edge(action, node('script', c.stopScript, `script ${c.stopScript}`), 'consumes', 'stop');
      else if ('end' in c || 'ending' in c || 'reveal' in c) edge(action, node('end', 'end', 'the end'), 'produces');
      else if ('custom' in c) effects(action, opts.commands?.[c.custom]?.effects as Cmd[] | undefined, room);
    });

  // The first written rule that matches answers (Engine.findRule: the room's rules, then the game's): an earlier rule
  // that can answer the same action shadows a later one while its condition holds, so the later one also depends on
  // that condition. Without these edges, a flag that only gates a shadowing rule looked dead, and the solver merged
  // states where different rules answer (found by the random games of tests/audit.test.ts).
  const overlaps = (x: { verb: Id | Id[]; a?: Id | Id[]; b?: Id | Id[] }, y: typeof x) => {
    const meet = (p: Id[], q: Id[]) => p.some((v) => q.includes(v));
    const bs = (r: typeof x) => (r.b === undefined ? ['\u0000'] : asList(r.b));
    if (!meet(asList(x.verb), asList(y.verb))) return false;
    return (
      (meet(asList(x.a), asList(y.a)) && meet(bs(x), bs(y))) ||
      (x.b !== undefined && y.b !== undefined && meet(asList(x.a), asList(y.b)) && meet(asList(x.b), asList(y.a)))
    );
  };
  const shadowing = (list: { rule: NonNullable<RoomDef['on']>[number]; id: string; room?: RoomDef }[]) =>
    list.forEach((later, j) => {
      for (const earlier of list.slice(0, j))
        if (overlaps(earlier.rule, later.rule)) requires(later.id, earlier.rule.if, earlier.room, 'reads');
    });
  const gameRules = (game.rules.on ?? []).map((rule, i) => ({ rule, id: ruleActionId('game', i, rule) }));
  for (const r of game.rooms)
    shadowing([...(r.on ?? []).map((rule, i) => ({ rule, id: ruleActionId(r.id, i, rule), room: r })), ...gameRules]);
  if (!game.rooms.length) shadowing(gameRules);

  for (const r of game.rooms) {
    if (r.onEnter?.length) {
      const a = node('rule', `${r.id}/enter`, `enter ${r.name}`, r.id);
      effects(a, r.onEnter, r);
    }
    (r.on ?? []).forEach((rule, i) => {
      const verb = asList(rule.verb).join('/');
      const a = ruleActionId(r.id, i, rule);
      node(
        'rule',
        a.slice('rule:'.length),
        `${verb} ${asList(rule.a).join('|')}${rule.b ? ` + ${asList(rule.b).join('|')}` : ''}`,
        r.id,
      );
      requires(a, rule.if, r);
      for (const t of [...asList(rule.a), ...asList(rule.b)]) {
        if (game.items[t]) edge(node('item', t, itemLabel(t)), a, 'requires', verb);
        // A hidden target cannot be acted on: its visibility gates the rule.
        const vis = r.hotspots?.[t]?.visible ?? r.props?.[t]?.visible ?? r.actors?.[t]?.visible;
        if (vis !== undefined) requires(a, vis as Cond, r);
      }
      effects(a, rule.do, r);
    });
    for (const [actor, topics] of Object.entries(r.talk ?? {}))
      topics.forEach((t, i) => {
        const a = node(
          'topic',
          topicActionId(r.id, actor, i, t).slice('topic:'.length),
          `${actor}: "${t.topic}"`,
          r.id,
        );
        requires(a, t.if, r);
        effects(a, t.do, r);
      });
    (r.scripts ?? []).forEach((sc) => {
      const a = node('script', sc.id, `script ${sc.id}`, r.id);
      requires(a, sc.while, r);
      effects(a, sc.do, r);
    });
    (r.events ?? []).forEach((ev, i) => {
      const a = node('listener', listenerActionId(r.id, i, ev).slice('listener:'.length), `on ${ev.on}`, r.id);
      edge(node('event', ev.on), a, 'requires');
      requires(a, ev.if, r);
      effects(a, ev.do, r);
    });
  }
  (game.rules.on ?? []).forEach((rule, i) => {
    const verb = asList(rule.verb).join('/');
    const a = ruleActionId('game', i, rule);
    node(
      'rule',
      a.slice('rule:'.length),
      `${verb} ${asList(rule.a).join('|')}${rule.b ? ` + ${asList(rule.b).join('|')}` : ''}`,
      'game',
    );
    requires(a, rule.if, undefined);
    for (const t of [...asList(rule.a), ...asList(rule.b)])
      if (game.items[t]) edge(node('item', t, itemLabel(t)), a, 'requires', verb);
    effects(a, rule.do, undefined);
  });
  (game.scripts ?? []).forEach((sc) => {
    const a = node('script', sc.id, `script ${sc.id}`, 'game');
    requires(a, sc.while, undefined);
    effects(a, sc.do, undefined);
  });
  (game.events ?? []).forEach((ev, i) => {
    const a = node('listener', listenerActionId('game', i, ev).slice('listener:'.length), `on ${ev.on}`, 'game');
    edge(node('event', ev.on), a, 'requires');
    requires(a, ev.if, undefined);
    effects(a, ev.do, undefined);
  });
  if (game.start.intro?.length || game.start.inventory?.length || game.start.flags) {
    const a = node('rule', 'game/start', 'start', 'game');
    (game.start.inventory ?? []).forEach((it) => edge(a, node('item', it, itemLabel(it)), 'produces'));
    Object.entries(game.start.flags ?? {}).forEach(([k, v]) =>
      edge(a, node('flag', k), 'produces', `= ${JSON.stringify(v)}`),
    );
    effects(a, game.start.intro, undefined);
  }
  for (const [id, cp] of Object.entries(game.checkpoints ?? {}))
    if (cp.goals?.length) {
      const a = node('goal', id, `goal ${id}`, cp.room);
      cp.goals.forEach((c) => requires(a, c, undefined));
    }
  (game.invariants ?? []).forEach((c, i) =>
    requires(node('goal', `invariant[${i}]`, `invariant #${i}`, 'game'), c, undefined),
  );
  return { nodes: [...nodes.values()], edges };
}

/** The node id of a condition atom, as `puzzleGraph` names it. */
export function atomNodeId(a: CondAtom): string {
  switch (a.kind) {
    case 'has':
      return `item:${a.id}`;
    case 'flag':
      return `flag:${a.id}`;
    case 'seen':
      return `flag:seen:${a.id}`;
    case 'prop':
      return `prop:${a.id}`;
    case 'visited':
    case 'room':
      return `room:${a.id}`;
    case 'unlocked':
      return `place:${a.id}`;
    case 'actorIn':
      return `actor:${a.id}`;
    case 'player':
      return `player:${a.id}`;
  }
}

export interface Liveness {
  /** Things that can still change the outcome: something live reads them. */
  flags: Set<string>;
  items: Set<string>;
  props: Set<string>;
  /** Characters whose room a live condition reads (`actorIn`). */
  actors: Set<string>;
  /** Actions whose effects reach something live (script ids bare, the others as node ids). */
  actions: Set<string>;
  /** Every live node id. */
  nodes: Set<string>;
  /** The edge that made a node live (none for a seed): the chain `whyLive` follows. */
  because: Map<string, PuzzleEdge>;
}

/** The conditions the solver reads outside the content: the ending's guess flag and every `visible` condition. */
export function extraReads(game: GameDef, goal?: Cond[]): CondAtom[] {
  const extra: CondAtom[] = [];
  for (const c of goal ?? []) condAtoms(c, undefined, extra);
  if (game.ending?.guess) extra.push({ kind: 'flag', id: game.ending.guess.flag });
  const find = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      v.forEach(find);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'visible') condAtoms(x as Cond, undefined, extra);
      find(x);
    }
  };
  find(game.rooms);
  return extra;
}

/** The backward fixpoint from the seeds: a node is live when an edge of it reaches a live node. */
function liveFrom(g: PuzzleGraph, seeds: Iterable<string>): { live: Set<string>; because: Map<string, PuzzleEdge> } {
  const live = new Set<string>(seeds);
  const because = new Map<string, PuzzleEdge>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of g.edges)
      if (live.has(e.to) && !live.has(e.from)) {
        live.add(e.from);
        because.set(e.from, e);
        changed = true;
      }
  }
  return { live, because };
}

const SEED_KINDS: Record<'critical' | 'world', PuzzleKind[]> = {
  critical: ['end', 'goal'],
  world: ['end', 'goal', 'room', 'place', 'player'],
};

/**
 * What matters for progress (the solver's state). Rooms, places, players and the end are live; a chapter goal or an
 * invariant is a live reader; from there, an action is live when an effect of it reaches something live, and a thing
 * (item, flag, prop, character position, event) is live when a live action reads it. The rest is decoration: a flag
 * only its own setter reads, a trinket no gate needs, a clock nobody looks at, a walker nobody waits for.
 * `extraReads`: conditions outside the content (a solver goal, the ending's guess flag, `visible` conditions).
 */
export function liveness(g: PuzzleGraph, extraReads: CondAtom[] = []): Liveness {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const { live, because } = liveFrom(g, [
    ...g.nodes.filter((n) => SEED_KINDS.world.includes(n.kind)).map((n) => n.id),
    ...extraReads.map(atomNodeId),
  ]);
  const names = (prefix: string) =>
    new Set([...live].filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)));
  return {
    flags: names('flag:'),
    items: names('item:'),
    props: names('prop:'),
    actors: new Set([...names('actor:')].map((x) => x.slice(0, x.indexOf('@')))),
    actions: new Set(
      [...live]
        .filter((id) => byId.has(id) && !STATE_KINDS.has(byId.get(id)!.kind))
        .map((id) => (byId.get(id)!.kind === 'script' ? id.slice(7) : id)),
    ),
    nodes: live,
    because,
  };
}

/**
 * Why the solver keeps a thing in its state: `critical` reaches the end, a goal or an invariant; `world` only reaches a
 * room, a place or a playable character; `visible` is only read by a `visible` condition or the ending's guess;
 * `dead` is read by nothing live (not in the state at all).
 */
export type LiveClass = 'critical' | 'world' | 'visible' | 'dead';

export function liveClasses(g: PuzzleGraph, extra: CondAtom[] = []): Map<string, LiveClass> {
  const out = new Map<string, LiveClass>();
  const crit = liveFrom(
    g,
    g.nodes.filter((n) => SEED_KINDS.critical.includes(n.kind)).map((n) => n.id),
  ).live;
  const world = liveFrom(
    g,
    g.nodes.filter((n) => SEED_KINDS.world.includes(n.kind)).map((n) => n.id),
  ).live;
  const all = liveness(g, extra).nodes;
  for (const n of g.nodes)
    out.set(n.id, crit.has(n.id) ? 'critical' : world.has(n.id) ? 'world' : all.has(n.id) ? 'visible' : 'dead');
  return out;
}

/** The chain that keeps a node in the solver's state, from it to the seed (the end, a goal, a room…), and its class. */
export function whyLive(g: PuzzleGraph, id: string, extra: CondAtom[] = []): { class: LiveClass; chain: PuzzleNode[] } {
  const node = findNode(g, id);
  if (!node) return { class: 'dead', chain: [] };
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const cls = liveClasses(g, extra).get(node.id) ?? 'dead';
  if (cls === 'dead') return { class: cls, chain: [] };
  const seeds =
    cls === 'critical'
      ? g.nodes.filter((n) => SEED_KINDS.critical.includes(n.kind)).map((n) => n.id)
      : cls === 'world'
        ? g.nodes.filter((n) => SEED_KINDS.world.includes(n.kind)).map((n) => n.id)
        : [...g.nodes.filter((n) => SEED_KINDS.world.includes(n.kind)).map((n) => n.id), ...extra.map(atomNodeId)];
  const { because } = liveFrom(g, seeds);
  const chain: PuzzleNode[] = [node];
  const seen = new Set([node.id]);
  for (let cur = node.id, e = because.get(cur); e && !seen.has(e.to); e = because.get(cur)) {
    cur = e.to;
    seen.add(cur);
    const n = byId.get(cur);
    if (n) chain.push(n);
    else if (cls === 'visible')
      chain.push({ id: cur, kind: 'flag', label: `${cur.slice(cur.indexOf(':') + 1)} (a visible condition)` });
  }
  return { class: cls, chain };
}

/** The node named `id` (`item:key`), or by its bare name among the state kinds (`key`). */
export function findNode(g: PuzzleGraph, id: string): PuzzleNode | undefined {
  return (
    g.nodes.find((n) => n.id === id) ??
    g.nodes.find((n) => STATE_KINDS.has(n.kind) && n.id.slice(n.kind.length + 1) === id)
  );
}

export interface PuzzleCard {
  node: PuzzleNode;
  /** Actions that produce it (and how). */
  acquiredBy: { action: PuzzleNode; detail?: string }[];
  /** Actions that take it away. */
  consumedBy: { action: PuzzleNode; detail?: string }[];
  /** Actions gated by it (`requires`) or reading it inside their commands (`reads`). */
  usedBy: { action: PuzzleNode; kind: 'requires' | 'reads'; detail?: string }[];
  /** What the producing actions need first. */
  requires: PuzzleNode[];
  /** What the using actions produce. */
  unlocks: PuzzleNode[];
  /** Everything that transitively follows from the using actions. */
  downstream: PuzzleNode[];
  /** Why the solver keeps it in its state (`whyLive`), when `extra` is given. */
  live?: { class: LiveClass; chain: PuzzleNode[] };
}

/** One card: where it comes from, what needs it, what it unlocks, what depends on it further down. */
export function puzzleFor(g: PuzzleGraph, id: string, opts: { extra?: CondAtom[] } = {}): PuzzleCard | undefined {
  const node = findNode(g, id);
  if (!node) return undefined;
  const live = opts.extra ? whyLive(g, node.id, opts.extra) : undefined;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const n = (x: string) => byId.get(x)!;
  const acquiredBy = g.edges
    .filter((e) => e.to === node.id && e.kind === 'produces')
    .map((e) => ({ action: n(e.from), detail: e.detail }));
  const consumedBy = g.edges
    .filter((e) => e.to === node.id && e.kind === 'consumes')
    .map((e) => ({ action: n(e.from), detail: e.detail }));
  const usedBy = g.edges
    .filter((e) => e.from === node.id && (e.kind === 'requires' || e.kind === 'reads'))
    .map((e) => ({ action: n(e.to), kind: e.kind as 'requires' | 'reads', detail: e.detail }));
  const uniq = (list: PuzzleNode[]) => [...new Map(list.map((x) => [x.id, x])).values()];
  const requires = uniq(
    acquiredBy.flatMap((a) =>
      g.edges.filter((e) => e.to === a.action.id && e.kind !== 'consumes' && e.from !== node.id).map((e) => n(e.from)),
    ),
  );
  const unlocks = uniq(
    usedBy.flatMap((u) => g.edges.filter((e) => e.from === u.action.id && e.kind === 'produces').map((e) => n(e.to))),
  );
  const downstream: PuzzleNode[] = [];
  const seen = new Set<string>([node.id]);
  const queue = unlocks.map((x) => x.id);
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    downstream.push(n(cur));
    for (const e of g.edges)
      if (e.from === cur && (e.kind === 'requires' || e.kind === 'reads'))
        for (const e2 of g.edges) if (e2.from === e.to && e2.kind === 'produces' && !seen.has(e2.to)) queue.push(e2.to);
  }
  return { node, acquiredBy, consumedBy, usedBy, requires, unlocks, downstream, ...(live ? { live } : {}) };
}

/** State nodes nothing produces (orphans: a flag read but never set) and nodes nothing uses (dead ends). */
export function puzzleIssues(g: PuzzleGraph): {
  orphans: PuzzleNode[];
  deadEnds: PuzzleNode[];
  selfLocked: PuzzleNode[];
} {
  const produced = new Set(g.edges.filter((e) => e.kind === 'produces').map((e) => e.to));
  const used = new Set(g.edges.filter((e) => e.kind === 'requires' || e.kind === 'reads').map((e) => e.from));
  const state = g.nodes.filter(
    (n) => STATE_KINDS.has(n.kind) && n.kind !== 'end' && n.kind !== 'room' && n.kind !== 'player',
  );
  const orphans = state.filter((n) => !produced.has(n.id) && n.kind !== 'actor');
  const deadEnds = state.filter(
    (n) => produced.has(n.id) && !used.has(n.id) && n.kind !== 'event' && n.kind !== 'actor',
  );
  // A flag set only by actions that already require it can never become true.
  const selfLocked = state.filter(
    (n) =>
      n.kind === 'flag' &&
      produced.has(n.id) &&
      g.edges
        .filter((e) => e.to === n.id && e.kind === 'produces')
        .every((p) =>
          g.edges.some(
            (e) => e.from === n.id && e.to === p.from && e.kind === 'requires' && !e.detail?.startsWith('not'),
          ),
        ),
  );
  return { orphans, deadEnds, selfLocked };
}

const fills: Record<PuzzleKind, string> = {
  item: '#fde68a',
  flag: '#dbeafe',
  prop: '#e9d5ff',
  room: '#e5e7eb',
  player: '#fecaca',
  place: '#d1fae5',
  event: '#fbcfe8',
  actor: '#fed7aa',
  end: '#bbf7d0',
  rule: '#fff',
  topic: '#fff',
  script: '#fff',
  listener: '#fff',
  goal: '#fff',
};

/** A heat colour for a share in [0, 1] (pale yellow to red). */
export function heatFill(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const r = 255,
    gr = Math.round(240 - 170 * x),
    b = Math.round(170 - 150 * x);
  return `rgb(${r},${gr},${b})`;
}

/**
 * The graph as SVG: state nodes coloured by kind, actions white; requires solid, reads dotted, produces green, consumes
 * red. `heat`: a count per node (the solver's `perAction`, `perRoom`): the hotter, the redder. `focus`: the node ids to
 * keep bright (the critical path); the others fade.
 */
export function toPuzzleSvg(g: PuzzleGraph, opts: { heat?: Record<string, number>; focus?: Set<string> } = {}): string {
  const max = Math.max(1, ...Object.values(opts.heat ?? {}));
  const heat = (id: string) => {
    const n = opts.heat?.[id];
    return n === undefined ? undefined : heatFill(Math.log1p(n) / Math.log1p(max));
  };
  const dim = (id: string) => (opts.focus && !opts.focus.has(id) ? 0.25 : undefined);
  const nodes: SvgNode[] = g.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    sub: STATE_KINDS.has(n.kind) ? n.kind : n.where,
    fill: heat(n.id) ?? fills[n.kind],
    stroke: STATE_KINDS.has(n.kind) ? '#999' : '#333',
    title: `${n.id}${opts.heat?.[n.id] !== undefined ? ` · ${opts.heat[n.id]}` : ''}`,
    href: n.id,
    opacity: dim(n.id),
  }));
  const edges: SvgEdge[] = g.edges.map((e) => ({
    from: e.from,
    to: e.to,
    dashed: e.kind === 'reads' || e.kind === 'consumes',
    color: e.kind === 'produces' ? '#2a7' : e.kind === 'consumes' ? '#c33' : '#888',
    title: `${e.from} ${e.kind} ${e.to}${e.detail ? ` (${e.detail})` : ''}`,
    opacity: dim(e.from) ?? dim(e.to),
  }));
  const roots = g.nodes
    .filter((n) => n.id === 'rule:game/start' || !g.edges.some((e) => e.to === n.id))
    .map((n) => n.id);
  return layeredSvg(nodes, edges, { roots, width: 170, layering: 'longest' });
}

/** The graph in DOT (Graphviz) form. */
export function toPuzzleDot(g: PuzzleGraph): string {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const lines = ['digraph puzzles {', '  rankdir=LR; node [fontsize=10];'];
  for (const n of g.nodes)
    lines.push(
      `  ${q(n.id)} [label=${q(n.label)}, shape=${STATE_KINDS.has(n.kind) ? 'ellipse' : 'box'}, style=filled, fillcolor=${q(fills[n.kind])}];`,
    );
  for (const e of g.edges)
    lines.push(
      `  ${q(e.from)} -> ${q(e.to)} [${e.kind === 'produces' ? 'color=darkgreen' : e.kind === 'consumes' ? 'color=red, style=dashed' : e.kind === 'reads' ? 'style=dotted' : ''}${e.detail ? `${e.kind === 'requires' ? '' : ', '}label=${q(e.detail)}` : ''}];`,
    );
  lines.push('}');
  return lines.join('\n');
}

const where = (n: PuzzleNode) =>
  n.where && n.where !== 'game' ? ` (${n.where})` : n.where === 'game' ? ' (game)' : '';

/** A card as Markdown, or without `id` the overview: every item and flag with its producers and users, then the issues. */
export function puzzleMarkdown(g: PuzzleGraph, id?: string, opts: { extra?: CondAtom[] } = {}): string {
  const out: string[] = [];
  if (id) {
    const c = puzzleFor(g, id, opts);
    if (!c) return `No item, flag, prop, place or event named "${id}".`;
    out.push(`# ${c.node.kind} ${c.node.label}`, '');
    const list = (title: string, items: string[]) => {
      out.push(`**${title}:** ${items.join('; ') || 'nothing'}`, '');
    };
    if (c.live) {
      const why = {
        critical: 'it leads to the end, a goal or an invariant',
        world: 'it leads to a room, a place or a playable character, not to the end',
        visible: "only a visible condition or the ending's guess reads it",
        dead: "nothing live reads it: not in the solver's state",
      }[c.live.class];
      list(`solver: ${c.live.class}`, [
        why,
        ...(c.live.chain.length > 1 ? [c.live.chain.map((n) => `${n.kind} ${n.label}`).join(' → ')] : []),
      ]);
    }
    list(
      'acquired by',
      c.acquiredBy.map((a) => `${a.action.label}${where(a.action)}${a.detail ? ` [${a.detail}]` : ''}`),
    );
    if (c.consumedBy.length)
      list(
        'consumed by',
        c.consumedBy.map((a) => `${a.action.label}${where(a.action)}`),
      );
    list(
      'used by',
      c.usedBy.map(
        (u) =>
          `${u.action.label}${where(u.action)}${u.kind === 'reads' ? ' (inside)' : ''}${u.detail ? ` [${u.detail}]` : ''}`,
      ),
    );
    list(
      'requires first',
      c.requires.map((n) => `${n.kind} ${n.label}`),
    );
    list(
      'unlocks',
      c.unlocks.map((n) => `${n.kind} ${n.label}`),
    );
    list(
      'downstream',
      c.downstream.map((n) => `${n.kind} ${n.label}`),
    );
    return out.join('\n');
  }
  out.push(
    '# Puzzle graph',
    '',
    `${g.nodes.filter((n) => !STATE_KINDS.has(n.kind)).length} actions · ${g.nodes.filter((n) => STATE_KINDS.has(n.kind)).length} things · ${g.edges.length} links`,
    '',
  );
  out.push('| Thing | acquired by | used by |', '|---|---|---|');
  for (const n of g.nodes.filter(
    (x) => x.kind === 'item' || x.kind === 'flag' || x.kind === 'prop' || x.kind === 'place',
  )) {
    const c = puzzleFor(g, n.id)!;
    out.push(
      `| ${n.kind} ${n.label} | ${c.acquiredBy.map((a) => a.action.label).join('; ') || '**never**'} | ${c.usedBy.map((u) => u.action.label).join('; ') || '**nothing**'} |`,
    );
  }
  const issues = puzzleIssues(g);
  if (issues.orphans.length)
    out.push('', `**Read but never produced:** ${issues.orphans.map((n) => `${n.kind} ${n.label}`).join(', ')}`);
  if (issues.deadEnds.length)
    out.push('', `**Produced but never used:** ${issues.deadEnds.map((n) => `${n.kind} ${n.label}`).join(', ')}`);
  if (issues.selfLocked.length)
    out.push('', `**Set only by actions that already need it:** ${issues.selfLocked.map((n) => n.label).join(', ')}`);
  return out.join('\n') + '\n';
}
