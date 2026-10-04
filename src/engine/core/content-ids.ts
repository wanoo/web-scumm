// Stable content ids (schema v3) and the single place that names things for the engine, the solver, the puzzle
// graph, the translation tables and the migration of v2 saves. v2 content keeps its positional names.
import type { Choice, Cmd, EventRule, GameDef, Id, Rule, ScriptDef, TalkTopic } from './types';
import { assignKeys } from './define';

// ------------------------------------------------------------------ action ids (engine `ran`, puzzle graph, solver)

/** Puzzle/session id of a written rule. Stable v3 ids win; v2 keeps its positional compatibility id. */
export function ruleActionId(scope: string, index: number, rule: Rule): string {
  return `rule:${rule.id ?? `${scope}/on[${index}]`}`;
}

/** Puzzle/session id of a talk topic. */
export function topicActionId(room: Id, actor: Id, index: number, topic: TalkTopic): string {
  return `topic:${topic.id ?? `${room}/${actor}[${index}]`}`;
}

/** Puzzle/session id of a listener (`events`). */
export function listenerActionId(scope: string, index: number, ev: EventRule): string {
  return `listener:${ev.id ?? `${scope}/events[${index}]`}`;
}

// ------------------------------------------------------------------ translation paths (i18n tables, coverage, dialogue tree)

/** Path segment of a rule in the translation tables: `on.<id>` in v3, `on[<i>]` in v2. */
export const rulePathSeg = (index: number, rule: Rule) => (rule.id ? `on.${rule.id}` : `on[${index}]`);
/** `talk.<actor>.<id>` in v3, `talk.<actor>[<i>]` in v2. */
export const topicPathSeg = (actor: Id, index: number, topic: TalkTopic) => (topic.id ? `talk.${actor}.${topic.id}` : `talk.${actor}[${index}]`);
/** `.choice.<id>` in v3, `.choice[<j>]` in v2. */
export const choicePathSeg = (index: number, option: Choice) => (option.id ? `.choice.${option.id}` : `.choice[${index}]`);
/** `events.<id>` in v3, `events[<i>]` in v2. */
export const eventPathSeg = (index: number, ev: EventRule) => (ev.id ? `events.${ev.id}` : `events[${index}]`);

// ------------------------------------------------------------------ naming

/** A readable id fragment: ASCII, lowercase, `-` between words, at most `max` characters, cut on a word boundary. */
export function slug(text: string, max = 24): string {
  const s = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length <= max) return s || 'x';
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf('-');
  return (at > max / 2 ? cut.slice(0, at) : cut.slice(0, max)).replace(/-+$/, '') || 'x';
}

/** Hands out ids once: the second `house.open-door` becomes `house.open-door-2`. Deterministic in content order. */
export class Namer {
  private used = new Set<string>();
  constructor(taken: Iterable<string> = []) { for (const t of taken) this.used.add(t); }
  take(base: string): string {
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.add(id);
    return id;
  }
}

type BlockKind = 'once' | 'nth' | 'cycle' | 'random';
type Block = Extract<Cmd, { once: Cmd[] } | { nth: Cmd[][] } | { cycle: Cmd[][] } | { random: Cmd[][] }>;
const first = (x: Id | Id[] | undefined) => (Array.isArray(x) ? x[0] : x);
const cmdName = (c: Cmd) => (typeof c === 'string' ? 'say' : Object.keys(c)[0] ?? 'cmd');
const blockKind = (c: Cmd): BlockKind | null =>
  typeof c === 'string' ? null : 'once' in c ? 'once' : 'nth' in c ? 'nth' : 'cycle' in c ? 'cycle' : 'random' in c ? 'random' : null;
const blockLists = (c: Cmd | undefined, kind: BlockKind): Cmd[][] =>
  !c || typeof c === 'string' ? [] : kind === 'once' ? [(c as { once: Cmd[] }).once] : ((c as unknown as Record<string, Cmd[][]>)[kind] ?? []);

export const ruleIdFor = (scope: string, rule: Rule) => `${scope}.${slug(String(first(rule.verb)))}-${slug(first(rule.a) ?? 'x')}${rule.b ? `-${slug(first(rule.b) ?? 'x')}` : ''}`;
export const topicIdFor = (room: Id, actor: Id, topic: TalkTopic) => `${room}.${slug(actor)}.${slug(topic.topic)}`;
export const listenerIdFor = (scope: string, ev: EventRule) => `${scope}.on-${slug(ev.on)}`;
export const choiceIdFor = (owner: string, option: Choice) => `${owner}.c-${slug(option.text, 16)}`;
export const blockIdFor = (owner: string, kind: BlockKind) => `${owner}.${kind}`;
export const stepIdFor = (script: Id, cmd: Cmd) => `${script}.${slug(cmdName(cmd), 12)}`;

// ------------------------------------------------------------------ assignment, with the map from v2 keys to v3 ids

/** What a v2 save and a v2 translation table must be renamed to after `assignIds`. */
export interface IdMap {
  /** `GameState.seen` keys: topics (`<room>.<actor>.<i>` → `topic.<id>`), listeners (`event.<scope>.<i>` → `event.<id>`), choices (`choice.<room>.<text>` → `choice.<id>`). */
  seen: Record<string, string>;
  /** `GameState.counters` keys of once/nth/cycle/random blocks (`<room>:on3.0` → `<id>`). */
  counters: Record<string, string>;
  /** Translation-path prefixes (`room:house/on[3]` → `room:house/on.house.open-pantry`), longest first when applied. */
  paths: Record<string, string>;
  /** Puzzle-graph / session action ids (`rule:house/on[3]` → `rule:house.open-pantry`). */
  labels: Record<string, string>;
}

export interface AssignedIds { game: GameDef; map: IdMap; added: number }

/**
 * Gives every rule, topic, listener, choice option, once/nth/cycle/random block and script step a stable id when it
 * has none, on a clone of the source (the source is never touched), and returns the map a v2 save or translation
 * table needs to follow. Deterministic: the same content yields the same ids. Does not set `schemaVersion`.
 */
export function assignIds(source: GameDef): AssignedIds {
  const game = structuredClone(source);
  // The v2 keys this content had: positional counters (`assignKeys` fills `key`), positional seen keys by convention.
  const old = assignKeys(structuredClone(source));
  const map: IdMap = { seen: {}, counters: {}, paths: {}, labels: {} };
  let added = 0;
  const namer = new Namer(existingIds(game));
  const give = (base: string) => { added++; return namer.take(base); };

  /** Walks a command list of the new game next to the same list of the old one, naming blocks and choices under `owner`. */
  const walk = (list: Cmd[] | undefined, oldList: Cmd[] | undefined, owner: string, oldPrefix: string, newPrefix: string, room: Id | undefined) => {
    list?.forEach((c, i) => {
      if (typeof c === 'string') return;
      const o = oldList?.[i];
      const was = `${oldPrefix}[${i}]`, here = `${newPrefix}[${i}]`;
      const kind = blockKind(c);
      if (kind) {
        const block = c as Block;
        if (!block.id) {
          block.id = give(blockIdFor(owner, kind));
          const oldKey = (o as Block | undefined)?.key;
          if (oldKey) map.counters[oldKey] = block.id;
        }
        const oldLists = blockLists(o, kind);
        blockLists(c, kind).forEach((b, j) => walk(b, oldLists[j], block.id!, kind === 'once' ? `${was}.once` : `${was}.${kind}[${j}]`, kind === 'once' ? `${here}.once` : `${here}.${kind}[${j}]`, room));
        return;
      }
      if ('choice' in c) {
        const oldChoice = o && typeof o !== 'string' && 'choice' in o ? o.choice : undefined;
        c.choice.forEach((opt, j) => {
          const oldSeg = `${was}.choice[${j}]`;
          if (!opt.id) {
            opt.id = give(choiceIdFor(owner, opt));
            if (room) map.seen[`choice.${room}.${opt.text}`] = `choice.${opt.id}`;
          }
          map.paths[oldSeg] = `${here}${choicePathSeg(j, opt)}`;
          walk(opt.do, oldChoice?.[j]?.do, opt.id!, `${oldSeg}.do`, `${here}${choicePathSeg(j, opt)}.do`, room);
        });
        return;
      }
      const sub = (key: string): Cmd[] | undefined => (o && typeof o !== 'string' ? (o as unknown as Record<string, Cmd[] | undefined>)[key] : undefined);
      const both = (suffix: string) => [`${was}${suffix}`, `${here}${suffix}`] as const;
      const go = (l: Cmd[] | undefined, ol: Cmd[] | undefined, suffix: string) => { const [a, b] = both(suffix); walk(l, ol, owner, a, b, room); };
      if ('if' in c) { go(c.then, sub('then'), '.then'); go(c.else, sub('else'), '.else'); }
      else if ('parallel' in c) c.parallel.forEach((b, j) => go(b, (sub('parallel') as unknown as Cmd[][] | undefined)?.[j], `.parallel[${j}]`));
      else if ('cutscene' in c) go(c.cutscene, sub('cutscene'), '.cutscene');
      else if ('minigame' in c) go(c.then, sub('then'), '.then');
      else if ('phone' in c) go(c.do, sub('do'), '.do');
      else if ('anim' in c && c.at) for (const [k, b] of Object.entries(c.at)) go(b, (sub('at') as unknown as Record<string, Cmd[]> | undefined)?.[k], `.at[${k}]`);
      else if ('ending' in c || 'reveal' in c) go((c as { after?: Cmd[] }).after, sub('after'), '.after');
    });
  };

  const rules = (list: Rule[] | undefined, oldList: Rule[] | undefined, scope: string, pathBase: string, room: Id | undefined) => {
    list?.forEach((rule, i) => {
      if (rule.exit) return; // generated by normalizeExits on the compiled game, never written
      if (!rule.id) {
        rule.id = give(ruleIdFor(scope, rule));
        map.labels[`rule:${scope}/on[${i}]`] = `rule:${rule.id}`;
      }
      map.paths[`${pathBase}on[${i}]`] = `${pathBase}${rulePathSeg(i, rule)}`;
      walk(rule.do, oldList?.[i]?.do, rule.id!, `${pathBase}on[${i}].do`, `${pathBase}${rulePathSeg(i, rule)}.do`, room);
    });
  };
  const events = (list: EventRule[] | undefined, oldList: EventRule[] | undefined, scope: string, pathBase: string, room: Id | undefined) => {
    list?.forEach((ev, i) => {
      if (!ev.id) {
        ev.id = give(listenerIdFor(scope, ev));
        map.seen[`event.${scope}.${i}`] = `event.${ev.id}`;
        map.labels[`listener:${scope}/events[${i}]`] = `listener:${ev.id}`;
      }
      map.paths[`${pathBase}events[${i}]`] = `${pathBase}${eventPathSeg(i, ev)}`;
      walk(ev.do, oldList?.[i]?.do, ev.id!, `${pathBase}events[${i}].do`, `${pathBase}${eventPathSeg(i, ev)}.do`, room);
    });
  };
  const scripts = (list: ScriptDef[] | undefined, oldList: ScriptDef[] | undefined, pathBase: string, room: Id | undefined) => {
    list?.forEach((sc, i) => {
      if (!sc.stepIds || sc.stepIds.length !== sc.do.length) {
        const local = new Namer();
        sc.stepIds = sc.do.map((c, j) => sc.stepIds?.[j] ?? (added++, local.take(stepIdFor(sc.id, c))));
      }
      walk(sc.do, oldList?.[i]?.do, sc.id, `${pathBase}scripts.${sc.id}.do`, `${pathBase}scripts.${sc.id}.do`, room);
    });
  };

  for (const [ri, r] of game.rooms.entries()) {
    const o = old.rooms[ri];
    const P = `room:${r.id}/`;
    rules(r.on, o.on, r.id, P, r.id);
    for (const [actor, topics] of Object.entries(r.talk ?? {})) topics.forEach((t, i) => {
      if (!t.id) {
        t.id = give(topicIdFor(r.id, actor, t));
        map.seen[`${r.id}.${actor}.${i}`] = `topic.${t.id}`;
        map.labels[`topic:${r.id}/${actor}[${i}]`] = `topic:${t.id}`;
      }
      map.paths[`${P}talk.${actor}[${i}]`] = `${P}${topicPathSeg(actor, i, t)}`;
      walk(t.do, o.talk?.[actor]?.[i]?.do, t.id!, `${P}talk.${actor}[${i}].do`, `${P}${topicPathSeg(actor, i, t)}.do`, r.id);
    });
    events(r.events, o.events, r.id, P, r.id);
    scripts(r.scripts, o.scripts, P, r.id);
    walk(r.onEnter, o.onEnter, `${r.id}.enter`, `${P}onEnter`, `${P}onEnter`, r.id);
    for (const [pid, p] of Object.entries(r.props ?? {})) for (const [an, a] of Object.entries(p.anims ?? {})) for (const [k, b] of Object.entries(a.at ?? {})) walk(b, (o.props?.[pid]?.anims?.[an]?.at as Record<string, Cmd[]> | undefined)?.[k], `${r.id}.${pid}.${an}.${k}`, `${P}props.${pid}.anims.${an}.at[${k}]`, `${P}props.${pid}.anims.${an}.at[${k}]`, r.id);
  }
  rules(game.rules.on, old.rules.on, 'game', 'rules/', undefined);
  events(game.events, old.events, 'game', '', undefined);
  scripts(game.scripts, old.scripts, '', undefined);
  walk(game.start.intro, old.start.intro, 'game.intro', 'start/intro', 'start/intro', game.start.room);
  return { game, map, added };
}

/** Every id already written in the content (rules, topics, listeners, choices, blocks, step ids), so new ones never collide. */
export function existingIds(game: GameDef): Set<string> {
  const out = new Set<string>();
  const walk = (list: Cmd[] | undefined) => list?.forEach((c) => {
    if (typeof c === 'string') return;
    const kind = blockKind(c);
    if (kind) { if ((c as Block).id) out.add((c as Block).id!); blockLists(c, kind).forEach(walk); return; }
    if ('choice' in c) { c.choice.forEach((o) => { if (o.id) out.add(o.id); walk(o.do); }); return; }
    if ('parallel' in c) { c.parallel.forEach(walk); return; }
    if ('if' in c) { walk(c.then); walk(c.else); }
    else if ('cutscene' in c) walk(c.cutscene);
    else if ('minigame' in c) walk(c.then);
    else if ('phone' in c) walk(c.do);
    else if ('anim' in c && c.at) Object.values(c.at).forEach(walk);
    else if ('ending' in c || 'reveal' in c) walk((c as { after?: Cmd[] }).after);
  });
  const rules = (list?: Rule[]) => list?.forEach((r) => { if (r.id) out.add(r.id); walk(r.do); });
  const events = (list?: EventRule[]) => list?.forEach((e) => { if (e.id) out.add(e.id); walk(e.do); });
  const scripts = (list?: ScriptDef[]) => list?.forEach((s) => { s.stepIds?.forEach((x) => out.add(x)); walk(s.do); });
  for (const r of game.rooms) {
    rules(r.on);
    for (const topics of Object.values(r.talk ?? {})) topics.forEach((t) => { if (t.id) out.add(t.id); walk(t.do); });
    events(r.events); scripts(r.scripts); walk(r.onEnter);
    for (const p of Object.values(r.props ?? {})) for (const a of Object.values(p.anims ?? {})) Object.values(a.at ?? {}).forEach(walk);
  }
  rules(game.rules.on); events(game.events); scripts(game.scripts); walk(game.start.intro);
  return out;
}

/** Renames the keys of a translation table after `assignIds`: the longest matching old prefix wins. */
export function renamePaths(table: Record<string, string>, paths: Record<string, string>): Record<string, string> {
  const olds = Object.keys(paths).sort((a, b) => b.length - a.length);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(table)) {
    const stale = key.startsWith('_stale:');
    const path = stale ? key.slice('_stale:'.length) : key;
    const hit = olds.find((o) => path === o || path.startsWith(o + '.') || path.startsWith(o + '['));
    const renamed = hit ? paths[hit] + path.slice(hit.length) : path;
    out[(stale ? '_stale:' : '') + renamed] = value;
  }
  return out;
}
