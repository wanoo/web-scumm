// Solver: explores every possible action from "New game" (best-first: the state that has progressed
// the most — unlocked places, flags, inventory — is explored first) to prove the game can be finished, and to spot dead
// ends and unused items. States only differ by what matters: props and counters that nothing reads
// (a "2nd time" gag, opening/closing a cupboard with no consequence) don't create a new state.
// Uses the real engine with a silent presenter: whatever the solver finds, the player can do.
import { Engine, type Action, type Source } from '../core/engine';
import type { CustomCommands } from '../core/custom';
import { FakePresenter, MemoryStore } from '../core/ports';
import { check } from '../core/cond';
import { changesState, cmdLists, eachCmd } from '../core/cmds';
import { condAtoms, type CondAtom } from '../core/cond';
import { liveness, puzzleGraph } from './puzzle';
import type { Cond, GameDef, GameState, Id, Layout, VerbId } from '../core/types';

export interface Step { label: string }

export interface SolveResult {
  /** The game reaches the sealed ending or the ending. */
  finished: boolean;
  /** Path found to the ending (or to the last explored state). Not necessarily the shortest. */
  path: string[];
  states: number;
  truncated: boolean;
  flagsReached: string[];
  unlockedReached: string[];
  roomsReached: string[];
  /** Game items that never trigger a written reaction (neither gained nor used). */
  unusedItems: string[];
  /** Items obtained that are never used in a rule. */
  itemsNeverUsed: string[];
  /** States with no action that changes anything (other than the ending). */
  deadEnds: { path: string[]; room: string; inventory: string[] }[];
  errors: string[];
  /** Invariants that became true (index in `game.invariants`), with the path that broke them. */
  broken: { invariant: number; path: string[] }[];
}

export interface SolveOptions {
  maxStates?: number;
  start?: 'new' | { checkpoint: Id };
  /** Stop when all these conditions hold (a chapter's goals), instead of at the ending. */
  goal?: Cond[];
  /** The game's custom commands: their `effects` apply (their `run` never does here). */
  commands?: CustomCommands;
}

interface Node { state: GameState; path: string[] }

/** Keys of once / nth blocks: their counter changes behaviour, so it's part of the state. */
function stateKeys(game: GameDef, commands?: CustomCommands, goal?: Cond[]) {
  // What can still change the outcome: a flag nobody but its setter reads, a clock nobody looks at, a walker nobody
  // waits for are left out of the state (and the solver does not spend actions on them).
  const extra: CondAtom[] = [];
  for (const c of goal ?? []) condAtoms(c, undefined, extra);
  if (game.ending?.guess) extra.push({ kind: 'flag', id: game.ending.guess.flag });
  const findVisible = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(findVisible); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k === 'visible') condAtoms(x as Cond, undefined, extra); findVisible(x); }
  };
  findVisible(game.rooms);
  const live = liveness(puzzleGraph(game, { commands }), extra);
  const json = JSON.stringify(game);
  // `seen` only counts if a condition reads it
  const seenRead = new Set<string>();
  for (const m of json.matchAll(/"seen":"([^"]+)"/g)) seenRead.add(m[1]);
  // A prop only counts if a condition reads its state ({ prop: [id, state] }): otherwise opening/closing it is just decor.
  const propRead = new Set<string>();
  const condProps = (c: unknown) => {
    if (!c || typeof c !== 'object') return;
    if (Array.isArray(c)) { c.forEach(condProps); return; }
    const o = c as Record<string, unknown>;
    if (Array.isArray(o.prop) && typeof o.prop[0] === 'string') propRead.add(o.prop[0]);
    Object.values(o).forEach(condProps);
  };
  const findConds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(findConds); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'if' || k === 'visible' || k === 'until' || k === 'news') condProps(x);
      findConds(x);
    }
  };
  findConds(game);
  // A once/nth counter only counts if its block actually changes state (flag, item, prop, room…): repeat gags don't.
  const onceRead = new Set<string>();
  const nthRead = new Map<string, number>();
  for (const { list } of cmdLists(game)) eachCmd(list, (c) => {
    if (typeof c === 'string') return;
    if ('once' in c) { if (c.key && changesState(c.once)) onceRead.add(c.key); }
    else if ('nth' in c) { if (c.key && changesState(c.nth.flat())) nthRead.set(c.key, c.nth.length - 1); }
  });
  // A counter only counts up to the highest value a condition compares it with: beyond, more `inc` change nothing.
  // A number nobody compares is just true: a script that counts forever doesn't create states forever.
  const flagBounds = new Map<string, number>();
  // …unless something lowers it or sets it to a number (a price haggled down): then the exact value matters.
  const exact = new Set<string>();
  for (const { list } of cmdLists(game)) eachCmd(list, (c) => {
    if (typeof c === 'string') return;
    if ('inc' in c && (c.by ?? 1) < 0) exact.add(c.inc);
    else if ('set' in c && Array.isArray(c.set) && typeof c.set[1] === 'number') exact.add(c.set[0]);
  });
  for (const [k, v] of Object.entries(game.start.flags ?? {})) if (typeof v === 'number') exact.add(k);
  const findBounds = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(findBounds); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.flag === 'string') {
      for (const k of ['eq', 'gte', 'lt'] as const) if (typeof o[k] === 'number') flagBounds.set(o.flag, Math.max(flagBounds.get(o.flag) ?? -Infinity, o[k] as number));
    }
    Object.values(o).forEach(findBounds);
  };
  findBounds(game);
  for (const k of exact) flagBounds.delete(k);
  return { once: onceRead, nth: nthRead, seenRead, propRead, flagBounds, exact, live };
}

function hashState(s: GameState, keys: ReturnType<typeof stateKeys>): string {
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.flags)) {
    if (!keys.live.flags.has(k)) continue;
    if (typeof v !== 'number') { flags[k] = v; continue; }
    const b = keys.flagBounds.get(k);
    flags[k] = keys.exact.has(k) ? v : b === undefined ? !!v : Math.min(v, b + 1);
  }
  const counters: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.counters)) {
    if (keys.once.has(k)) counters[k] = v ? 1 : 0;
    else if (keys.nth.has(k)) counters[k] = Math.min(v, keys.nth.get(k)!);
  }
  const vis: Record<string, boolean> = {};
  for (const [k, a] of Object.entries(s.actors)) if (a.visible !== undefined) vis[k] = a.visible;
  // `once` listeners (`event.*`) change what the next emit does: they are part of the state.
  const seen = Object.keys(s.seen).filter((k) => keys.seenRead.has(k) || k.startsWith('event.')).sort();
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.props)) if (keys.propRead.has(k.includes('.') ? k.slice(k.indexOf('.') + 1) : k) || keys.propRead.has(k)) props[k] = v;
  const scripts: Record<string, [number, boolean, boolean]> = {};
  for (const [k, st] of Object.entries(s.scripts ?? {})) if (keys.live.actions.has(k)) scripts[k] = [st.pc, !!st.done, !!st.off];
  const where: Record<string, string> = {};
  for (const [k, r] of Object.entries(s.where ?? {})) if (keys.live.actors.has(k)) where[k] = r;
  const players: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(s.players ?? {})) players[k] = [p.room, p.inventory.filter((i) => keys.live.items.has(i)).sort(), (p.used ?? []).filter((i) => keys.live.items.has(i)).sort()];
  const inv = s.inventory.filter((i) => keys.live.items.has(i));
  return JSON.stringify([s.room, [...inv].sort(), sortObj(flags), sortObj(props), [...s.unlocked].sort(), sortObj(vis), sortObj(counters), seen, !!s.done, (s.used ?? []).filter((i) => keys.live.items.has(i)).sort(),
    sortObj(where), sortObj(scripts), s.active ?? '', sortObj(players)]);
}

function sortObj<T>(o: Record<string, T>): [string, T][] { return Object.entries(o).sort(([a], [b]) => a.localeCompare(b)); }

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Waits for an engine promise to settle, playing the guided-tutorial steps whenever one is pending.
 * `onGuide` receives the action played (for the path).
 */
async function drive(engine: Engine, p: Promise<unknown>, onGuide: (a: Action) => void): Promise<void> {
  let done = false;
  let error: unknown;
  const settled = p.then(() => { done = true; }, (e) => { done = true; error = e; });
  for (let guard = 0; !done && guard < 500; guard++) {
    // The silent presenter resolves everything in microtasks: without a tutorial, we never wait on the timer.
    await Promise.race([settled, tick()]);
    const g = engine.guiding;
    if (g && !done) {
      const act: Action = { verb: g.verb, a: g.target };
      onGuide(act);
      await engine.act(act);
    }
  }
  if (!done) throw new Error('the engine never yields control back (tutorial or stuck choice?)');
  if (error) throw error;
}

function label(game: GameDef, a: Action): string {
  const v = game.verbs.find((x) => x.id === a.verb);
  return a.b ? `${v?.label ?? a.verb} ${a.a} ${v?.join ?? '→'} ${a.b}` : `${v?.label ?? a.verb} ${a.a}`;
}

export async function solve(gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions = {}): Promise<SolveResult> {
  const maxStates = opts.maxStates ?? 20000;
  const game = structuredClone(gameIn);
  const keys0 = new Engine(game, layouts, new FakePresenter(), new MemoryStore(), { commands: opts.commands }); // assigns the keys
  const keys = stateKeys(keys0.game, opts.commands, opts.goal);
  const errors: string[] = [];
  const itemsInRules = new Set<string>();
  const itemsSeen = new Set<string>();
  const flags = new Set<string>();
  const unlocked = new Set<string>();
  const roomsReached = new Set<string>();
  const deadEnds: SolveResult['deadEnds'] = [];
  const gained = new Set<string>();

  const makeEngine = () => {
    const ui = new FakePresenter();
    const e = new Engine(game, layouts, ui, new MemoryStore(), { commands: opts.commands });
    e.random = () => 0;
    return { e, ui };
  };

  // Starting state
  const { e: e0, ui: ui0 } = makeEngine();
  const startPath: string[] = [];
  if (opts.start && typeof opts.start === 'object') await e0.checkpoint(opts.start.checkpoint);
  else await drive(e0, e0.newGame(), (a) => startPath.push(`(tutorial) ${label(game, a)}`));
  const reached = (ui: FakePresenter, s: GameState) => opts.goal ? opts.goal.every((c) => check(c, s)) : (s.done || ui.log.includes('ENDING'));
  const broken: SolveResult['broken'] = [];
  const brokenSeen = new Set<number>();
  const checkInvariants = (s: GameState, path: string[]) => {
    (game.invariants ?? []).forEach((c, i) => { if (!brokenSeen.has(i) && check(c, s)) { brokenSeen.add(i); broken.push({ invariant: i, path }); } });
  };

  const seen = new Map<string, Node>();
  const start: Node = { state: structuredClone(e0.state), path: startPath };
  // Best-first: the more a state has progressed, the earlier it's explored. At equal progress, the shortest path first.
  const score = (n: Node) => n.state.unlocked.length * 20 + Object.values(n.state.flags).filter(Boolean).length * 3 + n.state.inventory.length * 2 - n.path.length * 0.01;
  const queue: Node[] = [start];
  const enqueue = (n: Node) => { const sc = score(n); let i = queue.length; while (i > 0 && score(queue[i - 1]) < sc) i--; queue.splice(i, 0, n); };
  seen.set(hashState(start.state, keys), start);
  let finish: Node | null = reached(ui0, e0.state) ? start : null;
  let last: Node = start;
  checkInvariants(start.state, start.path);

  while (queue.length && !finish) {
    if (seen.size >= maxStates) break;
    const node = queue.shift()!;
    last = node;
    const s = node.state;
    roomsReached.add(s.room);
    Object.entries(s.flags).forEach(([k, v]) => v && flags.add(k));
    s.unlocked.forEach((u) => unlocked.add(u));
    s.inventory.forEach((i) => itemsSeen.add(i));

    // List of actions to try
    const probe = makeEngine().e;
    probe.state = structuredClone(s);
    const room = probe.room();
    const targets = probe.targets(room);
    const inv = s.inventory;
    const verbs = game.verbs.map((v) => v.id) as VerbId[];
    // `picks`: the answers given to the choices met on the way (a topic index first, then nested `choice` prompts);
    // whatever is not given defaults to the last option. After a run, every other option of a prompt is a new try.
    type Try = { label: string; run: (e: Engine) => Promise<Source | null | void>; items: string[]; picks: number[]; variants: number };
    const tries: Try[] = [];
    for (const t of [...targets, ...inv]) for (const v of verbs) {
      if (v === 'talk' && room.talk?.[t]) continue; // handled by topics
      tries.push({ label: label(game, { verb: v, a: t }), run: (e) => e.act({ verb: v, a: t }), items: inv.includes(t) ? [t] : [], picks: [], variants: 0 });
    }
    for (const it of inv) for (const t of [...targets, ...inv.filter((x) => x !== it)]) for (const v of ['use', 'give'] as VerbId[]) {
      if (v === 'give' && inv.includes(t)) continue;
      tries.push({ label: label(game, { verb: v, a: it, b: t }), run: (e) => e.act({ verb: v, a: it, b: t }), items: inv.includes(t) ? [it, t] : [it], picks: [], variants: 0 });
    }
    for (const [actor, topics] of Object.entries(room.talk ?? {})) {
      if (!targets.includes(actor)) continue;
      // the engine numbers visible topics: the label must follow the same list (otherwise the printed path would lie)
      topics.filter((tp) => check(tp.if, s, room.id)).forEach((tp, i) => tries.push({
        label: `Talk ${actor}: "${tp.topic}"`, run: (e) => e.act({ verb: 'talk', a: actor }), items: [], picks: [i], variants: 0,
      }));
    }
    for (const [pid, p] of Object.entries(game.map?.places ?? {})) {
      if (!s.unlocked.includes(pid) || p.room === s.room || !game.rooms.some((r) => r.id === p.room)) continue;
      tries.push({ label: `Map → ${p.name}`, run: (e) => e.travel(pid), items: [], picks: [], variants: 0 });
    }
    // Several playable characters: taking control of another one.
    for (const pid of probe.playerIds()) if (pid !== probe.heroId()) tries.push({ label: `Switch to ${pid}`, run: (e) => e.switchTo(pid).then(() => undefined), items: [], picks: [], variants: 0 });
    // The world's scripts: letting one run until its next wait (or its end) is something the player can do by waiting.
    for (const sc of probe.scriptsHere()) {
      const st = s.scripts?.[sc.id];
      if (st?.done || st?.off || !keys.live.actions.has(sc.id)) continue;
      tries.push({ label: `Script ${sc.id}`, run: (e) => e.runScript(sc.id, true).then(() => undefined), items: [], picks: [], variants: 0 });
    }

    let progressed = false;
    for (let ti = 0; ti < tries.length; ti++) {
      const t = tries[ti];
      const { e, ui } = makeEngine();
      e.state = structuredClone(s);
      ui.picks = [...t.picks];
      const path = [...node.path];
      let src: Source | null | void = null;
      try {
        await drive(e, t.run(e).then((r) => { src = r; }), (a) => path.push(`(tutorial) ${label(game, a)}`));
      } catch (err) {
        errors.push(`${t.label} (${s.room}): ${(err as Error).message}`);
        continue;
      }
      // Other answers to the `choice` prompts met after the given picks (the topic list itself is other tries).
      let variants = t.variants;
      for (let j = t.picks.length; j < ui.asked.length && variants < 32; j++) {
        const q = ui.asked[j];
        if (q.topic || q.n < 2) continue;
        const prefix = [...t.picks, ...ui.asked.slice(t.picks.length, j).map((a) => a.n - 1)];
        for (let o = 0; o < q.n - 1 && variants < 32; o++, variants++) {
          const base = t.label.replace(/ › ".*$/, '');
          const chosen = [...prefix.slice(t.picks.length), o].map((pick, k) => ui.asked[t.picks.length + k].texts[pick]);
          tries.push({ ...t, label: `${base} › ${chosen.map((x) => `"${x}"`).join(' › ')}`, picks: [...prefix, o], variants: variants + 1 });
        }
      }
      if (src === 'rule' || src === 'hint') t.items.forEach((i) => itemsInRules.add(i));
      // Reported even when the state is not worth exploring (a flag nobody reads, a trinket no gate needs): it did happen.
      Object.entries(e.state.flags).forEach(([k, v]) => v && flags.add(k));
      e.state.inventory.forEach((i) => gained.add(i));
      const h = hashState(e.state, keys);
      if (h === hashState(s, keys)) continue;
      progressed = true;
      if (seen.has(h)) continue;
      const next: Node = { state: structuredClone(e.state), path: [...path, t.label] };
      seen.set(h, next);
      checkInvariants(next.state, next.path);
      if (reached(ui, e.state)) { finish = next; break; }
      enqueue(next);
      if (seen.size >= maxStates) break;
    }
    if (!progressed) deadEnds.push({ path: node.path, room: s.room, inventory: [...s.inventory] });
  }

  for (const n of seen.values()) n.state.inventory.forEach((i) => gained.add(i));
  return {
    finished: !!finish,
    path: (finish ?? last).path,
    states: seen.size,
    truncated: seen.size >= maxStates,
    flagsReached: [...flags].sort(),
    unlockedReached: [...unlocked].sort(),
    roomsReached: [...roomsReached].sort(),
    unusedItems: Object.keys(game.items).filter((i) => !gained.has(i)).sort(),
    itemsNeverUsed: [...gained].filter((i) => !itemsInRules.has(i)).sort(),
    deadEnds: deadEnds.slice(0, 20),
    errors: [...new Set(errors)].slice(0, 50),
    broken,
  };
}
