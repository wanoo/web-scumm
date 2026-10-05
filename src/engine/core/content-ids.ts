// Stable content ids (schema v3) and the single place that names things for the engine, the solver, the puzzle
// graph, the translation tables and the migration of v2 saves. v2 content keeps its positional names.
import { listPathSeg, listText } from './list-lines';
import type { Choice, Cmd, EventRule, GameDef, Id, ListLine, Rule, ScriptDef, TalkTopic } from './types';
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
export const topicPathSeg = (actor: Id, index: number, topic: TalkTopic) =>
  topic.id ? `talk.${actor}.${topic.id}` : `talk.${actor}[${index}]`;
/** `.choice.<id>` in v3, `.choice[<j>]` in v2. */
export const choicePathSeg = (index: number, option: Choice) =>
  option.id ? `.choice.${option.id}` : `.choice[${index}]`;
/** A line command (`say`, `toast`, `guide`) with an id: `.<id>` replaces `[<i>]` in its translation path. */
export const linePathSeg = (index: number, c: Cmd) =>
  typeof c !== 'string' && 'id' in c && c.id && ('say' in c || 'toast' in c || 'guide' in c)
    ? `.${c.id}`
    : `[${index}]`;
/** `events.<id>` in v3, `events[<i>]` in v2. */
export const eventPathSeg = (index: number, ev: EventRule) => (ev.id ? `events.${ev.id}` : `events[${index}]`);

// ------------------------------------------------------------------ naming

/** A readable id fragment: ASCII, lowercase, `-` between words, at most `max` characters, cut on a word boundary. */
export function slug(text: string, max = 24): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= max) return s || 'x';
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf('-');
  return (at > max / 2 ? cut.slice(0, at) : cut.slice(0, max)).replace(/-+$/, '') || 'x';
}

/** Hands out ids once: the second `house.open-door` becomes `house.open-door-2`. Deterministic in content order. */
export class Namer {
  private used = new Set<string>();
  constructor(taken: Iterable<string> = []) {
    for (const t of taken) this.used.add(t);
  }
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
const cmdName = (c: Cmd) => (typeof c === 'string' ? 'say' : (Object.keys(c)[0] ?? 'cmd'));
const blockKind = (c: Cmd): BlockKind | null =>
  typeof c === 'string'
    ? null
    : 'once' in c
      ? 'once'
      : 'nth' in c
        ? 'nth'
        : 'cycle' in c
          ? 'cycle'
          : 'random' in c
            ? 'random'
            : null;
const blockLists = (c: Cmd | undefined, kind: BlockKind): Cmd[][] =>
  !c || typeof c === 'string'
    ? []
    : kind === 'once'
      ? [(c as { once: Cmd[] }).once]
      : ((c as unknown as Record<string, Cmd[][]>)[kind] ?? []);

export const ruleIdFor = (scope: string, rule: Rule) =>
  `${scope}.${slug(String(first(rule.verb)))}-${slug(first(rule.a) ?? 'x')}${rule.b ? `-${slug(first(rule.b) ?? 'x')}` : ''}`;
export const topicIdFor = (room: Id, actor: Id, topic: TalkTopic) => `${room}.${slug(actor)}.${slug(topic.topic)}`;
export const listenerIdFor = (scope: string, ev: EventRule) => `${scope}.on-${slug(ev.on)}`;
export const choiceIdFor = (owner: string, option: Choice) => `${owner}.c-${slug(option.text, 16)}`;
export const blockIdFor = (owner: string, kind: BlockKind) => `${owner}.${kind}`;
export const stepIdFor = (script: Id, cmd: Cmd) => `${script}.${slug(cmdName(cmd), 12)}`;
/** A line's id: its owner (rule, topic, block, choice, script) and the start of its text. */
export const lineIdFor = (owner: string, text: string) => `${owner}.l-${slug(text, 16)}`;
const lineText = (c: Cmd): string | undefined =>
  typeof c === 'string'
    ? undefined
    : 'say' in c
      ? c.say[1]
      : 'toast' in c
        ? c.toast
        : 'guide' in c
          ? c.guide.say
          : undefined;

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

export interface AssignedIds {
  game: GameDef;
  map: IdMap;
  added: number;
}

export interface AssignOptions {
  /**
   * Also give the lines an id: `true` names the `say` / `toast` / `guide` objects that have none; `'all'` first turns
   * every plain string line into `{ say: ['hero', text] }` so that it can carry one (verbose: for a game that voices
   * or translates every line). Default: lines keep their position inside their owner.
   */
  lines?: boolean | 'all';
}

/**
 * Gives every rule, topic, listener, choice option, once/nth/cycle/random block and script step a stable id when it
 * has none, on a clone of the source (the source is never touched), and returns the map a v2 save or translation
 * table needs to follow. Deterministic: the same content yields the same ids. Does not set `schemaVersion`.
 */
export function assignIds(source: GameDef, options: AssignOptions = {}): AssignedIds {
  const game = structuredClone(source);
  const lines = options.lines ?? false;
  // The v2 keys this content had: positional counters (`assignKeys` fills `key`), positional seen keys by convention.
  const old = assignKeys(structuredClone(source));
  const map: IdMap = { seen: {}, counters: {}, paths: {}, labels: {} };
  let added = 0;
  const namer = new Namer(existingIds(game));
  const give = (base: string) => {
    added++;
    return namer.take(base);
  };

  /** Walks a command list of the new game next to the same list of the old one, naming blocks and choices under `owner`. */
  const walk = (
    list: Cmd[] | undefined,
    oldList: Cmd[] | undefined,
    owner: string,
    oldPrefix: string,
    newPrefix: string,
    room: Id | undefined,
  ) => {
    list?.forEach((c, i) => {
      let wasString = false;
      if (typeof c === 'string') {
        if (lines !== 'all') return;
        c = { say: ['hero', c] };
        list[i] = c;
        wasString = true;
      }
      const o = oldList?.[i];
      const text = lineText(c);
      if (text !== undefined) {
        const line = c as { id?: Id };
        if (lines && !line.id) line.id = give(lineIdFor(owner, text));
        // A plain string's text was the path itself (`do[2]`); as a say object it lives under `.say`.
        if (line.id)
          map.paths[`${oldPrefix}${linePathSeg(i, o ?? c)}`] =
            `${newPrefix}${linePathSeg(i, c)}${wasString ? '.say' : ''}`;
        return;
      }
      const was = `${oldPrefix}[${i}]`,
        here = `${newPrefix}[${i}]`;
      const kind = blockKind(c);
      if (kind) {
        const block = c as Block;
        if (!block.id) {
          block.id = give(blockIdFor(owner, kind));
          const oldKey = (o as Block | undefined)?.key;
          if (oldKey) map.counters[oldKey] = block.id;
        }
        const oldLists = blockLists(o, kind);
        blockLists(c, kind).forEach((b, j) =>
          walk(
            b,
            oldLists[j],
            block.id!,
            kind === 'once' ? `${was}.once` : `${was}.${kind}[${j}]`,
            kind === 'once' ? `${here}.once` : `${here}.${kind}[${j}]`,
            room,
          ),
        );
        return;
      }
      if ('choice' in c) {
        const oldChoice = o && typeof o !== 'string' && 'choice' in o ? o.choice : undefined;
        c.choice.forEach((opt, j) => {
          const oldSeg = `${was}${choicePathSeg(j, oldChoice?.[j] ?? { text: opt.text, do: [] })}`;
          if (!opt.id) {
            opt.id = give(choiceIdFor(owner, opt));
            if (room) map.seen[`choice.${room}.${opt.text}`] = `choice.${opt.id}`;
          }
          map.paths[oldSeg] = `${here}${choicePathSeg(j, opt)}`;
          walk(opt.do, oldChoice?.[j]?.do, opt.id!, `${oldSeg}.do`, `${here}${choicePathSeg(j, opt)}.do`, room);
        });
        return;
      }
      const sub = (key: string): Cmd[] | undefined =>
        o && typeof o !== 'string' ? (o as unknown as Record<string, Cmd[] | undefined>)[key] : undefined;
      const both = (suffix: string) => [`${was}${suffix}`, `${here}${suffix}`] as const;
      const go = (l: Cmd[] | undefined, ol: Cmd[] | undefined, suffix: string) => {
        const [a, b] = both(suffix);
        walk(l, ol, owner, a, b, room);
      };
      if ('if' in c) {
        go(c.then, sub('then'), '.then');
        go(c.else, sub('else'), '.else');
      } else if ('parallel' in c)
        c.parallel.forEach((b, j) =>
          go(b, (sub('parallel') as unknown as Cmd[][] | undefined)?.[j], `.parallel[${j}]`),
        );
      else if ('cutscene' in c) go(c.cutscene, sub('cutscene'), '.cutscene');
      else if ('minigame' in c) go(c.then, sub('then'), '.then');
      else if ('phone' in c) go(c.do, sub('do'), '.do');
      else if ('anim' in c && c.at)
        for (const [k, b] of Object.entries(c.at))
          go(b, (sub('at') as unknown as Record<string, Cmd[]> | undefined)?.[k], `.at[${k}]`);
      else if ('ending' in c || 'reveal' in c) go((c as { after?: Cmd[] }).after, sub('after'), '.after');
    });
  };

  const rules = (
    list: Rule[] | undefined,
    oldList: Rule[] | undefined,
    scope: string,
    pathBase: string,
    room: Id | undefined,
  ) => {
    list?.forEach((rule, i) => {
      if (rule.exit) return; // generated by normalizeExits on the compiled game, never written
      if (!rule.id) {
        rule.id = give(ruleIdFor(scope, rule));
        map.labels[`rule:${scope}/on[${i}]`] = `rule:${rule.id}`;
      }
      const oldSeg = `${pathBase}${rulePathSeg(i, oldList?.[i] ?? rule)}`;
      map.paths[oldSeg] = `${pathBase}${rulePathSeg(i, rule)}`;
      walk(rule.do, oldList?.[i]?.do, rule.id!, `${oldSeg}.do`, `${pathBase}${rulePathSeg(i, rule)}.do`, room);
    });
  };
  const events = (
    list: EventRule[] | undefined,
    oldList: EventRule[] | undefined,
    scope: string,
    pathBase: string,
    room: Id | undefined,
  ) => {
    list?.forEach((ev, i) => {
      if (!ev.id) {
        ev.id = give(listenerIdFor(scope, ev));
        map.seen[`event.${scope}.${i}`] = `event.${ev.id}`;
        map.labels[`listener:${scope}/events[${i}]`] = `listener:${ev.id}`;
      }
      const oldSeg = `${pathBase}${eventPathSeg(i, oldList?.[i] ?? ev)}`;
      map.paths[oldSeg] = `${pathBase}${eventPathSeg(i, ev)}`;
      walk(ev.do, oldList?.[i]?.do, ev.id!, `${oldSeg}.do`, `${pathBase}${eventPathSeg(i, ev)}.do`, room);
    });
  };
  const scripts = (
    list: ScriptDef[] | undefined,
    oldList: ScriptDef[] | undefined,
    pathBase: string,
    room: Id | undefined,
  ) => {
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
    for (const [actor, topics] of Object.entries(r.talk ?? {}))
      topics.forEach((t, i) => {
        if (!t.id) {
          t.id = give(topicIdFor(r.id, actor, t));
          map.seen[`${r.id}.${actor}.${i}`] = `topic.${t.id}`;
          map.labels[`topic:${r.id}/${actor}[${i}]`] = `topic:${t.id}`;
        }
        const oldSeg = `${P}${topicPathSeg(actor, i, o.talk?.[actor]?.[i] ?? t)}`;
        map.paths[oldSeg] = `${P}${topicPathSeg(actor, i, t)}`;
        walk(t.do, o.talk?.[actor]?.[i]?.do, t.id!, `${oldSeg}.do`, `${P}${topicPathSeg(actor, i, t)}.do`, r.id);
      });
    events(r.events, o.events, r.id, P, r.id);
    scripts(r.scripts, o.scripts, P, r.id);
    walk(r.onEnter, o.onEnter, `${r.id}.enter`, `${P}onEnter`, `${P}onEnter`, r.id);
    for (const [pid, p] of Object.entries(r.props ?? {}))
      for (const [an, a] of Object.entries(p.anims ?? {}))
        for (const [k, b] of Object.entries(a.at ?? {}))
          walk(
            b,
            (o.props?.[pid]?.anims?.[an]?.at as Record<string, Cmd[]> | undefined)?.[k],
            `${r.id}.${pid}.${an}.${k}`,
            `${P}props.${pid}.anims.${an}.at[${k}]`,
            `${P}props.${pid}.anims.${an}.at[${k}]`,
            r.id,
          );
  }
  // The lines of lists (looks, hints, fallback answers) and the reactions by kind: with `lines`, an id each; `all`
  // also turns their plain strings into `{ id, text }`. A list that is a single string (`look: '…'`) is keyed by its
  // owner already and stays as it is.
  const list = (l: ListLine[], owner: string, oldPrefix: string, newPrefix: string) => {
    if (!lines) return;
    l.forEach((x, i) => {
      const was = `${oldPrefix}${listPathSeg(i, x)}`;
      if (typeof x === 'string') {
        if (lines !== 'all') return;
        l[i] = x = { id: '', text: x };
      }
      if (!x.id) x.id = give(lineIdFor(owner, listText(x)));
      map.paths[was] = `${newPrefix}${listPathSeg(i, x)}`;
    });
  };
  if (lines) {
    for (const r of game.rooms) {
      const P = `room:${r.id}/`;
      for (const [k, v] of Object.entries(r.look ?? {}))
        if (typeof v !== 'string') list(v, `${r.id}.look-${slug(k)}`, `${P}look.${k}`, `${P}look.${k}`);
      (r.hints ?? []).forEach((h, i) => {
        const was = `${P}${h.id ? `hints.${h.id}` : `hints[${i}]`}`;
        if (!h.id) h.id = give(`${r.id}.hint`);
        const here = `${P}hints.${h.id}`;
        map.paths[was] = here;
        list(h.lines, h.id, `${was}.lines`, `${here}.lines`);
      });
    }
    for (const [id, it] of Object.entries(game.items))
      if (it.look && typeof it.look !== 'string')
        list(it.look, `item.${slug(id)}`, `item:${id}/look`, `item:${id}/look`);
    for (const [v, l] of Object.entries(game.rules.fallbacks))
      if (l) list(l, `fallback.${slug(v)}`, `rules/fallbacks.${v}`, `rules/fallbacks.${v}`);
    (game.rules.kinds ?? []).forEach((k, i) => {
      const was = `rules/${k.id ? `kinds.${k.id}` : `kinds[${i}]`}`;
      if (!k.id) k.id = give(`kind.${slug(String(first(k.verb)))}-${slug(k.target ?? k.kind ?? 'x')}`);
      map.paths[was] = `rules/kinds.${k.id}`;
    });
  }
  rules(game.rules.on, old.rules.on, 'game', 'rules/', undefined);
  events(game.events, old.events, 'game', '', undefined);
  scripts(game.scripts, old.scripts, '', undefined);
  walk(game.start.intro, old.start.intro, 'game.intro', 'start/intro', 'start/intro', game.start.room);
  return { game, map, added };
}

/** Every line of the game that carries an id: who speaks, the text, and the id (`npm run i18n -- voices`). */
export function lineIds(game: GameDef): { id: Id; who: Id; text: string }[] {
  const out: { id: Id; who: Id; text: string }[] = [];
  const walk = (list: Cmd[] | undefined) =>
    list?.forEach((c) => {
      if (typeof c === 'string') return;
      const text = lineText(c);
      if (text !== undefined) {
        const id = (c as { id?: Id }).id;
        if (id) out.push({ id, who: 'say' in c ? c.say[0] : 'hero', text });
        return;
      }
      const kind = blockKind(c);
      if (kind) {
        blockLists(c, kind).forEach(walk);
        return;
      }
      if ('choice' in c) {
        c.choice.forEach((o) => walk(o.do));
        return;
      }
      if ('parallel' in c) {
        c.parallel.forEach(walk);
        return;
      }
      if ('if' in c) {
        walk(c.then);
        walk(c.else);
      } else if ('cutscene' in c) walk(c.cutscene);
      else if ('minigame' in c) walk(c.then);
      else if ('phone' in c) walk(c.do);
      else if ('anim' in c && c.at) Object.values(c.at).forEach(walk);
      else if ('ending' in c || 'reveal' in c) walk((c as { after?: Cmd[] }).after);
    });
  for (const r of game.rooms) {
    r.on?.forEach((x) => walk(x.do));
    for (const topics of Object.values(r.talk ?? {})) topics.forEach((t) => walk(t.do));
    r.events?.forEach((e) => walk(e.do));
    r.scripts?.forEach((s) => walk(s.do));
    walk(r.onEnter);
    for (const p of Object.values(r.props ?? {}))
      for (const a of Object.values(p.anims ?? {})) Object.values(a.at ?? {}).forEach(walk);
  }
  game.rules.on?.forEach((x) => walk(x.do));
  game.events?.forEach((e) => walk(e.do));
  game.scripts?.forEach((s) => walk(s.do));
  walk(game.start.intro);
  return [...out, ...listLines(game)];
}

/** The lines of lists that carry an id (looks, hints, fallback answers, reactions by kind), as `lineIds` lists them. */
export function listLines(game: GameDef): { id: Id; who: Id; text: string }[] {
  const out: { id: Id; who: Id; text: string }[] = [];
  const add = (l: ListLine[] | string | undefined, who: Id = 'hero') => {
    if (typeof l === 'object')
      for (const x of l) if (typeof x !== 'string' && x.id) out.push({ id: x.id, who, text: x.text });
  };
  for (const r of game.rooms) {
    for (const v of Object.values(r.look ?? {})) add(v);
    for (const h of r.hints ?? []) add(h.lines, game.hintVoice ?? 'hero');
  }
  for (const it of Object.values(game.items)) add(it.look);
  for (const l of Object.values(game.rules.fallbacks)) add(l);
  for (const k of game.rules.kinds ?? []) if (k.id) out.push({ id: k.id, who: 'hero', text: k.say });
  return out;
}

/** Every id already written in the content (rules, topics, listeners, choices, blocks, step ids), so new ones never collide. */
export function existingIds(game: GameDef): Set<string> {
  const out = new Set<string>();
  const walk = (list: Cmd[] | undefined) =>
    list?.forEach((c) => {
      if (typeof c === 'string') return;
      if (lineText(c) !== undefined) {
        const id = (c as { id?: Id }).id;
        if (id) out.add(id);
        return;
      }
      const kind = blockKind(c);
      if (kind) {
        if ((c as Block).id) out.add((c as Block).id!);
        blockLists(c, kind).forEach(walk);
        return;
      }
      if ('choice' in c) {
        c.choice.forEach((o) => {
          if (o.id) out.add(o.id);
          walk(o.do);
        });
        return;
      }
      if ('parallel' in c) {
        c.parallel.forEach(walk);
        return;
      }
      if ('if' in c) {
        walk(c.then);
        walk(c.else);
      } else if ('cutscene' in c) walk(c.cutscene);
      else if ('minigame' in c) walk(c.then);
      else if ('phone' in c) walk(c.do);
      else if ('anim' in c && c.at) Object.values(c.at).forEach(walk);
      else if ('ending' in c || 'reveal' in c) walk((c as { after?: Cmd[] }).after);
    });
  const rules = (list?: Rule[]) =>
    list?.forEach((r) => {
      if (r.id) out.add(r.id);
      walk(r.do);
    });
  const events = (list?: EventRule[]) =>
    list?.forEach((e) => {
      if (e.id) out.add(e.id);
      walk(e.do);
    });
  const scripts = (list?: ScriptDef[]) =>
    list?.forEach((s) => {
      s.stepIds?.forEach((x) => out.add(x));
      walk(s.do);
    });
  for (const r of game.rooms) {
    rules(r.on);
    for (const topics of Object.values(r.talk ?? {}))
      topics.forEach((t) => {
        if (t.id) out.add(t.id);
        walk(t.do);
      });
    events(r.events);
    scripts(r.scripts);
    walk(r.onEnter);
    for (const p of Object.values(r.props ?? {}))
      for (const a of Object.values(p.anims ?? {})) Object.values(a.at ?? {}).forEach(walk);
  }
  rules(game.rules.on);
  events(game.events);
  scripts(game.scripts);
  walk(game.start.intro);
  for (const l of listLines(game)) out.add(l.id);
  for (const r of game.rooms) for (const h of r.hints ?? []) if (h.id) out.add(h.id);
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
