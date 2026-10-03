// Solver: explores every possible action from "New game" (best-first: the state that has progressed
// the most — unlocked places, flags, inventory — is explored first) to prove the game can be finished, and to spot dead
// ends and unused items. States only differ by what matters: props and counters that nothing reads
// (a "2nd time" gag, opening/closing a cupboard with no consequence) don't create a new state.
// Uses the real engine with a silent presenter: whatever the solver finds, the player can do.
import { Engine, type Action, type Source } from '../core/engine';
import type { CustomCommands } from '../core/custom';
import { FakePresenter, MemoryStore } from '../core/ports';
import { check } from '../core/cond';
import type { Cmd, Cond, GameDef, GameState, Id, Layout, VerbId } from '../core/types';

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
function stateKeys(game: GameDef) {
  const once = new Set<string>();
  const nth = new Map<string, number>();
  const walk = (cmds: Cmd[] | undefined) => cmds?.forEach((c) => {
    if (typeof c === 'string') return;
    if ('anim' in c) { if (c.at) Object.values(c.at).forEach(walk); }
    else if ('once' in c) { if (c.key) once.add(c.key); walk(c.once); }
    else if ('nth' in c) { if (c.key) nth.set(c.key, c.nth.length - 1); c.nth.forEach(walk); }
    else if ('cycle' in c) c.cycle.forEach(walk);
    else if ('random' in c) c.random.forEach(walk);
    else if ('if' in c) { walk(c.then); walk(c.else); }
    else if ('parallel' in c) c.parallel.forEach(walk);
    else if ('cutscene' in c) walk(c.cutscene);
    else if ('choice' in c) c.choice.forEach((o) => walk(o.do));
    else if ('minigame' in c) walk(c.then);
    else if ('phone' in c) walk(c.do);
  });
  for (const r of game.rooms) {
    walk(r.onEnter); r.on?.forEach((x) => walk(x.do)); Object.values(r.talk ?? {}).forEach((ts) => ts.forEach((t) => walk(t.do)));
    r.scripts?.forEach((x) => walk(x.do)); r.events?.forEach((x) => walk(x.do));
    for (const p of Object.values(r.props ?? {})) for (const a of Object.values(p.anims ?? {})) Object.values(a.at ?? {}).forEach(walk);
  }
  game.rules.on?.forEach((x) => walk(x.do));
  game.scripts?.forEach((x) => walk(x.do)); game.events?.forEach((x) => walk(x.do));
  walk(game.start.intro);
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
  const CHANGES = /"(set|clear|gain|lose|used|prop|unlock|show|hide|minigame|phone|travel|map|ending|reveal|done|checkpoint|moveActor|emit|startScript|stopScript|goto|switchPlayer|transfer)"/;
  const matters = (cmds: Cmd[]) => CHANGES.test(JSON.stringify(cmds));
  const onceRead = new Set<string>();
  const nthRead = new Map<string, number>();
  const walk2 = (cmds: Cmd[] | undefined) => cmds?.forEach((c) => {
    if (typeof c === 'string') return;
    if ('anim' in c) { if (c.at) Object.values(c.at).forEach(walk2); }
    else if ('once' in c) { if (c.key && matters(c.once)) onceRead.add(c.key); walk2(c.once); }
    else if ('nth' in c) { if (c.key && matters(c.nth.flat())) nthRead.set(c.key, c.nth.length - 1); c.nth.forEach(walk2); }
    else if ('cycle' in c) c.cycle.forEach(walk2);
    else if ('random' in c) c.random.forEach(walk2);
    else if ('if' in c) { walk2(c.then); walk2(c.else); }
    else if ('parallel' in c) c.parallel.forEach(walk2);
    else if ('cutscene' in c) walk2(c.cutscene);
    else if ('choice' in c) c.choice.forEach((o) => walk2(o.do));
    else if ('minigame' in c) walk2(c.then);
    else if ('phone' in c) walk2(c.do);
  });
  for (const r of game.rooms) {
    walk2(r.onEnter); r.on?.forEach((x) => walk2(x.do)); Object.values(r.talk ?? {}).forEach((ts) => ts.forEach((t) => walk2(t.do)));
    r.scripts?.forEach((x) => walk2(x.do)); r.events?.forEach((x) => walk2(x.do));
    for (const p of Object.values(r.props ?? {})) for (const a of Object.values(p.anims ?? {})) Object.values(a.at ?? {}).forEach(walk2);
  }
  game.rules.on?.forEach((x) => walk2(x.do));
  game.scripts?.forEach((x) => walk2(x.do)); game.events?.forEach((x) => walk2(x.do));
  walk2(game.start.intro);
  // A counter only counts up to the highest value a condition compares it with: beyond, more `inc` change nothing.
  // A number nobody compares is just true: a script that counts forever doesn't create states forever.
  const flagBounds = new Map<string, number>();
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
  void once; void nth;
  return { once: onceRead, nth: nthRead, seenRead, propRead, flagBounds };
}

function hashState(s: GameState, keys: ReturnType<typeof stateKeys>): string {
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.flags)) {
    if (typeof v !== 'number') { flags[k] = v; continue; }
    const b = keys.flagBounds.get(k);
    flags[k] = b === undefined ? !!v : Math.min(v, b + 1);
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
  for (const [k, st] of Object.entries(s.scripts ?? {})) scripts[k] = [st.pc, !!st.done, !!st.off];
  const players: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(s.players ?? {})) players[k] = [p.room, [...p.inventory].sort(), [...(p.used ?? [])].sort()];
  return JSON.stringify([s.room, [...s.inventory].sort(), sortObj(flags), sortObj(props), [...s.unlocked].sort(), sortObj(vis), sortObj(counters), seen, !!s.done, [...(s.used ?? [])].sort(),
    sortObj(s.where ?? {}), sortObj(scripts), s.active ?? '', sortObj(players)]);
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
  const keys = stateKeys(keys0.game);
  const errors: string[] = [];
  const itemsInRules = new Set<string>();
  const itemsSeen = new Set<string>();
  const flags = new Set<string>();
  const unlocked = new Set<string>();
  const roomsReached = new Set<string>();
  const deadEnds: SolveResult['deadEnds'] = [];

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
    type Try = { label: string; run: (e: Engine, ui: FakePresenter) => Promise<Source | null | void>; items: string[] };
    const tries: Try[] = [];
    for (const t of [...targets, ...inv]) for (const v of verbs) {
      if (v === 'talk' && room.talk?.[t]) continue; // handled by topics
      tries.push({ label: label(game, { verb: v, a: t }), run: (e) => e.act({ verb: v, a: t }), items: inv.includes(t) ? [t] : [] });
    }
    for (const it of inv) for (const t of [...targets, ...inv.filter((x) => x !== it)]) for (const v of ['use', 'give'] as VerbId[]) {
      if (v === 'give' && inv.includes(t)) continue;
      tries.push({ label: label(game, { verb: v, a: it, b: t }), run: (e) => e.act({ verb: v, a: it, b: t }), items: inv.includes(t) ? [it, t] : [it] });
    }
    for (const [actor, topics] of Object.entries(room.talk ?? {})) {
      if (!targets.includes(actor)) continue;
      // the engine numbers visible topics: the label must follow the same list (otherwise the printed path would lie)
      topics.filter((tp) => check(tp.if, s, room.id)).forEach((tp, i) => tries.push({
        label: `Talk ${actor}: "${tp.topic}"`,
        run: async (e, ui) => { ui.picks = [i]; return e.act({ verb: 'talk', a: actor }); }, items: [],
      }));
    }
    for (const [pid, p] of Object.entries(game.map?.places ?? {})) {
      if (!s.unlocked.includes(pid) || p.room === s.room || !game.rooms.some((r) => r.id === p.room)) continue;
      tries.push({ label: `Map → ${p.name}`, run: (e) => e.travel(pid), items: [] });
    }
    // Several playable characters: taking control of another one.
    for (const pid of probe.playerIds()) if (pid !== probe.heroId()) tries.push({ label: `Switch to ${pid}`, run: (e) => e.switchTo(pid).then(() => undefined), items: [] });
    // The world's scripts: letting one run (until it waits, ends or loops) is something the player can do by waiting.
    for (const sc of probe.scriptsHere()) {
      const st = s.scripts?.[sc.id];
      if (st?.done || st?.off) continue;
      tries.push({ label: `Script ${sc.id}`, run: (e) => e.runScript(sc.id).then(() => undefined), items: [] });
    }

    let progressed = false;
    for (const t of tries) {
      const { e, ui } = makeEngine();
      e.state = structuredClone(s);
      const path = [...node.path];
      let src: Source | null | void = null;
      try {
        await drive(e, t.run(e, ui).then((r) => { src = r; }), (a) => path.push(`(tutorial) ${label(game, a)}`));
      } catch (err) {
        errors.push(`${t.label} (${s.room}): ${(err as Error).message}`);
        continue;
      }
      if (src === 'rule' || src === 'hint') t.items.forEach((i) => itemsInRules.add(i));
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

  const gained = new Set<string>();
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
