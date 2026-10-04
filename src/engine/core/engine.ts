import { check, condAtoms, type CondAtom } from './cond';
import { compileGame, EMPTY_LAYOUT, FLOOR, NEAR } from './define';
import { listenerActionId, ruleActionId, topicActionId } from './content-ids';
import { migrate } from './migrate';
import { stateDiff, stateDigest } from './diff';
import { ANIM_MS, CAMERA_MS, FPS } from './timing';
import type { Presenter, SaveStore } from './ports';
import type { Action, CharacterDef, Cmd, Cond, EventRule, GameDef, GameState, Id, Layout, Point, RoomDef, Rule, ScriptDef, Session, SessionEntry, Value, VerbId } from './types';
import type { CustomCommands } from './custom';

export type { Action } from './types';

export interface EngineOptions {
  /** The game's custom commands (`{ custom }`), from games/<id>/index.ts. */
  commands?: CustomCommands;
  /** Run their `run` part (the browser app); off in node (tests, solver): only `effects` apply. */
  runCustom?: boolean;
  /** The scene element handed to custom commands (DOM renderer). */
  scene?: () => HTMLElement | undefined;
}

/** Where the response to an action comes from: useful to the solver (only written rules move things forward). */
export type Source = 'rule' | 'look' | 'talk' | 'hint' | 'kind' | 'refuse' | 'fallback' | 'guide';

/** One line of the engine's journal (`Engine.trace`, kept when `traceOn`). */
export interface TraceEntry { t: number; kind: 'action' | 'event' | 'script' | 'actor' | 'player'; text: string; room: Id }

/** A short name for a command, for the journal. */
export function describeCmd(c: Cmd): string {
  if (typeof c === 'string') return `"${c.length > 24 ? c.slice(0, 24) + '…' : c}"`;
  const k = Object.keys(c)[0];
  const v = (c as Record<string, unknown>)[k];
  return `${k}${typeof v === 'string' ? ` ${v}` : Array.isArray(v) && v.every((x) => typeof x === 'string') ? ` ${v.join(' ')}` : typeof v === 'number' ? ` ${v}` : ''}`;
}

interface Ctx { room: RoomDef; fast: boolean }

const HERO = 'hero';

const near = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= NEAR;

/** A condition atom as `kind:id` (`Engine.reads`). */
export const atomKey = (a: CondAtom) => `${a.kind}:${a.id}`;

export class Engine {
  readonly game: GameDef;
  readonly layouts: Record<Id, Layout>;
  state!: GameState;
  private rooms: Map<Id, RoomDef>;
  private lastFallback: Record<string, number> = {};
  private busyCount = 0;
  private guideWait: { verb: VerbId; target: Id; say: string; resolve: () => void } | null = null;
  private skipping = false;
  /** Called on every state change relevant to the UI (inventory, room, busy state). */
  onChange: () => void = () => {};
  /** The journal (dev tools, Studio Play tab): what answered, which events fired, how scripts moved. Kept only when `traceOn`. */
  trace: TraceEntry[] = [];
  traceOn = false;
  private log(kind: TraceEntry['kind'], text: string) {
    if (!this.traceOn) return;
    this.trace.push({ t: Date.now(), kind, text, room: this.state.room });
    if (this.trace.length > 200) this.trace.splice(0, this.trace.length - 200);
  }
  /** Injectable randomness (the solver makes it deterministic). */
  random: () => number = Math.random;
  /** A clock (ms) for the session's `t` timestamps; none in the solver and the tests, so their sessions stay byte-identical. */
  clock: (() => number) | null = null;
  private sessionT0 = 0;
  /**
   * The session: the player's inputs since the game started or a save was loaded, with the answers given on the way
   * (`SessionEntry`). Always recorded: exported with a save, it is the bug report `replay()` reproduces.
   */
  session: Session | null = null;
  /** Store a digest of the state after every input (the browser app does; the solver has no use for it). */
  digestOn = false;
  /** Replay: the recorded entries to take the answers from, in order (`feed()`). */
  private feed: SessionEntry[] | null = null;
  /** The open entries (an input can resume a pending one: the tutorial step the intro waits for). */
  private open: { entry: SessionEntry; src?: SessionEntry; pi: number; mi: number; ri: number; steps: number }[] = [];
  /** Condition atoms read since the last `reads = new Set()` (the solver's independence analysis); null: not collected. */
  reads: Set<string> | null = null;
  static readonly SESSION_MAX = 5000;

  /** Opens an entry of the session (and takes its recorded twin when replaying). */
  private begin(entry: SessionEntry) {
    if (!this.open.length && this.session && this.session.log.length >= Engine.SESSION_MAX) this.newSession({ kind: 'load' });
    this.session ??= this.newSession({ kind: 'load' });
    if (this.clock) entry.t = Math.round(this.clock() - this.sessionT0);
    this.session.log.push(entry);
    this.open.push({ entry, src: this.feed?.shift(), pi: 0, mi: 0, ri: 0, steps: 0 });
  }
  /** A fresh session from the current state; the clock, when set, dates it and its entries. */
  private newSession(start: Session['start']): Session {
    this.sessionT0 = this.clock?.() ?? 0;
    this.session = { v: this.game.saveVersion, start, base: structuredClone(this.state), log: [], ...(this.clock ? { at: Date.now() } : {}) };
    return this.session;
  }

  private end() {
    const o = this.open.pop();
    if (o && this.digestOn) o.entry.digest = stateDigest(this.state);
  }
  private get cur() { return this.open.length ? this.open[this.open.length - 1] : undefined; }
  /** Records what answered (a rule, a topic, a listener, a script step: the puzzle graph's ids). */
  private ran(id: string) { const o = this.cur; if (o) (o.entry.ran ??= []).push(id); }
  /** Replays a session: the engine takes the recorded answers instead of asking the presenter. */
  feedSession(s: Session) { this.feed = [...s.log]; }
  /** A choice, recorded (and fed back when replaying). */
  private async choose(options: { text: string; seen?: boolean; global?: boolean }[], who?: Id): Promise<number> {
    const o = this.cur;
    const fed = o?.src?.picks?.[o.pi];
    const i = fed !== undefined ? (o!.pi++, fed) : await this.ui.choose(options, who);
    if (o) (o.entry.picks ??= []).push(i);
    return i;
  }
  /** The map's answer, recorded. */
  private async pickPlace(): Promise<Id | null> {
    const o = this.cur;
    const fed = o?.src?.maps?.[o.mi];
    const p = fed !== undefined ? (o!.mi++, fed) : await this.ui.openMap(this.state);
    if (o) (o.entry.maps ??= []).push(p);
    return p;
  }
  /** A random draw, recorded. */
  private rand(): number {
    const o = this.cur;
    const fed = o?.src?.rnd?.[o.ri];
    const r = fed !== undefined ? (o!.ri++, fed) : this.random();
    if (o) (o.entry.rnd ??= []).push(r);
    return r;
  }
  /** A condition, with its atoms collected when `reads` is on. */
  private cond(c: Cond | undefined, room?: Id): boolean {
    if (this.reads && c !== undefined) for (const a of condAtoms(c, room ?? this.state.room)) this.reads.add(atomKey(a));
    return check(c, this.state, room);
  }
  /**
   * The world's scripts run on their own (the browser app sets it). Off in node: tests and the solver step them
   * with `runScript` / `advance`.
   */
  autoScripts = false;
  /** Generations of the running script loops: a new room (room scripts) or a new session (game scripts) stops the old ones. */
  private roomGen = 0;
  private sessionGen = 0;
  /** Scripts whose loop is running (auto mode). */
  private loops = new Set<Id>();

  constructor(game: GameDef, layouts: Record<Id, Layout>, readonly ui: Presenter, readonly store: SaveStore, readonly opts: EngineOptions = {}) {
    this.game = compileGame(game) as GameDef;
    this.layouts = layouts;
    this.rooms = new Map(this.game.rooms.map((r) => [r.id, r]));
  }

  // ------------------------------------------------------------------ game session

  fresh(): GameState {
    const s = this.game.start;
    return {
      v: this.game.saveVersion, room: s.room, inventory: [...(s.inventory ?? [])], flags: { ...(s.flags ?? {}) },
      props: {}, actors: {}, hero: {}, unlocked: [...(s.unlocked ?? [])], visited: {}, counters: {}, seen: {}, started: Date.now(),
      where: this.homes(), scripts: {}, camera: { x: 0, follow: true }, active: this.game.hero,
    };
  }

  /** The other playable characters' starting records (`players.start`). */
  private otherPlayers(): NonNullable<GameState['players']> {
    const out: NonNullable<GameState['players']> = {};
    for (const id of this.game.players?.ids ?? []) {
      if (id === this.game.hero) continue;
      const st = this.game.players?.start?.[id];
      out[id] = { room: st?.room ?? this.game.start.room, inventory: [...(st?.inventory ?? [])], hero: {} };
    }
    return out;
  }

  /** Starting room of every moving character (`CharacterDef.room`). */
  private homes(): Record<Id, Id> {
    const out: Record<Id, Id> = {};
    for (const [id, c] of Object.entries(this.game.characters)) if (c.room) out[id] = c.room;
    return out;
  }

  /** Fills what a state may lack: props' initial state, moving characters' room, scripts (new game, old save, content added since). */
  private ensureState(s: GameState) {
    for (const r of this.game.rooms) for (const [id, p] of Object.entries(r.props ?? {})) {
      const k = `${r.id}.${id}`;
      if (s.props[k] === undefined && p.states) s.props[k] = p.initial ?? Object.keys(p.states)[0];
    }
    s.where = { ...this.homes(), ...(s.where ?? {}) };
    s.scripts ??= {};
    s.camera ??= { x: 0, follow: true };
    s.active ??= this.game.hero;
    if (this.game.players) { s.players = { ...this.otherPlayers(), ...(s.players ?? {}) }; delete s.players[s.active]; }
    return s;
  }

  hasSave(): boolean { return !!migrate(this.game, this.store.load()); }

  async newGame(): Promise<void> {
    this.dropGuide();
    this.state = this.ensureState(this.fresh());
    this.store.save(this.state);
    this.newSession({ kind: 'new' });
    this.begin({ start: 'new' });
    this.ran('rule:game/start');
    try {
      // The prologue runs before the first room's arrival script (otherwise the tutorial would wait for it).
      await this.enter(this.state.room, undefined, false);
      if (this.game.start.intro) await this.run(() => this.exec(this.game.start.intro, { room: this.room(), fast: false }));
      const first = this.room();
      if (first.onEnter) { this.ran(`rule:${first.id}/enter`); await this.run(() => this.exec(first.onEnter, { room: first, fast: false })); }
    } finally { this.end(); }
    this.startScripts(true);
  }

  async continueGame(): Promise<void> {
    const s = migrate(this.game, this.store.load());
    if (!s) return this.newGame();
    await this.load(s);
  }

  /** Resumes from a state (the autosave, a manual slot, an imported file), migrated if it is older. */
  async load(saved: GameState): Promise<void> {
    const s = migrate(this.game, saved);
    if (!s) throw new Error(`save version ${saved.v} cannot be migrated to ${this.game.saveVersion}`);
    this.dropGuide();
    this.state = this.ensureState(s);
    this.store.save(this.state);
    this.newSession({ kind: 'load' });
    await this.enter(s.room, undefined, false);
    this.startScripts(true);
  }

  /** Forgets a pending tutorial step (game session change). */
  private dropGuide() { this.guideWait = null; this.ui.guide(null); this.busyCount = 0; this.sessionGen++; this.roomGen++; }

  /** Loads a checkpoint (dev mode, solver). */
  async checkpoint(id: Id): Promise<void> {
    this.dropGuide();
    const c = this.game.checkpoints?.[id];
    if (!c) throw new Error(`unknown checkpoint: ${id}`);
    const s = this.fresh();
    Object.assign(s, { room: c.room, inventory: [...(c.inventory ?? [])], flags: { ...(c.flags ?? {}) }, unlocked: [...(c.unlocked ?? s.unlocked)], props: { ...(c.props ?? {}) }, where: { ...s.where, ...(c.where ?? {}) } });
    if (c.active) s.active = c.active;
    if (c.players) { s.players = {}; for (const [pid, p] of Object.entries(c.players)) if (pid !== s.active) s.players[pid] = { room: p.room, inventory: [...(p.inventory ?? [])], hero: {} }; }
    this.state = this.ensureState(s);
    this.newSession({ kind: 'checkpoint', id });
    await this.enter(c.room, undefined, false);
    this.startScripts(true);
  }

  save() { this.store.save(this.state); }

  get busy() { return this.busyCount > 0 && !this.guideWait; }
  get guiding() { return this.guideWait ? { verb: this.guideWait.verb, target: this.guideWait.target } : null; }
  room(id: Id = this.state.room): RoomDef {
    const r = this.rooms.get(id);
    if (!r) throw new Error(`unknown room: ${id}`);
    return r;
  }
  layout(id: Id = this.state.room): Layout { return this.layouts[id] ?? EMPTY_LAYOUT; }

  // ------------------------------------------------------------------ queries for the UI

  /** The character the player controls now. */
  heroId() { return this.state?.active ?? this.game.hero; }
  /** The playable characters (`players.ids`, or just the hero). */
  playerIds(): Id[] { return this.game.players?.ids ?? [this.game.hero]; }
  isPlayer(id: Id) { return this.playerIds().includes(id); }
  /** Inactive players standing in this room with no actor declared for them: shown by the view, targetable. */
  guests(room: RoomDef = this.room()): Record<Id, { char: Id; at: Point }> {
    const out: Record<Id, { char: Id; at: Point }> = {};
    for (const [pid, p] of Object.entries(this.state.players ?? {})) {
      this.reads?.add(`players:${pid}`);
      if (p.room !== room.id || pid === this.heroId()) continue;
      if (Object.values(room.actors ?? {}).some((a) => a.char === pid)) continue;
      let at: Point = p.hero[room.id] ?? this.layout(room.id).entries?.default ?? [320, 360];
      // Standing on the very spot of the active character (both arrived by the same entry): step aside.
      const h = this.state.hero[room.id];
      if (h && Math.hypot(h[0] - at[0], h[1] - at[1]) < 12) at = [at[0] + (at[0] > 320 ? -60 : 60), at[1]];
      out[pid] = { char: pid, at };
    }
    return out;
  }
  private who(w: Id) { return w === HERO ? this.heroId() : w; }

  // ------------------------------------------------------------------ several playable characters

  /** The player takes control of another character: their room, position and inventory come up. */
  async switchTo(id: Id): Promise<void> {
    if (!this.isPlayer(id) || id === this.heroId() || this.busy) return;
    this.begin({ switch: id });
    try { await this.run(async () => { this.log('player', `switch to ${id}`); await this.swap(id); await this.enter(this.state.room, undefined, false); this.startScripts(true); }); } finally { this.end(); }
  }

  /** Stores the active player's flat fields, loads the other's (no display). */
  private async swap(id: Id) {
    const s = this.state;
    this.reads?.add(`players:${id}`);
    const shared = !!this.game.players?.sharedInventory;
    s.players ??= {};
    s.players[s.active ?? this.game.hero] = { room: s.room, inventory: shared ? [] : s.inventory, hero: s.hero, used: shared ? undefined : s.used };
    const p = s.players[id] ?? { room: this.game.start.room, inventory: [], hero: {} };
    delete s.players[id];
    s.active = id;
    s.room = p.room;
    s.hero = p.hero;
    if (!shared) { s.inventory = p.inventory; s.used = p.used; }
    s.camera = { x: 0, follow: true };
    this.onChange();
  }

  /** Hands an item to another player's inventory (shared inventory: nothing to do). */
  private transfer(item: Id, to: Id) {
    const s = this.state;
    if (this.game.players?.sharedInventory || to === this.heroId() || !s.inventory.includes(item)) return;
    const p = (s.players ??= {})[to] ??= { room: this.game.start.room, inventory: [], hero: {} };
    s.inventory = s.inventory.filter((x) => x !== item);
    if (!p.inventory.includes(item)) p.inventory.push(item);
    if (s.used?.includes(item)) { s.used = s.used.filter((x) => x !== item); (p.used ??= []).push(item); }
    this.ui.inventory(s.inventory, s.used);
    this.onChange();
  }

  /** Display name of any id (item, actor, prop, hotspot). */
  nameOf(id: Id, room: RoomDef = this.room()): string {
    if (this.game.items[id] && this.state.inventory.includes(id)) return this.game.items[id].name;
    const act = room.actors?.[id];
    if (act) return act.name ?? this.game.characters[act.char]?.name ?? id;
    if (this.guests(room)[id]) return this.game.characters[id]?.name ?? id;
    if (room.props?.[id]?.name) return room.props[id].name!;
    if (room.hotspots?.[id]) return room.hotspots[id].name;
    if (this.game.items[id]) return this.game.items[id].name;
    if (this.game.characters[id]) return this.game.characters[id].name;
    return id;
  }

  /** A character's sheet with the variant that applies to the current state (sprites, mouths, portrait). */
  character(id: Id): CharacterDef | undefined {
    const c = this.game.characters[id];
    if (!c?.variants || !this.state) return c;
    const v = c.variants.find((x) => check(x.if, this.state));
    return v ? {
      ...c, sprites: v.sprites ?? c.sprites, mouths: v.mouths ?? c.mouths, portrait: v.portrait ?? c.portrait,
      palette: v.palette ?? c.palette, paletteTolerance: v.palette ? v.paletteTolerance : c.paletteTolerance,
    } : c;
  }

  kindsOf(id: Id, room: RoomDef = this.room()): string[] {
    const act = room.actors?.[id];
    if (act) return this.game.characters[act.char]?.kind ?? [];
    if (this.guests(room)[id]) return this.game.characters[id]?.kind ?? [];
    if (room.props?.[id]) return room.props[id].kind ?? [];
    if (room.hotspots?.[id]) return room.hotspots[id].kind ?? [];
    return this.game.items[id]?.kind ?? [];
  }

  /** Has the inventory item already been used (`{ used }`)? */
  isUsed(id: Id): boolean { return !!this.state?.used?.includes(id); }

  /**
   * Item greyed out and inert for Use / Give: it has been used, and no room or game rule (whose condition is true)
   * still targets it as `a` or `b`.
   */
  usedLocked(id: Id, room: RoomDef = this.room()): boolean {
    if (!this.isUsed(id)) return false;
    const has = (x: Id | Id[] | undefined) => x !== undefined && (Array.isArray(x) ? x.includes(id) : x === id);
    for (const list of [room.on ?? [], this.game.rules.on ?? []]) {
      for (const r of list) if ((has(r.a) || has(r.b)) && check(r.if, this.state, room.id)) return false;
    }
    return true;
  }

  /** Is the entity visible in the current room? A moving character only shows in the room it is in. */
  visible(id: Id, room: RoomDef = this.room()): boolean {
    const act = room.actors?.[id];
    if (this.reads) { if (act) this.reads.add(`where:${act.char}`); this.reads.add(`visible:${room.id}.${id}`); }
    if (act) { const w = this.state.where?.[act.char]; if (w !== undefined && w !== room.id) return false; }
    const over = this.state.actors[`${room.id}.${id}`]?.visible;
    if (over !== undefined) return over;
    const def = act ?? room.props?.[id] ?? room.hotspots?.[id];
    if (!def && this.guests(room)[id]) return true;
    return def ? this.cond(def.visible, room.id) : false;
  }

  /** The actor of a character in a room (its id in `room.actors`), if declared there. */
  instanceOf(char: Id, room: RoomDef): Id | undefined {
    return Object.entries(room.actors ?? {}).find(([, a]) => a.char === char)?.[0];
  }

  propState(id: Id, room: RoomDef = this.room()): string | undefined {
    const def = room.props?.[id];
    if (!def) return undefined;
    return this.state.props[`${room.id}.${id}`] ?? def.initial ?? (def.states ? Object.keys(def.states)[0] : undefined);
  }

  /** Everything that can be targeted in the room (ids), in the content's display order. */
  targets(room: RoomDef = this.room()): Id[] {
    const ids = [
      ...Object.keys(room.hotspots ?? {}),
      ...Object.entries(room.props ?? {}).filter(([, p]) => p.name).map(([k]) => k),
      ...Object.entries(room.actors ?? {}).filter(([, a]) => a.interactive !== false).map(([k]) => k),
      ...Object.keys(this.guests(room)),
    ];
    return ids.filter((id) => this.visible(id, room));
  }

  /** Is this id something the room offers to target (declared and visible)? Reads only what concerns it. */
  private inScene(id: Id, room: RoomDef): boolean {
    const declared = !!room.hotspots?.[id] || !!room.props?.[id]?.name || (room.actors?.[id] !== undefined && room.actors[id].interactive !== false) || !!this.guests(room)[id];
    return declared && this.visible(id, room);
  }

  /** Point where the hero stands to act on a target. */
  approach(id: Id, room: RoomDef = this.room()): Point | null {
    const L = this.layout(room.id);
    const floor = L.floor ?? FLOOR;
    const h = L.hotspots?.[id];
    if (h?.approach) return h.approach;
    const p0 = L.props?.[id];
    if (p0) {
      const st = this.propState(id, room);
      const p = { ...p0, ...(st ? p0.states?.[st] : undefined) };
      // An approach point too far from the prop predates its move: recompute it.
      if (p.approach && near(p.approach, [p.x, p.y])) return p.approach;
      return [p.x, Math.min(floor, p.y + 12)];
    }
    const a = L.actors?.[id];
    if (a) {
      const o = this.state.actors[`${room.id}.${id}`];
      const x = o?.x ?? a.x, y = o?.y ?? a.y;
      if (a.approach && near(a.approach, [x, y])) return a.approach;
      return [x + (x > 320 ? -44 : 44), y];
    }
    if (h?.rect) return [h.rect[0] + h.rect[2] / 2, Math.min(floor, h.rect[1] + h.rect[3] + 12)];
    if (h?.poly) { const xs = h.poly.map((p) => p[0]), ys = h.poly.map((p) => p[1]); return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(floor, Math.max(...ys) + 12)]; }
    const g = this.guests(room)[id];
    if (g) return [g.at[0] + (g.at[0] > 320 ? -44 : 44), g.at[1]];
    return null;
  }

  /** Horizontal center of a target (for turning to face it). */
  centerX(id: Id, room: RoomDef = this.room()): number | null {
    const L = this.layout(room.id);
    const h = L.hotspots?.[id];
    if (h?.rect) return h.rect[0] + h.rect[2] / 2;
    if (h?.poly) return h.poly.reduce((s, p) => s + p[0], 0) / h.poly.length;
    const o = this.state.actors[`${room.id}.${id}`];
    if (o?.x !== undefined) return o.x;
    const p = L.props?.[id];
    if (p) { const st = this.propState(id, room); return (st ? p.states?.[st]?.x : undefined) ?? p.x; }
    return L.actors?.[id]?.x ?? this.guests(room)[id]?.at[0] ?? null;
  }

  // ------------------------------------------------------------------ player actions

  /** Executes a player action: walk to the target, then react. */
  async act(act: Action): Promise<Source | null> {
    if (this.busy) return null;
    // Guided tutorial: only one action is accepted, others repeat the instruction.
    if (this.guideWait) {
      const g = this.guideWait;
      const ok = g.verb === act.verb && (act.a === g.target || act.b === g.target);
      if (!ok) { await this.run(async () => { await this.ui.say(this.heroId(), g.say, {}); }); return 'guide'; }
    }
    let src: Source | null = null;
    const entry: SessionEntry = { act: { ...act } };
    this.begin(entry);
    if (this.reads) { this.reads.add(`item:${act.a}`); if (act.b) this.reads.add(`item:${act.b}`); }
    try {
      // Replaying a walk the player interrupted: nothing happened then, nothing happens now.
      if (this.cur?.src && 'act' in this.cur.src && this.cur.src.aborted) { entry.aborted = true; return null; }
      await this.run(async () => {
        const room = this.room();
        const target = act.b ?? act.a;
        const inScene = !this.state.inventory.includes(target) && this.inScene(target, room);
        if (inScene) {
          const ap = this.approach(target, room);
          if (ap) {
            const end = await this.ui.walk(this.heroId(), ap, false);
            if (!end) { entry.aborted = true; return; }
            this.state.hero[room.id] = end;
          }
        }
        if (inScene) { this.faceTowards(target, room); this.faceHero(target, room); }
        src = await this.resolve(act, { room, fast: false });
        this.log('action', `${act.verb} ${act.a}${act.b ? ` → ${act.b}` : ''}: ${src ?? 'nothing'}`);
      });
    } finally { this.end(); }
    if (this.guideWait && src !== null) {
      const g = this.guideWait;
      if (g.verb === act.verb && (act.a === g.target || act.b === g.target)) { this.guideWait = null; this.ui.guide(null); g.resolve(); }
    }
    return src;
  }

  /** Walk to a point on the floor. */
  async walkTo(p: Point): Promise<void> {
    if (this.busy) return;
    if (this.guideWait) { const g = this.guideWait; await this.run(async () => { await this.ui.say(this.heroId(), g.say, {}); }); return; }
    const end = await this.ui.walk(this.heroId(), p, false);
    if (end) { this.state.hero[this.state.room] = end; this.save(); }
  }

  /** Travel to a place on the map. */
  async travel(place: Id): Promise<void> {
    const p = this.game.map?.places[place];
    if (!p || !this.state.unlocked.includes(place)) return;
    this.begin({ travel: place });
    try { await this.run(() => this.enter(p.room, undefined, true)); } finally { this.end(); }
  }

  /** Opens the map from the UI. */
  async openMap(): Promise<void> {
    if (this.busy) return;
    this.begin({ map: true });
    try {
      await this.run(async () => {
        const pick = await this.pickPlace();
        if (pick) { const p = this.game.map?.places[pick]; if (p) await this.enter(p.room, undefined, true); }
      });
    } finally { this.end(); }
  }

  /** Goes to a room without playing its arrival script (dev panel). */
  async teleport(id: Id): Promise<void> {
    this.begin({ enter: id });
    try { await this.enter(id, undefined, false); } finally { this.end(); }
  }

  /** Skip the current cutscene. */
  skip() { this.skipping = true; const o = this.cur; if (o) o.entry.skipAt = o.steps; }

  private async run(fn: () => Promise<void>) {
    this.busyCount++;
    this.onChange();
    try { await fn(); } finally {
      this.busyCount--;
      if (this.busyCount === 0) this.save();
      this.onChange();
    }
  }

  /** The targeted character turns to face the hero: two characters talking look at each other. */
  private faceHero(id: Id, room: RoomDef) {
    if (!room.actors?.[id]) return;
    const x = this.centerX(id, room);
    const hx = this.state.hero[room.id]?.[0];
    if (x !== null && hx !== undefined && Math.abs(hx - x) > 8) this.ui.face(id, hx < x ? 'left' : 'right');
  }

  private faceTowards(id: Id, room: RoomDef) {
    const x = this.centerX(id, room);
    const hx = this.state.hero[room.id]?.[0];
    if (x !== null && hx !== undefined) this.ui.face(this.heroId(), x < hx ? 'left' : 'right');
  }

  // ------------------------------------------------------------------ resolution

  /** Finds the reaction to an action and executes it. */
  async resolve(act: Action, ctx: Ctx): Promise<Source> {
    const { verb, a, b } = act;
    const room = ctx.room;
    const rule = this.findRule(verb, a, b, room);
    if (rule) { this.ran(rule.id); await this.exec(rule.do, ctx); return 'rule'; }

    if (verb === 'look' && !b) {
      const lines = room.look?.[a] ?? (this.state.inventory.includes(a) ? this.game.items[a]?.look : undefined);
      if (lines) { await this.say(HERO, this.pickLine(`look.${room.id}.${a}`, lines), ctx); return 'look'; }
    }
    if (verb === 'talk' && !b) {
      if (a === this.game.hintItem && this.state.inventory.includes(a)) { await this.hint(ctx); return 'hint'; }
      if (room.talk?.[a]) { await this.talkLoop(a, ctx); return 'talk'; }
    }
    const kind = this.findKind(verb, a, b, room);
    if (kind) { await this.say(HERO, kind, ctx); return 'kind'; }
    if (verb === 'give' && b) {
      // Another playable character takes the item into their own inventory.
      if (this.isPlayer(b) && b !== this.heroId() && this.state.inventory.includes(a) && !this.game.players?.sharedInventory) {
        this.transfer(a, b);
        await this.say(HERO, this.fill(this.game.players?.give ?? 'Here, {nom}: the {objet}.', a, b), ctx);
        return 'rule';
      }
      const char = room.actors?.[b]?.char;
      const refuse = char ? this.game.characters[char]?.refuse : undefined;
      if (refuse) { await this.say(char!, this.fill(refuse, a, b), ctx); return 'refuse'; }
    }
    const key = verb === 'use' && b ? 'use2' : verb;
    await this.say(HERO, this.fallback(key, a, b), ctx);
    return 'fallback';
  }

  /** Matching written rule (room, then game). Exposed for the solver. */
  findRule(verb: VerbId, a: Id, b: Id | undefined, room: RoomDef): (Rule & { id: string }) | null {
    const has = (x: Id | Id[] | undefined, v: Id | undefined) => x === undefined ? v === undefined : v !== undefined && (Array.isArray(x) ? x.includes(v) : x === v);
    const verbOk = (r: Rule) => Array.isArray(r.verb) ? r.verb.includes(verb) : r.verb === verb;
    const inv = this.state.inventory;
    for (const [list, scope] of [[room.on ?? [], room.id], [this.game.rules.on ?? [], 'game']] as const) {
      for (const [i, r] of list.entries()) {
        if (!verbOk(r) || !this.cond(r.if, room.id)) continue;
        const hit = (has(r.a, a) && has(r.b, b)) || (!!b && inv.includes(a) && inv.includes(b) && has(r.a, b) && has(r.b, a)); // two inventory items: order doesn't matter
        if (hit) return { ...r, id: ruleActionId(scope, i, r) };
      }
    }
    return null;
  }

  private findKind(verb: VerbId, a: Id, b: Id | undefined, room: RoomDef): string | null {
    const target = b ?? a;
    const kinds = this.kindsOf(target, room);
    const rules = this.game.rules.kinds ?? [];
    const verbOk = (v: VerbId | VerbId[]) => Array.isArray(v) ? v.includes(verb) : v === verb;
    const itemOk = (it: Id | Id[] | undefined) => it === undefined || (b !== undefined && (Array.isArray(it) ? it.includes(a) : it === a));
    const hit = rules.find((k) => verbOk(k.verb) && k.target === target && itemOk(k.item))
      ?? rules.find((k) => verbOk(k.verb) && !k.target && k.kind && kinds.includes(k.kind) && itemOk(k.item));
    return hit ? this.fill(hit.say, a, b) : null;
  }

  private fill(text: string, a: Id, b?: Id): string {
    const room = this.room();
    const target = b ?? a;
    return text.replaceAll('{objet}', this.nameOf(a, room)).replaceAll('{cible}', b ? this.nameOf(b, room) : '').replaceAll('{nom}', this.nameOf(target, room));
  }

  private fallback(key: string, a: Id, b?: Id): string {
    const list = this.game.rules.fallbacks[key as VerbId] ?? this.game.rules.fallbacks.look ?? ['…'];
    let i = Math.floor(this.rand() * list.length);
    if (list.length > 1 && i === this.lastFallback[key]) i = (i + 1) % list.length;
    this.lastFallback[key] = i;
    return this.fill(list[i], a, b);
  }

  private pickLine(key: string, lines: string | string[]): string {
    if (typeof lines === 'string') return lines;
    const n = this.state.counters[key] ?? 0;
    this.state.counters[key] = n + 1;
    return lines[n % lines.length];
  }

  private async hint(ctx: Ctx) {
    const room = ctx.room;
    const hints = room.hints ?? [];
    const idx = hints.findIndex((h) => !check(h.until, this.state, room.id));
    const voice = this.game.hintVoice ?? this.heroId();
    this.ran(`hint:${room.id}/${idx < 0 ? 'none' : idx}`);
    if (idx < 0) { await this.say(voice, this.fallback('talk', this.game.hintItem!), ctx); return; }
    await this.say(voice, this.pickLine(`hint.${room.id}.${idx}`, hints[idx].lines), ctx);
  }

  /** Conversation topic menu, until "Bye". */
  async talkLoop(actor: Id, ctx: Ctx) {
    const room = ctx.room;
    const char = room.actors?.[actor]?.char ?? actor;
    const g = this.game.globalTalk ?? {};
    for (;;) {
      const topics = (room.talk?.[actor] ?? []).map((t, i) => ({ t, i })).filter(({ t }) => this.cond(t.if, room.id));
      const topicKey = (t: (typeof topics)[number]['t'], i: number) => t.id ? `topic.${t.id}` : `${room.id}.${actor}.${i}`;
      const opts = topics.map(({ i, t }) => ({ text: t.topic, seen: !!this.state.seen[topicKey(t, i)] }));
      if (g.hug) opts.push({ text: g.hug, seen: false, global: true } as never);
      opts.push({ text: g.bye ?? '…', seen: false, global: true } as never);
      const pick = await this.choose(opts, char);
      if (pick < topics.length) {
        const { t, i } = topics[pick];
        this.ran(topicActionId(room.id, actor, i, t));
        await this.say(HERO, t.topic, ctx);
        await this.exec(t.do, ctx);
        this.state.seen[topicKey(t, i)] = 1;
        continue;
      }
      if (g.hug && pick === topics.length) {
        await this.say(HERO, g.hug, ctx);
        await this.say(char, this.game.characters[char]?.hug ?? '♥', ctx);
        continue;
      }
      if (g.byeLine) await this.say(HERO, g.byeLine, ctx);
      return;
    }
  }

  // ------------------------------------------------------------------ rooms

  /** Enters a room: state, display, music, then arrival script. */
  async enter(id: Id, at: Id | Point | undefined, runEnter: boolean) {
    const room = this.room(id);
    if (this.state.room !== id || at !== undefined) this.state.camera = { x: 0, follow: true };
    this.state.room = id;
    const L = this.layout(id);
    if (at) this.state.hero[id] = Array.isArray(at) ? at : (L.entries?.[at] ?? L.entries?.default ?? [320, 360]);
    else this.state.hero[id] ??= L.entries?.default ?? [320, 360];
    this.state.visited[id] = (this.state.visited[id] ?? 0) + 1;
    this.save();
    await this.ui.enterRoom(room, this.state);
    this.ui.inventory(this.state.inventory, this.state.used);
    if (room.music) this.ui.music({ play: room.music });
    this.onChange();
    if (runEnter && room.onEnter) { this.ran(`rule:${id}/enter`); await this.exec(room.onEnter, { room, fast: false }); }
    if (runEnter) this.startScripts(false);
  }

  // ------------------------------------------------------------------ the world's scripts and events

  /** A script by id, wherever it is declared (ids are unique in the game). */
  scriptDef(id: Id): ScriptDef | undefined {
    return this.game.scripts?.find((x) => x.id === id) ?? this.game.rooms.flatMap((r) => r.scripts ?? []).find((x) => x.id === id);
  }

  /** The scripts in scope right now: the current room's, then the game's. */
  scriptsHere(): ScriptDef[] { return [...(this.room().scripts ?? []), ...(this.game.scripts ?? [])]; }

  /** State of a script: next command (`pc`), finished, stopped. */
  scriptState(id: Id) {
    const def = this.scriptDef(id);
    const st = (this.state.scripts ??= {})[id] ??= { pc: 0 };
    // A v3 save follows the named step after authoring steps are reordered. `pc` remains for v2 saves and debugging.
    if (st.step && def?.stepIds) {
      const pc = def.stepIds.indexOf(st.step);
      if (pc >= 0) st.pc = pc;
    }
    if (def?.stepIds) st.step = def.stepIds[st.pc];
    return st;
  }

  /**
   * One step of a script. 'ran': a command ran, or a wait was satisfied. 'blocked': the engine is busy (player action,
   * cutscene, conversation, minigame), the `while` condition is false, a `waitUntil` is false or a `waitEvent` pending.
   * 'wrapped': a loop starts again. 'done', 'off': finished, stopped.
   */
  async advance(id: Id): Promise<'ran' | 'blocked' | 'wrapped' | 'done' | 'off'> {
    const def = this.scriptDef(id);
    if (!def) throw new Error(`unknown script: ${id}`);
    const s = this.state;
    const st = this.scriptState(id);
    this.reads?.add(`script:${id}`);
    if (st.off) return 'off';
    if (st.done) return 'done';
    if (this.busyCount > 0 || s.done) return 'blocked';
    const room = this.room();
    if (def.while && !this.cond(def.while, room.id)) { if (st.pc) { this.begin({ step: id }); st.pc = 0; this.end(); } return 'blocked'; }
    if (st.pc >= def.do.length) {
      if (!def.loop) { st.done = true; this.save(); return 'done'; }
      this.begin({ step: id }); st.pc = 0; this.end();
      return 'wrapped';
    }
    const c = def.do[st.pc];
    if (typeof c === 'object') {
      if ('waitUntil' in c) { if (!this.cond(c.waitUntil, room.id)) return 'blocked'; this.begin({ step: id }); st.pc++; this.end(); return 'ran'; }
      if ('waitEvent' in c) return 'blocked'; // emit() moves the script past it
    }
    this.begin({ step: id });
    this.ran(`script:${id}`);
    try { await this.step(c, { room, fast: false }); } finally { st.pc++; if (def.stepIds) st.step = def.stepIds[st.pc]; this.end(); }
    this.log('script', `${id} ran ${describeCmd(c)} → ${st.pc >= def.do.length ? (def.loop ? 'loops' : 'done') : st.pc}`);
    if (this.busyCount === 0) this.save();
    this.onChange();
    return 'ran';
  }

  /**
   * Runs a script until it blocks, finishes or completes one iteration of its loop (tests, solver). True if anything ran.
   * `turn`: stop before the next `wait` instead, once something ran: for the solver, letting time pass is one choice at a
   * time (a patrol that walks in, then out, must be seen in between).
   */
  async runScript(id: Id, turn = false): Promise<boolean> {
    let ran = false;
    for (let guard = 0; guard < 1000; guard++) {
      if (turn && ran) { const c = this.scriptDef(id)?.do[this.scriptState(id).pc]; if (typeof c === 'object' && 'wait' in c) return ran; }
      const r = await this.advance(id);
      if (r !== 'ran') return ran;
      ran = true;
    }
    return ran;
  }

  /** Starts the loops of the scripts in scope (auto mode): the room's on each room entry, the game's too on a new session. */
  private startScripts(session: boolean) {
    this.roomGen++;
    if (session) this.sessionGen++;
    if (!this.autoScripts) return;
    for (const def of this.room().scripts ?? []) void this.loop(def.id, false, this.roomGen);
    if (session) for (const def of this.game.scripts ?? []) void this.loop(def.id, true, this.sessionGen);
  }

  private async loop(id: Id, global: boolean, gen: number) {
    this.loops.add(id);
    try {
      while (this.state && !this.state.done && gen === (global ? this.sessionGen : this.roomGen)) {
        let r: Awaited<ReturnType<Engine['advance']>>;
        try { r = await this.advance(id); } catch (e) { console.error(`script ${id}:`, e); return; }
        if (r === 'done' || r === 'off') return;
        if (r !== 'ran') await this.ui.wait(250, false);
      }
    } finally { this.loops.delete(id); }
  }

  /** Fires an event: moves the scripts waiting for it, then runs the listeners of the room, then of the game. */
  async emit(id: Id, ctx: Ctx) {
    const s = this.state;
    this.log('event', `emit ${id}`);
    for (const def of [...(this.game.scripts ?? []), ...this.game.rooms.flatMap((r) => r.scripts ?? [])]) {
      const st = this.scriptState(def.id);
      this.reads?.add(`script:${def.id}`);
      const cur = def.do[st.pc];
      if (!st.done && !st.off && cur && typeof cur === 'object' && 'waitEvent' in cur && cur.waitEvent === id) st.pc++;
    }
    const scopes: [EventRule[], string][] = [[ctx.room.events ?? [], ctx.room.id], [this.game.events ?? [], 'game']];
    for (const [list, scope] of scopes) for (const [i, ev] of list.entries()) {
      if (ev.on !== id || !this.cond(ev.if, ctx.room.id)) continue;
      if (ev.once) { const k = `event.${ev.id ?? `${scope}.${i}`}`; this.reads?.add(`seen:${k}`); if (s.seen[k]) continue; s.seen[k] = 1; }
      this.log('event', `${id} → ${scope}.events[${i}]${ev.once ? ' (once)' : ''}`);
      this.ran(listenerActionId(scope, i, ev));
      await this.exec(ev.do, ctx);
    }
  }

  // ------------------------------------------------------------------ scripts

  /** Runs a script in the current room (usable by the UI or tests). */
  async script(cmds: Cmd[]) {
    this.begin({ script: cmds });
    try { await this.run(() => this.exec(cmds, { room: this.room(), fast: false })); } finally { this.end(); }
  }

  private async say(who: Id, text: string, ctx: Ctx, shout = false, voice?: Id) {
    await this.ui.say(this.who(who), text, { shout, fast: ctx.fast, voice });
  }

  private point(t: Id | Point, room: RoomDef): Point {
    if (Array.isArray(t)) return t;
    const ap = this.approach(t, room);
    if (!ap) throw new Error(`no point for "${t}" in ${room.id} (missing layout?)`);
    return ap;
  }

  private actorKey(who: Id, room: RoomDef) { return `${room.id}.${who}`; }

  async exec(cmds: Cmd[] | undefined, ctx: Ctx): Promise<void> {
    if (!cmds) return;
    for (const c of cmds) {
      if (this.skipping && !ctx.fast) ctx = { ...ctx, fast: true };
      await this.step(c, ctx);
      if (this.state.done) return;
    }
  }

  private async step(c: Cmd, ctx: Ctx): Promise<void> {
    const s = this.state;
    const room = ctx.room;
    const o = this.cur;
    if (o) { if (o.src?.skipAt === o.steps) this.skipping = true; o.steps++; }
    if (typeof c === 'string') return this.say(HERO, c, ctx);
    if ('say' in c) return this.say(c.say[0], c.say[1], ctx, !!c.shout, c.voice);
    if ('walk' in c) {
      const who = this.who(c.who ?? HERO);
      const end = await this.ui.walk(who, this.point(c.walk, room), ctx.fast);
      if (end) {
        if (who === this.heroId()) s.hero[room.id] = end;
        else s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], x: end[0], y: end[1] };
      }
      return;
    }
    if ('place' in c) {
      const who = this.who(c.place[0]);
      this.ui.place(who, c.place[1], c.face);
      if (who === this.heroId()) s.hero[room.id] = c.place[1];
      else s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], x: c.place[1][0], y: c.place[1][1], ...(c.face ? { facing: c.face } : {}) };
      return;
    }
    if ('face' in c) {
      const who = this.who(c.who ?? HERO);
      let dir = c.face as 'left' | 'right';
      if (c.face !== 'left' && c.face !== 'right') {
        const x = this.centerX(c.face, room);
        const me = who === this.heroId() ? s.hero[room.id]?.[0] : this.centerX(who, room);
        dir = x !== null && me !== undefined && me !== null && x < me ? 'left' : 'right';
      }
      this.ui.face(who, dir);
      if (who !== this.heroId()) s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], facing: dir };
      return;
    }
    if ('pose' in c) {
      const who = this.who(c.pose[0]);
      this.ui.pose(who, c.pose[1]);
      if (who !== this.heroId()) s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], pose: c.pose[1] };
      return;
    }
    if ('anim' in c) {
      const who = this.who(c.anim[0]);
      if (!c.at) return this.ui.anim(who, c.anim[1], c.ms ?? ANIM_MS, ctx.fast);
      // Frame events: the commands of `at` run when the pose reaches that frame (at the character's fps).
      const fps = this.character(who)?.fps ?? FPS;
      const p = this.ui.anim(who, c.anim[1], c.ms ?? ANIM_MS, ctx.fast);
      let t = 0;
      for (const i of Object.keys(c.at).map(Number).sort((a, b) => a - b)) {
        const at = (i * 1000) / fps;
        if (at > t) { await this.ui.wait(at - t, ctx.fast); t = at; }
        await this.exec(c.at[i], ctx);
      }
      await p;
      return;
    }
    if ('play' in c) {
      const [pid, name] = c.play;
      const def = room.props?.[pid]?.anims?.[name];
      if (!def) throw new Error(`no animation "${name}" on prop "${pid}" in ${room.id}`);
      const fps = def.fps ?? FPS;
      if (def.loop) {
        // A loop never ends: its frame events only play sounds and shakes (the validator refuses anything else).
        const at = def.at;
        this.ui.propLoop(pid, def.frames, fps, at && Object.keys(at).length ? (i) => { for (const x of at[i] ?? []) if (typeof x === 'object' && ('sfx' in x || 'shake' in x)) void this.step(x, ctx); } : undefined);
        return;
      }
      for (let i = 0; i < def.frames.length; i++) {
        this.ui.propFrame(pid, def.frames[i]);
        if (def.at?.[i]) await this.exec(def.at[i], ctx);
        await this.ui.wait(1000 / fps, ctx.fast);
      }
      this.ui.propFrame(pid, null);
      return;
    }
    if ('stopAnim' in c) { this.ui.propLoop(c.stopAnim, [], 0); return; }
    if ('camera' in c) {
      const W = this.layout(room.id).width ?? 640;
      const clamp = (x: number) => Math.max(0, Math.min(W - 640, x));
      if (c.camera === 'follow' || c.camera === 'reset') { s.camera = { x: 0, follow: true }; await this.ui.camera(null, true, 0, ctx.fast); return; }
      const x = clamp('pan' in c.camera ? c.camera.pan : (this.centerX(c.camera.to, room) ?? 320) - 320);
      s.camera = { x, follow: false };
      await this.ui.camera(x, false, c.camera.ms ?? CAMERA_MS, ctx.fast);
      return;
    }
    if ('wait' in c) return this.ui.wait(c.wait, ctx.fast);
    if ('parallel' in c) { await Promise.all(c.parallel.map((b) => this.exec(b, ctx))); return; }
    if ('prop' in c) {
      const [id, st] = c.prop;
      const key = id.includes('.') ? id : `${room.id}.${id}`;
      s.props[key] = st;
      if (key.startsWith(`${s.room}.`)) this.ui.prop(key.slice(s.room.length + 1), st);
      return;
    }
    if ('show' in c || 'hide' in c) {
      const id = 'show' in c ? c.show : (c as { hide: Id }).hide;
      const vis = 'show' in c;
      s.actors[this.actorKey(id, room)] = { ...s.actors[this.actorKey(id, room)], visible: vis };
      return this.ui.show(id, vis, c.fade ?? 0, ctx.fast);
    }
    if ('gain' in c) {
      if (!s.inventory.includes(c.gain)) s.inventory.push(c.gain);
      if (s.used?.includes(c.gain)) s.used = s.used.filter((x) => x !== c.gain);
      this.ui.inventory(s.inventory, s.used); this.onChange(); return;
    }
    if ('lose' in c) { s.inventory = s.inventory.filter((x) => x !== c.lose); this.ui.inventory(s.inventory, s.used); this.onChange(); return; }
    if ('used' in c) {
      const u = (s.used ??= []);
      for (const id of Array.isArray(c.used) ? c.used : [c.used]) if (!u.includes(id)) u.push(id);
      this.ui.inventory(s.inventory, u); this.onChange(); return;
    }
    if ('set' in c) { const [k, v]: [Id, Value] = Array.isArray(c.set) ? c.set : [c.set, true]; s.flags[k] = v; return; }
    if ('unset' in c) { delete s.flags[c.unset]; return; }
    if ('inc' in c) { s.flags[c.inc] = (typeof s.flags[c.inc] === 'number' ? (s.flags[c.inc] as number) : 0) + (c.by ?? 1); return; }
    if ('unlock' in c) { if (!s.unlocked.includes(c.unlock)) s.unlocked.push(c.unlock); return; }
    if ('goto' in c) { await this.enter(c.goto, c.at, true); return; }
    if ('map' in c) {
      const pick = await this.pickPlace();
      if (pick) { const p = this.game.map?.places[pick]; if (p) await this.enter(p.room, undefined, true); }
      return;
    }
    if ('moveActor' in c) {
      const [char, to] = c.moveActor;
      this.log('actor', `${char} → ${to}`);
      const dest = this.room(to);
      const from = s.where?.[char];
      (s.where ??= {})[char] = to;
      const inst = this.instanceOf(char, dest);
      let at: Point | undefined;
      if (inst) {
        const key = `${to}.${inst}`;
        const L = this.layout(to);
        at = c.at ? (Array.isArray(c.at) ? c.at : L.entries?.[c.at]) : undefined;
        const o = { ...s.actors[key] };
        delete o.x; delete o.y; delete o.visible;
        s.actors[key] = at ? { ...o, x: at[0], y: at[1] } : o;
      }
      // The view: the character leaves the room on screen, or arrives in it.
      if (from === s.room && to !== s.room) { const i = this.instanceOf(char, room); if (i) await this.ui.show(i, false, 0, true); }
      if (to === s.room && inst) {
        const pos = at ?? (() => { const a = this.layout(to).actors?.[inst]; return a ? [a.x, a.y] as Point : undefined; })();
        if (pos) this.ui.place(inst, pos);
        await this.ui.show(inst, true, 0, true);
      }
      this.onChange();
      return;
    }
    if ('emit' in c) return this.emit(c.emit, ctx);
    if ('waitUntil' in c) { for (let guard = 0; guard < 100000 && !this.cond(c.waitUntil, room.id); guard++) await this.ui.wait(250, ctx.fast); return; }
    if ('waitEvent' in c) return; // only meaningful at the top level of a script (advance); elsewhere it is a no-op
    if ('startScript' in c) {
      if (!this.scriptDef(c.startScript)) throw new Error(`unknown script: ${c.startScript}`);
      (s.scripts ??= {})[c.startScript] = { pc: 0 };
      if (this.autoScripts && !this.loops.has(c.startScript)) {
        const global = !!this.game.scripts?.some((x) => x.id === c.startScript);
        if (global || this.room().scripts?.some((x) => x.id === c.startScript)) void this.loop(c.startScript, global, global ? this.sessionGen : this.roomGen);
      }
      return;
    }
    if ('stopScript' in c) { this.scriptState(c.stopScript).off = true; return; }
    if ('switchPlayer' in c) {
      if (!this.isPlayer(c.switchPlayer)) throw new Error(`not a playable character: ${c.switchPlayer}`);
      if (c.switchPlayer === this.heroId()) return;
      await this.swap(c.switchPlayer);
      await this.enter(s.room, undefined, false);
      this.startScripts(true);
      return;
    }
    if ('transfer' in c) { this.transfer(c.transfer[0], c.transfer[1]); return; }
    if ('custom' in c) {
      const cmd = this.opts.commands?.[c.custom];
      if (!cmd) throw new Error(`unknown custom command: ${c.custom} (export it from games/<id>/index.ts "commands")`);
      await this.exec(cmd.effects, ctx);
      if (cmd.run && this.opts.runCustom && !ctx.fast) {
        // `run` is display only: in dev (journal on), a state change outside the declared `effects` is reported.
        const before = this.traceOn ? structuredClone(s) : null;
        await cmd.run({ game: this.game, state: s, room, args: c.args, ui: this.ui, scene: this.opts.scene?.(), fast: ctx.fast });
        if (before) {
          const diff = stateDiff(before, s);
          if (diff.length) { const msg = `custom "${c.custom}" changed ${diff.join(', ')} outside its declared effects`; this.log('action', msg); console.warn(msg); }
        }
      }
      return;
    }
    if ('sfx' in c) { if (!ctx.fast) this.ui.sfx(c.sfx); return; }
    if ('music' in c) { this.ui.music(typeof c.music === 'string' ? { play: c.music } : c.music); return; }
    if ('toast' in c) { this.ui.toast(c.toast); return; }
    if ('shake' in c) { if (!ctx.fast) this.ui.shake(c.shake); return; }
    if ('if' in c) return this.exec(this.cond(c.if, room.id) ? c.then : c.else, ctx);
    if ('once' in c) {
      const k = c.key!;
      this.reads?.add(`once:${k}`);
      if (s.counters[k]) return;
      s.counters[k] = 1;
      return this.exec(c.once, ctx);
    }
    if ('nth' in c || 'cycle' in c) {
      const list = 'nth' in c ? c.nth : c.cycle;
      const k = c.key!;
      this.reads?.add(`nth:${k}`);
      const n = s.counters[k] ?? 0;
      s.counters[k] = n + 1;
      const i = 'nth' in c ? Math.min(n, list.length - 1) : n % list.length;
      return this.exec(list[i], ctx);
    }
    if ('random' in c) {
      const k = c.key!;
      this.reads?.add(`random:${k}`);
      let i = Math.floor(this.rand() * c.random.length);
      if (c.random.length > 1 && i === s.counters[k]) i = (i + 1) % c.random.length;
      s.counters[k] = i;
      return this.exec(c.random[i], ctx);
    }
    if ('cutscene' in c) {
      this.ui.cutscene(true);
      this.skipping = false;
      try { await this.exec(c.cutscene, ctx); } finally { this.skipping = false; this.ui.cutscene(false); }
      return;
    }
    if ('choice' in c) {
      const choiceKey = (o: (typeof c.choice)[number]) => `choice.${o.id ?? `${room.id}.${o.text}`}`;
      const opts = c.choice.map((o, i) => ({ o, i })).filter(({ o }) => { const k = choiceKey(o); if (o.once) this.reads?.add(`seen:${k}`); return this.cond(o.if, room.id) && !(o.once && s.seen[k]); });
      if (!opts.length) return;
      const pick = await this.choose(opts.map(({ o }) => ({ text: o.text })));
      const { o } = opts[Math.max(0, Math.min(pick, opts.length - 1))];
      if (o.once) s.seen[choiceKey(o)] = 1;
      await this.say(HERO, o.text, ctx);
      return this.exec(o.do, ctx);
    }
    if ('minigame' in c) {
      this.ran(`minigame:${c.minigame}`);
      await this.ui.minigame(c.minigame, c.params ?? {});
      return this.exec(c.then, ctx);
    }
    if ('phone' in c) {
      const who = Array.isArray(c.phone) ? c.phone.map((w) => this.who(w)) : this.who(c.phone);
      await this.ui.phone(who, true);
      await this.exec(c.do, ctx);
      await this.ui.phone(who, false);
      return;
    }
    if ('guide' in c) {
      const g = c.guide;
      if (ctx.fast) return;
      await this.say(HERO, g.say, ctx);
      await new Promise<void>((resolve) => {
        this.guideWait = { ...g, resolve };
        this.ui.guide({ verb: g.verb, target: g.target });
        this.onChange();
      });
      return;
    }
    if ('talk' in c) return this.talkLoop(c.talk, ctx);
    if ('hint' in c) return this.hint(ctx);
    if ('ending' in c || 'reveal' in c) {
      await this.ui.ending('open');
      await this.exec(c.after, { ...ctx, fast: false });
      // The sealed ending ends the game as `end` does: `state.done` is the one truth an e2e or a replay reads, the
      // card is only how it is shown.
      s.done = true; this.save();
      return this.ui.ending('card');
    }
    if ('end' in c) { s.done = true; this.save(); this.ui.end(); return; }
    throw new Error('unknown command: ' + JSON.stringify(c));
  }
}
