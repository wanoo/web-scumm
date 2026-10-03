// Localisation by extraction: the content stays written in one language (`GameDef.lang`); `textPaths` lists every text
// of the game with a stable path, a translation table maps those paths to the translated texts, `applyLocale` returns
// the game with the texts replaced. Nothing changes for whoever writes the content: no keys, no indirection.
// Paths: `room:house/look.pantry[1]`, `item:key/name`, `char:grandma/refuse`, `ui/newGame`, `rules/fallbacks.look[2]`,
// `start/intro[0]`, `credits[3]`, `map/places.house.name`…
import type { Cmd, GameDef, RoomDef } from '../core/types';

type Fn = (path: string, text: string) => string | undefined;

/** Walks a command list; `fn` may replace a text (the list is changed in place). */
function cmds(list: Cmd[] | undefined, path: string, fn: Fn) {
  list?.forEach((c, i) => {
    const p = `${path}[${i}]`;
    if (typeof c === 'string') { const r = fn(p, c); if (r !== undefined) list[i] = r; return; }
    if ('say' in c) { const r = fn(`${p}.say`, c.say[1]); if (r !== undefined) c.say[1] = r; }
    else if ('toast' in c) { const r = fn(`${p}.toast`, c.toast); if (r !== undefined) c.toast = r; }
    else if ('guide' in c) { const r = fn(`${p}.guide`, c.guide.say); if (r !== undefined) c.guide.say = r; }
    else if ('if' in c) { cmds(c.then, `${p}.then`, fn); cmds(c.else, `${p}.else`, fn); }
    else if ('once' in c) cmds(c.once, `${p}.once`, fn);
    else if ('nth' in c) c.nth.forEach((b, j) => cmds(b, `${p}.nth[${j}]`, fn));
    else if ('cycle' in c) c.cycle.forEach((b, j) => cmds(b, `${p}.cycle[${j}]`, fn));
    else if ('random' in c) c.random.forEach((b, j) => cmds(b, `${p}.random[${j}]`, fn));
    else if ('parallel' in c) c.parallel.forEach((b, j) => cmds(b, `${p}.parallel[${j}]`, fn));
    else if ('cutscene' in c) cmds(c.cutscene, `${p}.cutscene`, fn);
    else if ('choice' in c) c.choice.forEach((o, j) => { const r = fn(`${p}.choice[${j}].text`, o.text); if (r !== undefined) o.text = r; cmds(o.do, `${p}.choice[${j}].do`, fn); });
    else if ('minigame' in c) cmds(c.then, `${p}.then`, fn);
    else if ('phone' in c) cmds(c.do, `${p}.do`, fn);
    else if ('anim' in c) { for (const [k, b] of Object.entries(c.at ?? {})) cmds(b, `${p}.at[${k}]`, fn); }
    else if ('ending' in c || 'reveal' in c) cmds(c.after, `${p}.after`, fn);
  });
}

function strOrList(o: Record<string, string | string[]> | undefined, path: string, fn: Fn) {
  for (const [k, v] of Object.entries(o ?? {})) {
    if (typeof v === 'string') { const r = fn(`${path}.${k}`, v); if (r !== undefined) o![k] = r; }
    else v.forEach((t, i) => { const r = fn(`${path}.${k}[${i}]`, t); if (r !== undefined) v[i] = r; });
  }
}

function room(r: RoomDef, fn: Fn) {
  const P = `room:${r.id}/`;
  const one = (path: string, v: string | undefined, set: (x: string) => void) => { if (v === undefined) return; const x = fn(P + path, v); if (x !== undefined) set(x); };
  one('name', r.name, (x) => { r.name = x; });
  for (const [id, h] of Object.entries(r.hotspots ?? {})) if (!h.exit) one(`hotspots.${id}.name`, h.name, (x) => { h.name = x; });
  for (const [id, p] of Object.entries(r.props ?? {})) one(`props.${id}.name`, p.name, (x) => { p.name = x; });
  for (const [id, a] of Object.entries(r.actors ?? {})) one(`actors.${id}.name`, a.name, (x) => { a.name = x; });
  for (const [id, e] of Object.entries(r.exits ?? {})) { one(`exits.${id}.name`, e.name, (x) => { e.name = x; }); one(`exits.${id}.locked`, e.locked, (x) => { e.locked = x; }); }
  strOrList(r.look, `${P}look`, fn);
  (r.on ?? []).forEach((x, i) => { if (!x.exit) cmds(x.do, `${P}on[${i}].do`, fn); });
  for (const [actor, ts] of Object.entries(r.talk ?? {})) ts.forEach((t, i) => { one(`talk.${actor}[${i}].topic`, t.topic, (x) => { t.topic = x; }); cmds(t.do, `${P}talk.${actor}[${i}].do`, fn); });
  (r.hints ?? []).forEach((h, i) => h.lines.forEach((l, j) => one(`hints[${i}].lines[${j}]`, l, (x) => { h.lines[j] = x; })));
  cmds(r.onEnter, `${P}onEnter`, fn);
  (r.scripts ?? []).forEach((sc) => cmds(sc.do, `${P}scripts.${sc.id}.do`, fn));
  (r.events ?? []).forEach((ev, i) => cmds(ev.do, `${P}events[${i}].do`, fn));
  for (const [pid, p] of Object.entries(r.props ?? {})) for (const [an, a] of Object.entries(p.anims ?? {})) for (const [k, b] of Object.entries(a.at ?? {})) cmds(b, `${P}props.${pid}.anims.${an}.at[${k}]`, fn);
}

/** Visits every text of the game; `fn` may return a replacement. The game is changed in place. */
export function walkTexts(game: GameDef, fn: Fn): void {
  const one = (path: string, v: string | undefined, set: (x: string) => void) => { if (v === undefined) return; const x = fn(path, v); if (x !== undefined) set(x); };
  one('title', game.title, (x) => { game.title = x; });
  game.rooms.forEach((r) => room(r, fn));
  for (const [id, it] of Object.entries(game.items)) {
    one(`item:${id}/name`, it.name, (x) => { it.name = x; });
    if (typeof it.look === 'string') one(`item:${id}/look`, it.look, (x) => { it.look = x; });
    else it.look?.forEach((t, i) => one(`item:${id}/look[${i}]`, t, (x) => { (it.look as string[])[i] = x; }));
  }
  for (const [id, c] of Object.entries(game.characters)) { one(`char:${id}/name`, c.name, (x) => { c.name = x; }); one(`char:${id}/refuse`, c.refuse, (x) => { c.refuse = x; }); one(`char:${id}/hug`, c.hug, (x) => { c.hug = x; }); }
  for (const [v, list] of Object.entries(game.rules.fallbacks)) list?.forEach((t, i) => one(`rules/fallbacks.${v}[${i}]`, t, (x) => { list[i] = x; }));
  (game.rules.kinds ?? []).forEach((k, i) => one(`rules/kinds[${i}].say`, k.say, (x) => { k.say = x; }));
  (game.rules.on ?? []).forEach((r, i) => cmds(r.do, `rules/on[${i}].do`, fn));
  (game.scripts ?? []).forEach((sc) => cmds(sc.do, `scripts.${sc.id}.do`, fn));
  (game.events ?? []).forEach((ev, i) => cmds(ev.do, `events[${i}].do`, fn));
  if (game.globalTalk) for (const k of ['hug', 'bye', 'byeLine'] as const) one(`globalTalk/${k}`, game.globalTalk[k], (x) => { game.globalTalk![k] = x; });
  if (game.players?.give) one('players/give', game.players.give, (x) => { game.players!.give = x; });
  cmds(game.start.intro, 'start/intro', fn);
  for (const [k, v] of Object.entries(game.ui)) if (typeof v === 'string') one(`ui/${k}`, v, (x) => { (game.ui as unknown as Record<string, string>)[k] = x; });
  (game.credits ?? []).forEach((t, i) => one(`credits[${i}]`, t, (x) => { game.credits![i] = x; }));
  one('titleScreen/footer', game.titleScreen?.footer, (x) => { game.titleScreen!.footer = x; });
  for (const [id, r] of Object.entries(game.map?.regions ?? {})) one(`map/regions.${id}.name`, r.name, (x) => { r.name = x; });
  for (const [id, p] of Object.entries(game.map?.places ?? {})) one(`map/places.${id}.name`, p.name, (x) => { p.name = x; });
  if (game.ending?.guess) {
    const g = game.ending.guess;
    for (const k of ['right', 'wrong', 'none'] as const) one(`ending/guess.${k}`, g[k], (x) => { g[k] = x; });
    for (const [k, v] of Object.entries(g.labels)) one(`ending/guess.labels.${k}`, v, (x) => { g.labels[k] = x; });
  }
}

/** Every text of the game with its path, in content order. */
export function textPaths(game: GameDef): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  walkTexts(structuredClone(game), (path, text) => { out.push({ path, text }); return undefined; });
  return out;
}

/** The game with its texts translated from `table` (path → text); texts the table lacks stay as written. */
export function applyLocale<T extends GameDef>(game: T, table: Record<string, string> | undefined): T {
  if (!table) return game;
  const g = structuredClone(game);
  walkTexts(g, (path, text) => { const t = table[path]; return typeof t === 'string' && (t !== '' || text === '') ? t : undefined; });
  return g;
}

/** Coverage of a translation table against the game: what is missing, what no longer exists, what is long. */
export function localeStatus(game: GameDef, table: Record<string, string>, maxText = 140) {
  const paths = textPaths(game);
  const keys = new Set(paths.map((p) => p.path));
  const missing = paths.filter((p) => !(p.path in table)).map((p) => p.path);
  const stale = Object.keys(table).filter((k) => !k.startsWith('_') && !keys.has(k));
  const long = paths.filter((p) => (table[p.path] ?? '').length > maxText).map((p) => p.path);
  return { total: paths.length, translated: paths.length - missing.length, missing, stale, long };
}
