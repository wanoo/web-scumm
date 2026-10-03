import { check } from './cond';
import { assignKeys, EMPTY_LAYOUT, FLOOR, NEAR } from './define';
import type { Presenter, SaveStore } from './ports';
import type { CharacterDef, Cmd, EventRule, GameDef, GameState, Id, Layout, Point, RoomDef, Rule, ScriptDef, Value, VerbId } from './types';

/** A player action: VERB a (with/to b). `a` can be an inventory item, `b` is always a target. */
export interface Action { verb: VerbId; a: Id; b?: Id }

/** Where the response to an action comes from: useful to the solver (only written rules move things forward). */
export type Source = 'rule' | 'look' | 'talk' | 'hint' | 'kind' | 'refuse' | 'fallback' | 'guide';

interface Ctx { room: RoomDef; fast: boolean }

const HERO = 'hero';

const near = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= NEAR;

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
  /** Injectable randomness (the solver makes it deterministic). */
  random: () => number = Math.random;
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

  constructor(game: GameDef, layouts: Record<Id, Layout>, readonly ui: Presenter, readonly store: SaveStore) {
    this.game = assignKeys(game);
    this.layouts = layouts;
    this.rooms = new Map(game.rooms.map((r) => [r.id, r]));
  }

  // ------------------------------------------------------------------ game session

  fresh(): GameState {
    const s = this.game.start;
    return {
      v: this.game.saveVersion, room: s.room, inventory: [...(s.inventory ?? [])], flags: { ...(s.flags ?? {}) },
      props: {}, actors: {}, hero: {}, unlocked: [...(s.unlocked ?? [])], visited: {}, counters: {}, seen: {}, started: Date.now(),
      where: this.homes(), scripts: {},
    };
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
    return s;
  }

  hasSave(): boolean {
    const s = this.store.load();
    return !!s && s.v === this.game.saveVersion;
  }

  async newGame(): Promise<void> {
    this.dropGuide();
    this.state = this.ensureState(this.fresh());
    this.store.save(this.state);
    // The prologue runs before the first room's arrival script (otherwise the tutorial would wait for it).
    await this.enter(this.state.room, undefined, false);
    if (this.game.start.intro) await this.script(this.game.start.intro);
    const first = this.room();
    if (first.onEnter) await this.run(() => this.exec(first.onEnter, { room: first, fast: false }));
    this.startScripts(true);
  }

  async continueGame(): Promise<void> {
    const s = this.store.load();
    if (!s || s.v !== this.game.saveVersion) return this.newGame();
    this.state = this.ensureState(s);
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
    this.state = this.ensureState(s);
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

  heroId() { return this.game.hero; }
  private who(w: Id) { return w === HERO ? this.game.hero : w; }

  /** Display name of any id (item, actor, prop, hotspot). */
  nameOf(id: Id, room: RoomDef = this.room()): string {
    if (this.game.items[id] && this.state.inventory.includes(id)) return this.game.items[id].name;
    const act = room.actors?.[id];
    if (act) return act.name ?? this.game.characters[act.char]?.name ?? id;
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
    if (act) { const w = this.state.where?.[act.char]; if (w !== undefined && w !== room.id) return false; }
    const over = this.state.actors[`${room.id}.${id}`]?.visible;
    if (over !== undefined) return over;
    const def = act ?? room.props?.[id] ?? room.hotspots?.[id];
    return def ? check(def.visible, this.state, room.id) : false;
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
    ];
    return ids.filter((id) => this.visible(id, room));
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
    return L.actors?.[id]?.x ?? null;
  }

  // ------------------------------------------------------------------ player actions

  /** Executes a player action: walk to the target, then react. */
  async act(act: Action): Promise<Source | null> {
    if (this.busy) return null;
    // Guided tutorial: only one action is accepted, others repeat the instruction.
    if (this.guideWait) {
      const g = this.guideWait;
      const ok = g.verb === act.verb && (act.a === g.target || act.b === g.target);
      if (!ok) { await this.run(async () => { await this.ui.say(this.game.hero, g.say, {}); }); return 'guide'; }
    }
    let src: Source | null = null;
    await this.run(async () => {
      const room = this.room();
      const target = act.b ?? act.a;
      const inScene = !this.state.inventory.includes(target) && this.targets(room).includes(target);
      if (inScene) {
        const ap = this.approach(target, room);
        if (ap) {
          const end = await this.ui.walk(this.game.hero, ap, false);
          if (!end) return;
          this.state.hero[room.id] = end;
        }
      }
      if (inScene) { this.faceTowards(target, room); this.faceHero(target, room); }
      src = await this.resolve(act, { room, fast: false });
    });
    if (this.guideWait && src !== null) {
      const g = this.guideWait;
      if (g.verb === act.verb && (act.a === g.target || act.b === g.target)) { this.guideWait = null; this.ui.guide(null); g.resolve(); }
    }
    return src;
  }

  /** Walk to a point on the floor. */
  async walkTo(p: Point): Promise<void> {
    if (this.busy) return;
    if (this.guideWait) { const g = this.guideWait; await this.run(async () => { await this.ui.say(this.game.hero, g.say, {}); }); return; }
    const end = await this.ui.walk(this.game.hero, p, false);
    if (end) { this.state.hero[this.state.room] = end; this.save(); }
  }

  /** Travel to a place on the map. */
  async travel(place: Id): Promise<void> {
    const p = this.game.map?.places[place];
    if (!p || !this.state.unlocked.includes(place)) return;
    await this.run(() => this.enter(p.room, undefined, true));
  }

  /** Opens the map from the UI. */
  async openMap(): Promise<void> {
    if (this.busy) return;
    await this.run(async () => {
      const pick = await this.ui.openMap(this.state);
      if (pick) { const p = this.game.map?.places[pick]; if (p) await this.enter(p.room, undefined, true); }
    });
  }

  /** Skip the current cutscene. */
  skip() { this.skipping = true; }

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
    if (x !== null && hx !== undefined) this.ui.face(this.game.hero, x < hx ? 'left' : 'right');
  }

  // ------------------------------------------------------------------ resolution

  /** Finds the reaction to an action and executes it. */
  async resolve(act: Action, ctx: Ctx): Promise<Source> {
    const { verb, a, b } = act;
    const room = ctx.room;
    const rule = this.findRule(verb, a, b, room);
    if (rule) { await this.exec(rule.do, ctx); return 'rule'; }

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
      const char = room.actors?.[b]?.char;
      const refuse = char ? this.game.characters[char]?.refuse : undefined;
      if (refuse) { await this.say(char!, this.fill(refuse, a, b), ctx); return 'refuse'; }
    }
    const key = verb === 'use' && b ? 'use2' : verb;
    await this.say(HERO, this.fallback(key, a, b), ctx);
    return 'fallback';
  }

  /** Matching written rule (room, then game). Exposed for the solver. */
  findRule(verb: VerbId, a: Id, b: Id | undefined, room: RoomDef): Rule | null {
    const has = (x: Id | Id[] | undefined, v: Id | undefined) => x === undefined ? v === undefined : v !== undefined && (Array.isArray(x) ? x.includes(v) : x === v);
    const verbOk = (r: Rule) => Array.isArray(r.verb) ? r.verb.includes(verb) : r.verb === verb;
    const inv = this.state.inventory;
    for (const list of [room.on ?? [], this.game.rules.on ?? []]) {
      for (const r of list) {
        if (!verbOk(r) || !check(r.if, this.state, room.id)) continue;
        if (has(r.a, a) && has(r.b, b)) return r;
        // two inventory items: order doesn't matter
        if (b && inv.includes(a) && inv.includes(b) && has(r.a, b) && has(r.b, a)) return r;
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
    let i = Math.floor(this.random() * list.length);
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
    const voice = this.game.hintVoice ?? this.game.hero;
    if (idx < 0) { await this.say(voice, this.fallback('talk', this.game.hintItem!), ctx); return; }
    await this.say(voice, this.pickLine(`hint.${room.id}.${idx}`, hints[idx].lines), ctx);
  }

  /** Conversation topic menu, until "Bye". */
  async talkLoop(actor: Id, ctx: Ctx) {
    const room = ctx.room;
    const char = room.actors?.[actor]?.char ?? actor;
    const g = this.game.globalTalk ?? {};
    for (;;) {
      const topics = (room.talk?.[actor] ?? []).map((t, i) => ({ t, i })).filter(({ t }) => check(t.if, this.state, room.id));
      const opts = topics.map(({ i, t }) => ({ text: t.topic, seen: !!this.state.seen[`${room.id}.${actor}.${i}`] }));
      if (g.hug) opts.push({ text: g.hug, seen: false, global: true } as never);
      opts.push({ text: g.bye ?? '…', seen: false, global: true } as never);
      const pick = await this.ui.choose(opts, char);
      if (pick < topics.length) {
        const { t, i } = topics[pick];
        await this.say(HERO, t.topic, ctx);
        await this.exec(t.do, ctx);
        this.state.seen[`${room.id}.${actor}.${i}`] = 1;
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
    if (runEnter && room.onEnter) await this.exec(room.onEnter, { room, fast: false });
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
  scriptState(id: Id) { return (this.state.scripts ??= {})[id] ??= { pc: 0 }; }

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
    if (st.off) return 'off';
    if (st.done) return 'done';
    if (this.busyCount > 0 || s.done) return 'blocked';
    const room = this.room();
    if (def.while && !check(def.while, s, room.id)) { st.pc = 0; return 'blocked'; }
    if (st.pc >= def.do.length) {
      if (!def.loop) { st.done = true; this.save(); return 'done'; }
      st.pc = 0;
      return 'wrapped';
    }
    const c = def.do[st.pc];
    if (typeof c === 'object') {
      if ('waitUntil' in c) { if (!check(c.waitUntil, s, room.id)) return 'blocked'; st.pc++; return 'ran'; }
      if ('waitEvent' in c) return 'blocked'; // emit() moves the script past it
    }
    await this.step(c, { room, fast: false });
    st.pc++;
    if (this.busyCount === 0) this.save();
    this.onChange();
    return 'ran';
  }

  /** Runs a script until it blocks, finishes or completes one iteration of its loop (tests, solver). True if anything ran. */
  async runScript(id: Id): Promise<boolean> {
    let ran = false;
    for (let guard = 0; guard < 1000; guard++) {
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
    for (const def of [...(this.game.scripts ?? []), ...this.game.rooms.flatMap((r) => r.scripts ?? [])]) {
      const st = this.scriptState(def.id);
      const cur = def.do[st.pc];
      if (!st.done && !st.off && cur && typeof cur === 'object' && 'waitEvent' in cur && cur.waitEvent === id) st.pc++;
    }
    const scopes: [EventRule[], string][] = [[ctx.room.events ?? [], ctx.room.id], [this.game.events ?? [], 'game']];
    for (const [list, scope] of scopes) for (const [i, ev] of list.entries()) {
      if (ev.on !== id || !check(ev.if, s, ctx.room.id)) continue;
      if (ev.once) { const k = `event.${scope}.${i}`; if (s.seen[k]) continue; s.seen[k] = 1; }
      await this.exec(ev.do, ctx);
    }
  }

  // ------------------------------------------------------------------ scripts

  /** Runs a script in the current room (usable by the UI or tests). */
  async script(cmds: Cmd[]) { await this.run(() => this.exec(cmds, { room: this.room(), fast: false })); }

  private async say(who: Id, text: string, ctx: Ctx, shout = false) {
    await this.ui.say(this.who(who), text, { shout, fast: ctx.fast });
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
    if (typeof c === 'string') return this.say(HERO, c, ctx);
    if ('say' in c) return this.say(c.say[0], c.say[1], ctx, !!c.shout);
    if ('walk' in c) {
      const who = this.who(c.who ?? HERO);
      const end = await this.ui.walk(who, this.point(c.walk, room), ctx.fast);
      if (end) {
        if (who === this.game.hero) s.hero[room.id] = end;
        else s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], x: end[0], y: end[1] };
      }
      return;
    }
    if ('place' in c) {
      const who = this.who(c.place[0]);
      this.ui.place(who, c.place[1], c.face);
      if (who === this.game.hero) s.hero[room.id] = c.place[1];
      else s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], x: c.place[1][0], y: c.place[1][1], ...(c.face ? { facing: c.face } : {}) };
      return;
    }
    if ('face' in c) {
      const who = this.who(c.who ?? HERO);
      let dir = c.face as 'left' | 'right';
      if (c.face !== 'left' && c.face !== 'right') {
        const x = this.centerX(c.face, room);
        const me = who === this.game.hero ? s.hero[room.id]?.[0] : this.centerX(who, room);
        dir = x !== null && me !== undefined && me !== null && x < me ? 'left' : 'right';
      }
      this.ui.face(who, dir);
      if (who !== this.game.hero) s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], facing: dir };
      return;
    }
    if ('pose' in c) {
      const who = this.who(c.pose[0]);
      this.ui.pose(who, c.pose[1]);
      if (who !== this.game.hero) s.actors[this.actorKey(who, room)] = { ...s.actors[this.actorKey(who, room)], pose: c.pose[1] };
      return;
    }
    if ('anim' in c) return this.ui.anim(this.who(c.anim[0]), c.anim[1], c.ms ?? 800, ctx.fast);
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
      const pick = await this.ui.openMap(s);
      if (pick) { const p = this.game.map?.places[pick]; if (p) await this.enter(p.room, undefined, true); }
      return;
    }
    if ('moveActor' in c) {
      const [char, to] = c.moveActor;
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
    if ('waitUntil' in c) { for (let guard = 0; guard < 100000 && !check(c.waitUntil, s, room.id); guard++) await this.ui.wait(250, ctx.fast); return; }
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
    if ('sfx' in c) { if (!ctx.fast) this.ui.sfx(c.sfx); return; }
    if ('music' in c) { this.ui.music(typeof c.music === 'string' ? { play: c.music } : c.music); return; }
    if ('toast' in c) { this.ui.toast(c.toast); return; }
    if ('shake' in c) { if (!ctx.fast) this.ui.shake(c.shake); return; }
    if ('if' in c) return this.exec(check(c.if, s, room.id) ? c.then : c.else, ctx);
    if ('once' in c) {
      const k = c.key!;
      if (s.counters[k]) return;
      s.counters[k] = 1;
      return this.exec(c.once, ctx);
    }
    if ('nth' in c || 'cycle' in c) {
      const list = 'nth' in c ? c.nth : c.cycle;
      const k = c.key!;
      const n = s.counters[k] ?? 0;
      s.counters[k] = n + 1;
      const i = 'nth' in c ? Math.min(n, list.length - 1) : n % list.length;
      return this.exec(list[i], ctx);
    }
    if ('random' in c) {
      const k = c.key!;
      let i = Math.floor(this.random() * c.random.length);
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
      const opts = c.choice.map((o, i) => ({ o, i })).filter(({ o, i }) => check(o.if, s, room.id) && !(o.once && s.seen[`choice.${room.id}.${o.text}`]));
      if (!opts.length) return;
      const pick = await this.ui.choose(opts.map(({ o }) => ({ text: o.text })));
      const { o } = opts[Math.max(0, Math.min(pick, opts.length - 1))];
      if (o.once) s.seen[`choice.${room.id}.${o.text}`] = 1;
      await this.say(HERO, o.text, ctx);
      return this.exec(o.do, ctx);
    }
    if ('minigame' in c) {
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
      return this.ui.ending('card');
    }
    if ('end' in c) { s.done = true; this.save(); this.ui.end(); return; }
    throw new Error('unknown command: ' + JSON.stringify(c));
  }
}
