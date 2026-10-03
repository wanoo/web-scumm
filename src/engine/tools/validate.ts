// Content validator: checks that everything referenced exists, and flags what's missing for a good experience.
// Pure TypeScript (no DOM): runs in node (npm run validate) and in tests.
import { condFlags } from '../core/cond';
import { normalizeExits } from '../core/define';
import { worldGraph } from './graph';
import type { Cmd, Cond, EventRule, GameDef, Id, Layout, RoomDef, Rule, ScriptDef, VerbId } from '../core/types';

export interface AssetIndex {
  images: Record<string, [number, number]>;
  audio?: Record<string, unknown>;
}

export interface ValidateOptions {
  assets?: AssetIndex;
  /** Ids of the minigames known to the engine. Absent = no check. */
  minigameIds?: string[];
  /** Required params of each minigame (Minigame.required). Absent = no check. */
  minigameParams?: Record<string, string[]>;
  /** Maximum length of a line before a warning. */
  maxText?: number;
}

export interface Report { errors: string[]; warnings: string[] }

const HERO = 'hero';

export function validate(gameIn: GameDef, layouts: Record<string, Layout>, opts: ValidateOptions = {}): Report {
  // Declared exits are checked as what they become (hotspots and rules), on a copy: the caller's game stays as written.
  const game = normalizeExits(structuredClone(gameIn));
  const errors: string[] = [];
  const warnings: string[] = [];
  const maxText = opts.maxText ?? 140;
  const err = (where: string, msg: string) => errors.push(`${where} › ${msg}`);
  const warn = (where: string, msg: string) => warnings.push(`${where} › ${msg}`);

  const roomIds = new Set<string>();
  for (const r of game.rooms) {
    if (roomIds.has(r.id)) err(r.id, `duplicate room: "${r.id}"`);
    roomIds.add(r.id);
  }
  const rooms = new Map(game.rooms.map((r) => [r.id, r]));
  const items = game.items;
  const chars = game.characters;
  const places = game.map?.places ?? {};
  const music = game.audio?.music ?? {};
  const sfx = game.audio?.sfx ?? {};

  const flagsRead = new Map<string, string>();
  const flagsSet = new Map<string, string>();
  // Events: emitted somewhere, listened to somewhere, waited for by a script; scripts by id.
  const emitted = new Map<string, string>();
  const listened = new Map<string, string>();
  const waited = new Map<string, string>();
  const scriptIds = new Map<string, string>();
  const scriptRefs: [string, string][] = [];
  for (const sc of game.scripts ?? []) scriptIds.set(sc.id, 'scripts');
  for (const r of game.rooms) for (const sc of r.scripts ?? []) {
    if (scriptIds.has(sc.id)) err(`${r.id}.scripts`, `duplicate script id: "${sc.id}" (also in ${scriptIds.get(sc.id)})`);
    scriptIds.set(sc.id, `${r.id}.scripts`);
  }
  /** A moving character: declared with a starting room, and an actor of it in the target room. */
  const mover = (char: Id, roomId: Id, where: string) => {
    const ch = chars[char];
    if (!ch) { err(where, `unknown character: "${char}"`); return; }
    if (!ch.room) err(where, `character "${char}" has no starting room ("room" in its definition), needed to move it between rooms`);
    else if (!rooms.has(ch.room)) err(where, `character "${char}": unknown starting room "${ch.room}"`);
    const r = rooms.get(roomId);
    if (!r) { err(where, `unknown room: "${roomId}"`); return; }
    if (!Object.values(r.actors ?? {}).some((a) => a.char === char)) err(where, `"${char}" is not an actor in ${roomId}: declare it there (actors) and place it in the layout`);
  };
  const read = (c: Cond | undefined, where: string) => { for (const f of condFlags(c)) if (!flagsRead.has(f)) flagsRead.set(f, where); };
  const setF = (f: string, where: string) => { if (!flagsSet.has(f)) flagsSet.set(f, where); };
  for (const f of Object.keys(game.start.flags ?? {})) setF(f, 'start');

  // ------------------------------------------------------------ images
  const images = opts.assets?.images;
  const img = (id: Id | undefined, where: string) => {
    if (!id || !images) return;
    if (!images[id]) err(where, `image not found: "${id}"`);
  };

  // ------------------------------------------------------------ text
  const text = (t: string | undefined, where: string) => {
    if (t === undefined) return;
    if (!t.trim()) err(where, 'empty text');
    else if (t.length > maxText) warn(where, `long text (${t.length} characters, ${maxText} recommended max): "${t.slice(0, 40)}…"`);
  };
  const texts = (t: string | string[] | undefined, where: string) => {
    if (t === undefined) return;
    if (Array.isArray(t)) { if (!t.length) err(where, 'empty text list'); t.forEach((x, i) => text(x, `${where}[${i}]`)); }
    else text(t, where);
  };

  // ------------------------------------------------------------ entities of a room
  const entities = (r: RoomDef) => new Set<string>([
    ...Object.keys(r.hotspots ?? {}), ...Object.keys(r.props ?? {}), ...Object.keys(r.actors ?? {}),
  ]);
  const allEntities = new Set<string>();
  for (const r of game.rooms) entities(r).forEach((e) => allEntities.add(e));

  const hasGeometry = (r: RoomDef, id: Id): boolean => {
    const L = layouts[r.id];
    if (!L) return false;
    const h = L.hotspots?.[id];
    if (h && (h.rect || h.poly || h.approach)) return true;
    if (L.props?.[id]) return true;
    if (L.actors?.[id]) return true;
    return false;
  };

  // ------------------------------------------------------------ conditions
  const cond = (c: Cond | undefined, where: string, room?: RoomDef) => {
    if (c === undefined) return;
    read(c, where);
    const visit = (x: Cond) => {
      if (typeof x === 'string') { if (!x.replace(/^!/, '')) err(where, 'empty condition'); return; }
      if ('has' in x) { if (!items[x.has]) err(where, `unknown item in condition: "${x.has}"`); }
      else if ('not' in x) visit(x.not);
      else if ('all' in x) x.all.forEach(visit);
      else if ('any' in x) x.any.forEach(visit);
      else if ('visited' in x) { if (!rooms.has(x.visited)) err(where, `unknown room in condition: "${x.visited}"`); }
      else if ('room' in x) { if (!rooms.has(x.room)) err(where, `unknown room in condition: "${x.room}"`); }
      else if ('prop' in x) propRef(x.prop[0], x.prop[1], where, room);
      else if ('unlocked' in x) { if (!places[x.unlocked]) err(where, `unknown map place: "${x.unlocked}"`); }
      else if ('actorIn' in x) mover(x.actorIn[0], x.actorIn[1], where);
    };
    visit(c);
  };

  const propRef = (id: Id, state: string | undefined, where: string, room?: RoomDef) => {
    let r = room;
    let pid = id;
    if (id.includes('.')) { const [rid, p] = id.split('.'); r = rooms.get(rid); pid = p; if (!r) { err(where, `unknown room: "${rid}" in "${id}"`); return; } }
    if (!r) { err(where, `prop "${id}" has no room (use "room.prop")`); return; }
    const def = r.props?.[pid];
    if (!def) { err(where, `unknown prop in ${r.id}: "${pid}"`); return; }
    if (state !== undefined) {
      const states = def.states ? Object.keys(def.states) : [];
      if (!states.includes(state)) err(where, `unknown state "${state}" for prop "${pid}" (states: ${states.join(', ') || 'none'})`);
    }
  };

  const whoOk = (w: Id, room?: RoomDef) => w === HERO || !!chars[w] || !!room?.actors?.[w];

  // ------------------------------------------------------------ commands
  let inScript = false;
  const cmds = (list: Cmd[] | undefined, where: string, room?: RoomDef) => {
    list?.forEach((c, i) => cmd(c, `${where}[${i}]`, room));
  };
  const cmd = (c: Cmd, where: string, room?: RoomDef) => {
    if (typeof c === 'string') { text(c, where); return; }
    if ('say' in c) { if (!whoOk(c.say[0], room)) err(where, `unknown character: "${c.say[0]}"`); text(c.say[1], where); return; }
    if ('walk' in c) {
      if (c.who && !whoOk(c.who, room)) err(where, `unknown character: "${c.who}"`);
      if (typeof c.walk === 'string' && room) {
        if (!entities(room).has(c.walk)) err(where, `unknown walk target: "${c.walk}"`);
        else if (!hasGeometry(room, c.walk)) (layouts[room.id] ? err : warn)(where, `"${c.walk}" has no geometry in the layout (approach point)`);
      }
      return;
    }
    if ('place' in c) { if (!whoOk(c.place[0], room)) err(where, `unknown character: "${c.place[0]}"`); return; }
    if ('face' in c) {
      if (c.who && !whoOk(c.who, room)) err(where, `unknown character: "${c.who}"`);
      if (c.face !== 'left' && c.face !== 'right' && room && !entities(room).has(c.face) && !whoOk(c.face, room)) err(where, `unknown target: "${c.face}"`);
      return;
    }
    if ('pose' in c) { if (!whoOk(c.pose[0], room)) err(where, `unknown character: "${c.pose[0]}"`); poseRef(c.pose[0], c.pose[1], where, room); return; }
    if ('anim' in c) { if (!whoOk(c.anim[0], room)) err(where, `unknown character: "${c.anim[0]}"`); poseRef(c.anim[0], c.anim[1], where, room); return; }
    if ('wait' in c) return;
    if ('parallel' in c) { nested(() => c.parallel.forEach((b, j) => cmds(b, `${where}.parallel[${j}]`, room))); return; }
    if ('prop' in c) { propRef(c.prop[0], c.prop[1], where, room); return; }
    if ('show' in c || 'hide' in c) {
      const id = 'show' in c ? c.show : (c as { hide: Id }).hide;
      if (room && !entities(room).has(id)) err(where, `unknown actor or prop: "${id}"`);
      return;
    }
    if ('gain' in c) { if (!items[c.gain]) err(where, `unknown item: "${c.gain}"`); return; }
    if ('lose' in c) { if (!items[c.lose]) err(where, `unknown item: "${c.lose}"`); return; }
    if ('used' in c) { for (const u of Array.isArray(c.used) ? c.used : [c.used]) if (!items[u]) err(where, `unknown item: "${u}"`); return; }
    if ('set' in c) { setF(Array.isArray(c.set) ? c.set[0] : c.set, where); return; }
    if ('unset' in c) { setF(c.unset, where); return; }
    if ('inc' in c) { setF(c.inc, where); return; }
    if ('unlock' in c) { if (!places[c.unlock]) err(where, `unknown map place: "${c.unlock}"`); return; }
    if ('goto' in c) {
      const target = rooms.get(c.goto);
      if (!target) err(where, `unknown room: "${c.goto}"`);
      else if (typeof c.at === 'string' && layouts[c.goto] && !layouts[c.goto].entries?.[c.at]) err(where, `unknown entry point "${c.at}" in ${c.goto}`);
      return;
    }
    if ('map' in c) return;
    if ('moveActor' in c) {
      const [char, to] = c.moveActor;
      if (char === HERO || char === game.hero) err(where, 'moveActor is for other characters: the hero changes rooms with goto');
      else mover(char, to, where);
      if (typeof c.at === 'string' && layouts[to] && !layouts[to].entries?.[c.at]) err(where, `unknown entry point "${c.at}" in ${to}`);
      return;
    }
    if ('emit' in c) { if (!c.emit) err(where, 'empty event id'); else if (!emitted.has(c.emit)) emitted.set(c.emit, where); return; }
    if ('waitUntil' in c) { cond(c.waitUntil, where, room); if (!inScript) warn(where, 'waitUntil outside a script: it polls the condition and blocks the player'); return; }
    if ('waitEvent' in c) { if (!waited.has(c.waitEvent)) waited.set(c.waitEvent, where); if (!inScript) warn(where, 'waitEvent outside the top level of a script does nothing'); return; }
    if ('startScript' in c) { scriptRefs.push([c.startScript, where]); return; }
    if ('stopScript' in c) { scriptRefs.push([c.stopScript, where]); return; }
    if ('sfx' in c) { if (!sfx[c.sfx]) err(where, `unknown sound effect: "${c.sfx}"`); return; }
    if ('music' in c) {
      const m = c.music;
      const id = typeof m === 'string' ? m : 'push' in m ? m.push : 'once' in m ? m.once : undefined;
      if (id && !music[id]) err(where, `unknown music: "${id}"`);
      return;
    }
    if ('toast' in c) { text(c.toast, where); return; }
    if ('shake' in c) return;
    if ('if' in c) { cond(c.if, where, room); nested(() => { cmds(c.then, `${where}.then`, room); cmds(c.else, `${where}.else`, room); }); return; }
    if ('once' in c) { nested(() => cmds(c.once, `${where}.once`, room)); return; }
    if ('nth' in c) { nested(() => c.nth.forEach((b, j) => cmds(b, `${where}.nth[${j}]`, room))); return; }
    if ('cycle' in c) { nested(() => c.cycle.forEach((b, j) => cmds(b, `${where}.cycle[${j}]`, room))); return; }
    if ('random' in c) { nested(() => c.random.forEach((b, j) => cmds(b, `${where}.random[${j}]`, room))); return; }
    if ('cutscene' in c) { nested(() => cmds(c.cutscene, `${where}.cutscene`, room)); return; }
    if ('choice' in c) {
      if (!c.choice.length) err(where, 'choice with no option');
      nested(() => c.choice.forEach((o, j) => { text(o.text, `${where}.choice[${j}]`); cond(o.if, `${where}.choice[${j}]`, room); cmds(o.do, `${where}.choice[${j}]`, room); }));
      return;
    }
    if ('minigame' in c) {
      if (opts.minigameIds && !opts.minigameIds.includes(c.minigame)) err(where, `unknown minigame: "${c.minigame}" (known: ${opts.minigameIds.join(', ')})`);
      minigameParams(c.minigame, c.params, where);
      nested(() => cmds(c.then, `${where}.then`, room));
      return;
    }
    if ('phone' in c) {
      const list = Array.isArray(c.phone) ? c.phone : [c.phone];
      if (!list.length) err(where, 'call with no one on the line');
      for (const w of list) if (!whoOk(w, room)) err(where, `unknown character: "${w}"`);
      nested(() => cmds(c.do, `${where}.phone`, room));
      return;
    }
    if ('guide' in c) {
      const g = c.guide;
      if (!game.verbs.some((v) => v.id === g.verb)) err(where, `unknown verb: "${g.verb}"`);
      if (!(room && entities(room).has(g.target)) && !items[g.target]) err(where, `unknown tutorial target: "${g.target}"`);
      text(g.say, where);
      return;
    }
    if ('talk' in c) { if (room && !room.talk?.[c.talk]) err(where, `no conversation topics for "${c.talk}"`); return; }
    if ('ending' in c || 'reveal' in c) {
      if (!game.ending) err(where, 'sealed ending without "ending" in the game');
      nested(() => cmds(c.after, `${where}.after`, room));
      return;
    }
    if ('hint' in c || 'end' in c) return;
    err(where, `unknown command: ${JSON.stringify(c)}`);
  };
  /** Commands nested in a block are not at a script's top level (where waitUntil / waitEvent pause the script). */
  const nested = (fn: () => void) => { const was = inScript; inScript = false; fn(); inScript = was; };

  /** The world's scripts: unique ids (checked above), a loop that waits, commands checked at the top level. */
  const scripts = (list: ScriptDef[] | undefined, where: string, room?: RoomDef) => {
    list?.forEach((sc, i) => {
      const w = `${where}[${i}]`;
      if (!sc.id) err(w, 'script without id');
      cond(sc.while, `${w}.while`, room);
      if (!sc.do?.length) { err(w, 'script with no command'); return; }
      const pauses = sc.do.some((c) => typeof c === 'object' && ('wait' in c || 'waitUntil' in c || 'waitEvent' in c));
      if (sc.loop && !pauses) err(w, `loop script "${sc.id}" never waits (add a wait, waitUntil or waitEvent)`);
      inScript = true;
      cmds(sc.do, `${w}.do`, room);
      inScript = false;
    });
  };
  const events = (list: EventRule[] | undefined, where: string, room?: RoomDef) => {
    list?.forEach((ev, i) => {
      const w = `${where}[${i}]`;
      if (!ev.on) err(w, 'listener without event id ("on")');
      else if (!listened.has(ev.on)) listened.set(ev.on, w);
      cond(ev.if, w, room);
      if (!ev.do?.length) warn(w, 'listener with no command');
      cmds(ev.do, `${w}.do`, room);
    });
  };

  /** Required params of the minigame, and images referenced in the params. */
  const minigameParams = (id: Id, params: Record<string, unknown> | undefined, where: string) => {
    const need = opts.minigameParams?.[id];
    for (const k of need ?? []) if (params?.[k] === undefined) err(where, `minigame "${id}": missing required param "${k}"`);
    const scan = (v: unknown, w: string) => {
      if (typeof v === 'string') { if (/^[a-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(v)) img(v, w); }
      else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${w}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, `${w}.${k}`);
    };
    scan(params, `${where}.params`);
  };

  const poseRef = (who: Id, pose: string, where: string, room?: RoomDef) => {
    const charId = who === HERO ? game.hero : (room?.actors?.[who]?.char ?? who);
    const ch = chars[charId];
    if (ch?.sprites && !ch.sprites[pose]) warn(where, `pose "${pose}" missing for "${charId}" (falls back to idle)`);
  };

  const ids = (x: Id | Id[] | undefined) => x === undefined ? [] : Array.isArray(x) ? x : [x];
  const verbIds = new Set(game.verbs.map((v) => v.id));
  const rule = (r: Rule, where: string, room?: RoomDef) => {
    for (const v of ids(r.verb as Id | Id[])) if (!verbIds.has(v as VerbId)) err(where, `unknown verb: "${v}"`);
    const known = (id: Id) => !!items[id] || (room ? entities(room).has(id) : allEntities.has(id));
    for (const a of ids(r.a)) if (!known(a)) err(where, `"${a}" is neither an item nor something in the room`);
    for (const b of ids(r.b)) if (!known(b)) err(where, `"${b}" is neither an item nor something in the room`);
    cond(r.if, where, room);
    if (!r.do?.length) warn(where, 'rule with no command');
    cmds(r.do, where, room);
  };

  // ------------------------------------------------------------ skin and ending
  const sk = game.skin;
  if (!sk?.icons) err('skin', 'requires "skin.icons" (map, pause, music)');
  else {
    for (const k of ['map', 'pause', 'music'] as const) if (!sk.icons[k]) err('skin.icons', `missing required icon: "${k}"`);
    for (const [k, v] of Object.entries(sk.icons)) for (const id of Array.isArray(v) ? v : [v]) img(id, `skin.icons.${k}`);
  }
  for (const [k, id] of Object.entries(sk?.sounds ?? {})) {
    if (!id) continue;
    const inMusic = k === 'jingle' || k === 'end';
    if (inMusic ? !music[id] : !sfx[id]) err(`skin.sounds.${k}`, `unknown ${inMusic ? 'music' : 'sound effect'}: "${id}"`);
  }
  if (game.ending) {
    const E = game.ending;
    if (!E.file) err('ending', 'requires "file" (file produced by npm run seal)');
    minigameParams('scratch', E.scratch, 'ending.scratch');
    if (E.guess) { if (!flagsRead.has(E.guess.flag)) flagsRead.set(E.guess.flag, 'ending.guess'); text(E.guess.right, 'ending.guess.right'); text(E.guess.wrong, 'ending.guess.wrong'); text(E.guess.none, 'ending.guess.none'); }
  }

  // ------------------------------------------------------------ game
  if (!chars[game.hero]) err('game', `unknown hero: "${game.hero}"`);
  if (game.hintItem && !items[game.hintItem]) err('game', `unknown hint item: "${game.hintItem}"`);
  if (game.hintVoice && !chars[game.hintVoice]) err('game', `unknown hint voice: "${game.hintVoice}"`);
  if (!rooms.has(game.start.room)) err('start', `unknown start room: "${game.start.room}"`);
  for (const i of game.start.inventory ?? []) if (!items[i]) err('start', `unknown item: "${i}"`);
  for (const p of game.start.unlocked ?? []) if (!places[p]) err('start', `unknown map place: "${p}"`);
  cmds(game.start.intro, 'start.intro', rooms.get(game.start.room));

  for (const [cid, c] of Object.entries(chars)) {
    const w = `character ${cid}`;
    text(c.name, w); text(c.refuse, `${w}.refuse`); text(c.hug, `${w}.hug`);
    img(c.portrait, w);
    for (const [pose, frames] of Object.entries(c.sprites ?? {})) {
      if (!frames.length) err(w, `pose "${pose}" has no image`);
      frames.forEach((f) => img(f, `${w}.${pose}`));
    }
    if (!c.offscreen && c.sprites && !c.sprites.idle) warn(w, 'no "idle" pose');
    if (c.room) {
      if (!rooms.has(c.room)) err(w, `unknown starting room: "${c.room}"`);
      else if (!Object.values(rooms.get(c.room)!.actors ?? {}).some((a) => a.char === cid)) err(w, `starting room "${c.room}" has no actor of "${cid}"`);
    }
    // Palette swap: source and target colours must be #rrggbb (others are ignored by the renderer).
    const palette = (pal: unknown, tol: unknown, pw: string) => {
      if (pal === undefined) return;
      if (!pal || typeof pal !== 'object' || Array.isArray(pal)) { warn(pw, 'palette must be an object { "#rrggbb": "#rrggbb" }'); return; }
      for (const [k, v] of Object.entries(pal)) {
        if (!/^#[0-9a-fA-F]{6}$/.test(k)) warn(pw, `palette key "${k}" is not a #rrggbb colour (ignored)`);
        if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) warn(pw, `palette value for "${k}" is not a #rrggbb colour (ignored): ${JSON.stringify(v)}`);
      }
      if (tol !== undefined && (typeof tol !== 'number' || tol < 0)) warn(pw, 'paletteTolerance must be a number >= 0');
    };
    palette(c.palette, c.paletteTolerance, `${w}.palette`);
    (c.variants ?? []).forEach((v, i) => palette(v.palette, v.paletteTolerance, `${w}.variants[${i}].palette`));
  }
  for (const [iid, it] of Object.entries(items)) {
    const w = `item ${iid}`;
    text(it.name, w);
    img(it.icon, w);
    if (it.look === undefined) warn(w, 'no text for Look');
    else texts(it.look, `${w}.look`);
  }

  // Fallback responses
  for (const v of [...game.verbs.map((x) => x.id), 'use2'] as const) {
    const list = game.rules.fallbacks[v as VerbId];
    if (!list?.length) warn('rules.fallbacks', `no fallback response for "${v}"`);
    else list.forEach((t, i) => text(t, `rules.fallbacks.${v}[${i}]`));
  }
  (game.rules.kinds ?? []).forEach((k, i) => {
    const w = `rules.kinds[${i}]`;
    text(k.say, w);
    if (!k.kind && !k.target) err(w, 'requires "kind" or "target"');
    for (const it of ids(k.item)) if (!items[it]) warn(w, `unknown item (reserved for later?): "${it}"`);
  });
  (game.rules.on ?? []).forEach((r, i) => rule(r, `rules.on[${i}]`));
  scripts(game.scripts, 'scripts');
  events(game.events, 'events');

  // Map
  if (game.map) {
    const m = game.map;
    if (!m.regions[m.start]) err('map', `unknown start region: "${m.start}"`);
    for (const [rid, reg] of Object.entries(m.regions)) {
      img(reg.image, `map.${rid}`);
      if (reg.parent && !m.regions[reg.parent]) err(`map.${rid}`, `unknown parent region: "${reg.parent}"`);
    }
    for (const [pid, p] of Object.entries(m.places)) {
      const w = `map.${pid}`;
      if (!rooms.has(p.room)) err(w, `unknown room: "${p.room}"`);
      if (!m.regions[p.region]) err(w, `unknown region: "${p.region}"`);
      img(p.portrait, w);
      cond(p.news, w);
    }
    for (const v of Object.values(m.vehicles ?? {})) img(v, 'map.vehicles');
    if (m.music && !music[m.music]) err('map', `unknown music: "${m.music}"`);
  }

  // Rooms
  for (const r of game.rooms) {
    const w = r.id;
    const L = layouts[r.id];
    const ents = entities(r);
    text(r.name, w);
    for (const [xid, ex] of Object.entries(r.exits ?? {})) {
      const xw = `${w}.exits.${xid}`;
      text(ex.name, xw); text(ex.locked, `${xw}.locked`);
      if (!rooms.has(ex.to)) err(xw, `unknown room: "${ex.to}"`);
      else if (typeof ex.entry === 'string' && layouts[ex.to] && !layouts[ex.to].entries?.[ex.entry]) err(xw, `unknown entry point "${ex.entry}" in ${ex.to}`);
      if (ex.to === r.id) warn(xw, 'exit leading to its own room');
      for (const v of ex.verbs ?? []) if (!verbIds.has(v)) err(xw, `unknown verb: "${v}"`);
      if (ex.sfx && !sfx[ex.sfx]) err(xw, `unknown sound effect: "${ex.sfx}"`);
      const written = gameIn.rooms.find((x) => x.id === r.id)?.hotspots?.[xid];
      if (written && !written.exit) err(xw, `"${xid}" is both an exit and a hotspot`);
    }
    if (images) img(r.decor, `${w}.decor`);
    if (r.music && !music[r.music]) err(w, `unknown music: "${r.music}"`);
    if (!L) warn(w, 'no layout: nothing will be clickable (place the room in the editor)');

    for (const [pid, p] of Object.entries(r.props ?? {})) {
      const pw = `${w}.props.${pid}`;
      if (!p.img && !p.states) err(pw, 'neither "img" nor "states"');
      img(p.img, pw);
      for (const [st, im] of Object.entries(p.states ?? {})) img(im, `${pw}.${st}`);
      if (p.initial && p.states && !p.states[p.initial]) err(pw, `unknown initial state: "${p.initial}"`);
      cond(p.visible, pw, r);
      if (p.name !== undefined) text(p.name, pw);
      if (L && !L.props?.[pid]) err(pw, 'no position in the layout');
    }
    for (const [aid, a] of Object.entries(r.actors ?? {})) {
      const aw = `${w}.actors.${aid}`;
      const ch = chars[a.char];
      if (!ch) err(aw, `unknown character: "${a.char}"`);
      else if (a.pose && ch.sprites && !ch.sprites[a.pose]) warn(aw, `pose "${a.pose}" missing (falls back to idle)`);
      cond(a.visible, aw, r);
      if (L && !L.actors?.[aid]) err(aw, 'no position in the layout');
      if (a.interactive !== false && ch?.kind?.includes('person') && !r.talk?.[aid] && !(r.on ?? []).some((x) => ids(x.verb as Id | Id[]).includes('talk') && ids(x.a).includes(aid))) warn(aw, 'person with no conversation topics');
    }
    for (const [hid, h] of Object.entries(r.hotspots ?? {})) {
      const hw = `${w}.hotspots.${hid}`;
      text(h.name, hw);
      cond(h.visible, hw, r);
      if (L && !hasGeometry(r, hid)) err(hw, 'no zone in the layout (rect or poly)');
    }
    // Look: anything named should have a response
    const named = [...Object.keys(r.hotspots ?? {}), ...Object.entries(r.props ?? {}).filter(([, p]) => p.name).map(([k]) => k), ...Object.entries(r.actors ?? {}).filter(([, a]) => a.interactive !== false).map(([k]) => k)];
    for (const id of named) if (!r.look?.[id] && !(r.on ?? []).some((x) => ids(x.verb as Id | Id[]).includes('look') && ids(x.a).includes(id))) warn(`${w}.look`, `"${id}" has no text for Look (fallback response)`);
    for (const [k, t] of Object.entries(r.look ?? {})) {
      if (!ents.has(k) && !items[k]) err(`${w}.look.${k}`, `"${k}" does not exist in the room`);
      texts(t, `${w}.look.${k}`);
    }
    (r.on ?? []).forEach((x, i) => rule(x, `${w} › on[${i}]`.replace(`${w} › `, `${w}.`), r));
    for (const [aid, topics] of Object.entries(r.talk ?? {})) {
      const tw = `${w}.talk.${aid}`;
      if (!r.actors?.[aid]) err(tw, `"${aid}" is not an actor in the room`);
      if (!topics.length) warn(tw, 'no topics');
      topics.forEach((t, i) => { text(t.topic, `${tw}[${i}]`); cond(t.if, `${tw}[${i}]`, r); cmds(t.do, `${tw}[${i}]`, r); });
    }
    (r.hints ?? []).forEach((h, i) => { cond(h.until, `${w}.hints[${i}]`, r); texts(h.lines, `${w}.hints[${i}]`); });
    if ((r.on ?? []).length && !(r.hints ?? []).length) warn(w, 'has puzzles but no hints');
    cmds(r.onEnter, `${w}.onEnter`, r);
    scripts(r.scripts, `${w}.scripts`, r);
    events(r.events, `${w}.events`, r);

    if (L) {
      for (const k of Object.keys(L.hotspots ?? {})) if (!r.hotspots?.[k]) warn(`${w}.layout`, `zone "${k}" has no hotspot in the room`);
      for (const k of Object.keys(L.props ?? {})) if (!r.props?.[k]) warn(`${w}.layout`, `position "${k}" has no prop in the room`);
      for (const k of Object.keys(L.actors ?? {})) if (!r.actors?.[k]) warn(`${w}.layout`, `position "${k}" has no actor in the room`);
      if (!L.entries?.default) warn(`${w}.layout`, 'no "default" entry point');
    }
  }

  // World map: every room should be reachable, every exit should have a way back (or say it has not).
  const g = worldGraph(game);
  for (const id of g.unreachable) warn(id, 'no exit, goto or map place leads to this room from the start');
  for (const e of g.oneWay) warn(`${e.from}.exits.${e.via}`, `no way back from ${e.to} to ${e.from} (add oneWay: true if intended)`);

  // Chapters, invariants, saves, migrations
  (game.invariants ?? []).forEach((c, i) => cond(c, `invariants[${i}]`));
  if (game.saves && (!Number.isInteger(game.saves.slots) || game.saves.slots < 0)) err('saves', 'slots must be a whole number');
  if (game.saves?.slots) for (const k of ['save', 'load', 'slot', 'emptySlot', 'exportSave', 'importSave', 'confirmOverwrite'] as const) if (!game.ui[k]) warn(`ui.${k}`, 'missing text for the save menu (English default used)');
  const migFrom = new Set<number>();
  for (const [i, m] of (game.migrations ?? []).entries()) {
    const w = `migrations[${i}]`;
    if (!Number.isInteger(m.from)) err(w, '"from" must be a version number');
    if (migFrom.has(m.from)) err(w, `two migrations from version ${m.from}`);
    migFrom.add(m.from);
    if (m.from >= game.saveVersion) err(w, `from ${m.from} is not below saveVersion ${game.saveVersion}`);
    for (const v of Object.values(m.renameFlag ?? {})) if (!v) err(w, 'empty flag name');
    for (const v of Object.values(m.renameItem ?? {})) if (!items[v]) err(w, `renamed item does not exist: "${v}"`);
    for (const v of Object.values(m.renameRoom ?? {})) if (!rooms.has(v)) err(w, `renamed room does not exist: "${v}"`);
    for (const v of Object.values(m.renamePlace ?? {})) if (!places[v]) err(w, `renamed map place does not exist: "${v}"`);
    for (const v of Object.values(m.renameProp ?? {})) { const [rid, pid] = v.split('.'); if (!rooms.get(rid)?.props?.[pid]) err(w, `renamed prop does not exist: "${v}"`); }
    for (const v of Object.values(m.renameActor ?? {})) { const [rid, aid] = v.split('.'); if (!rooms.get(rid)?.actors?.[aid]) err(w, `renamed actor does not exist: "${v}"`); }
  }
  if (game.migrations?.length) for (let v = Math.min(...migFrom); v < game.saveVersion; v++) if (!migFrom.has(v)) warn('migrations', `no migration from version ${v}: those saves start a new game`);

  // Checkpoints
  for (const [cid, c] of Object.entries(game.checkpoints ?? {})) {
    const w = `checkpoints.${cid}`;
    (c.goals ?? []).forEach((g, i) => cond(g, `${w}.goals[${i}]`, rooms.get(c.room)));
    if (!rooms.has(c.room)) err(w, `unknown room: "${c.room}"`);
    for (const i of c.inventory ?? []) if (!items[i]) err(w, `unknown item: "${i}"`);
    for (const p of c.unlocked ?? []) if (!places[p]) err(w, `unknown map place: "${p}"`);
    for (const [k, st] of Object.entries(c.props ?? {})) propRef(k, st, w);
    for (const [ch, rid] of Object.entries(c.where ?? {})) mover(ch, rid, `${w}.where`);
  }

  // Events and scripts
  for (const [id, where] of scriptRefs) if (!scriptIds.has(id)) err(where, `unknown script: "${id}"`);
  for (const [ev, where] of emitted) if (!listened.has(ev) && !waited.has(ev)) warn(where, `event "${ev}" is emitted but nothing listens to it`);
  for (const [ev, where] of listened) if (!emitted.has(ev)) warn(where, `event "${ev}" is listened to but never emitted`);
  for (const [ev, where] of waited) if (!emitted.has(ev)) warn(where, `script waits for event "${ev}", which is never emitted`);

  // Flags
  for (const [f, where] of flagsRead) if (!flagsSet.has(f)) warn(where, `flag "${f}" is read but never set`);
  for (const [f, where] of flagsSet) if (!flagsRead.has(f)) warn(where, `(info) flag "${f}" is set but never read`);

  return { errors, warnings };
}
