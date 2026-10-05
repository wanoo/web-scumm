// Localisation by extraction: the content stays written in one language (`GameDef.lang`); `textPaths` lists every text
// of the game with a stable path, a translation table maps those paths to the translated texts, `applyLocale` returns
// the game with the texts replaced. Nothing changes for whoever writes the content: no keys, no indirection.
// Paths (v2 by position, v3 by stable id: `on.<id>`, `talk.<actor>.<id>`, `.choice.<id>`, `events.<id>`): `room:house/look.pantry[1]`, `item:key/name`, `char:grandma/refuse`, `ui/newGame`, `rules/fallbacks.look[2]`,
// `start/intro[0]`, `credits[3]`, `map/places.house.name`… A list line with an id (`{ id, text }`) is keyed by it:
// `room:house/look.pantry.<id>`, `room:house/hints.<hintId>.lines.<id>`, `rules/fallbacks.look.<id>`, `rules/kinds.<id>.say`.
import type { Cmd, GameDef, ListLine, RoomDef } from '../core/types';
import { listPathSeg } from '../core/list-lines';
import type { Minigame } from '../minigames/types';
import { subLists } from '../core/cmds';
import { choicePathSeg, eventPathSeg, rulePathSeg, topicPathSeg, linePathSeg } from '../core/content-ids';

type Fn = (path: string, text: string) => string | undefined;
export type MinigameTexts = Record<string, Pick<Minigame, 'textParams'>>;

/** Metadata kept here too so node tools understand built-ins without loading their DOM implementations. */
const BUILTIN_TEXT_PARAMS: Record<string, string[]> = {
  pipes: ['intro', 'win'],
  pick: ['rounds.*.prompt', 'decoyLine', 'wrongLine', 'win'],
  hide: ['intro', 'win', 'spots.*.reply'],
  runner: ['intro', 'win', 'stumble'],
  stroke: ['intro', 'win', 'tooFast'],
  cables: ['intro', 'win', 'windowsText'],
  scratch: ['intro'],
};

/** Visits a string at a dotted minigame-param path; `*` visits array items or object values. */
function paramText(value: unknown, parts: string[], path: string, fn: Fn): void {
  if (!parts.length) return;
  const [head = '', ...tail] = parts; // never the default: `parts` is not empty
  if (head === '*') {
    if (Array.isArray(value)) value.forEach((v, i) => paramText(v, tail, `${path}[${i}]`, fn));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) paramText(v, tail, `${path}.${k}`, fn);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const o = value as Record<string, unknown>;
  if (!tail.length) {
    if (typeof o[head] !== 'string') return;
    const r = fn(`${path}.${head}`, o[head] as string);
    if (r !== undefined) o[head] = r;
    return;
  }
  paramText(o[head], tail, `${path}.${head}`, fn);
}

/** Walks a command list; `fn` may replace a text (the list is changed in place). */
function cmds(list: Cmd[] | undefined, path: string, fn: Fn, minigames: MinigameTexts) {
  list?.forEach((c, i) => {
    // A line with an id is keyed by it (`do.house.open-door.l-locked.say`), else by its position (`do[3]`).
    const p = `${path}${linePathSeg(i, c)}`;
    if (typeof c === 'string') {
      const r = fn(p, c);
      if (r !== undefined) list[i] = r;
      return;
    }
    if ('say' in c) {
      const r = fn(`${p}.say`, c.say[1]);
      if (r !== undefined) c.say[1] = r;
    } else if ('toast' in c) {
      const r = fn(`${p}.toast`, c.toast);
      if (r !== undefined) c.toast = r;
    } else if ('sfx' in c && c.caption) {
      const r = fn(`${p}.caption`, c.caption);
      if (r !== undefined) c.caption = r;
    } else if ('guide' in c) {
      const r = fn(`${p}.guide`, c.guide.say);
      if (r !== undefined) c.guide.say = r;
    } else if ('choice' in c) {
      c.choice.forEach((o, j) => {
        const r = fn(`${p}${choicePathSeg(j, o)}.text`, o.text);
        if (r !== undefined) o.text = r;
        cmds(o.do, `${p}${choicePathSeg(j, o)}.do`, fn, minigames);
      });
      return;
    }
    if ('minigame' in c)
      for (const q of minigames[c.minigame]?.textParams ?? BUILTIN_TEXT_PARAMS[c.minigame] ?? [])
        paramText(c.params, q.split('.'), `${p}.params`, fn);
    for (const s of subLists(c)) cmds(s.list, p + s.path, fn, minigames);
  });
}

/** The lines of a list (`[i]` or `.<id>` after `path`); a replacement keeps the line's shape. */
function lines(list: ListLine[], path: string, fn: Fn) {
  list.forEach((l, i) => {
    const r = fn(`${path}${listPathSeg(i, l)}`, typeof l === 'string' ? l : l.text);
    if (r !== undefined) list[i] = typeof l === 'string' ? r : { ...l, text: r };
  });
}

function strOrList(o: Record<string, string | ListLine[]> | undefined, path: string, fn: Fn) {
  for (const [k, v] of Object.entries(o ?? {})) {
    if (typeof v === 'string') {
      const r = fn(`${path}.${k}`, v);
      if (r !== undefined) o![k] = r;
    } else lines(v, `${path}.${k}`, fn);
  }
}

function room(r: RoomDef, fn: Fn, minigames: MinigameTexts) {
  const P = `room:${r.id}/`;
  const one = (path: string, v: string | undefined, set: (x: string) => void) => {
    if (v === undefined) return;
    const x = fn(P + path, v);
    if (x !== undefined) set(x);
  };
  one('name', r.name, (x) => {
    r.name = x;
  });
  for (const [id, h] of Object.entries(r.hotspots ?? {}))
    if (!h.exit)
      one(`hotspots.${id}.name`, h.name, (x) => {
        h.name = x;
      });
  for (const [id, p] of Object.entries(r.props ?? {}))
    one(`props.${id}.name`, p.name, (x) => {
      p.name = x;
    });
  for (const [id, a] of Object.entries(r.actors ?? {}))
    one(`actors.${id}.name`, a.name, (x) => {
      a.name = x;
    });
  for (const [id, e] of Object.entries(r.exits ?? {})) {
    one(`exits.${id}.name`, e.name, (x) => {
      e.name = x;
    });
    one(`exits.${id}.locked`, e.locked, (x) => {
      e.locked = x;
    });
  }
  for (const [id, k] of Object.entries(r.stage?.links ?? {}))
    one(`stage.links.${id}.locked`, k.locked, (x) => {
      k.locked = x;
    });
  strOrList(r.look, `${P}look`, fn);
  (r.on ?? []).forEach((x, i) => {
    if (!x.exit) cmds(x.do, `${P}${rulePathSeg(i, x)}.do`, fn, minigames);
  });
  for (const [actor, ts] of Object.entries(r.talk ?? {}))
    ts.forEach((t, i) => {
      one(`${topicPathSeg(actor, i, t)}.topic`, t.topic, (x) => {
        t.topic = x;
      });
      cmds(t.do, `${P}${topicPathSeg(actor, i, t)}.do`, fn, minigames);
    });
  (r.hints ?? []).forEach((h, i) => lines(h.lines, `${P}${h.id ? `hints.${h.id}` : `hints[${i}]`}.lines`, fn));
  cmds(r.onEnter, `${P}onEnter`, fn, minigames);
  (r.scripts ?? []).forEach((sc) => cmds(sc.do, `${P}scripts.${sc.id}.do`, fn, minigames));
  (r.events ?? []).forEach((ev, i) => cmds(ev.do, `${P}${eventPathSeg(i, ev)}.do`, fn, minigames));
  for (const [pid, p] of Object.entries(r.props ?? {}))
    for (const [an, a] of Object.entries(p.anims ?? {}))
      for (const [k, b] of Object.entries(a.at ?? {})) cmds(b, `${P}props.${pid}.anims.${an}.at[${k}]`, fn, minigames);
}

/** Visits every text of the game; `fn` may return a replacement. The game is changed in place. */
export function walkTexts(game: GameDef, fn: Fn, minigames: MinigameTexts = {}): void {
  const one = (path: string, v: string | undefined, set: (x: string) => void) => {
    if (v === undefined) return;
    const x = fn(path, v);
    if (x !== undefined) set(x);
  };
  one('title', game.title, (x) => {
    game.title = x;
  });
  game.rooms.forEach((r) => room(r, fn, minigames));
  game.verbs.forEach((v) => {
    one(`verb:${v.id}/label`, v.label, (x) => {
      v.label = x;
    });
    one(`verb:${v.id}/join`, v.join, (x) => {
      v.join = x;
    });
  });
  for (const [id, it] of Object.entries(game.items)) {
    one(`item:${id}/name`, it.name, (x) => {
      it.name = x;
    });
    if (typeof it.look === 'string')
      one(`item:${id}/look`, it.look, (x) => {
        it.look = x;
      });
    else if (it.look) lines(it.look, `item:${id}/look`, fn);
  }
  for (const [id, c] of Object.entries(game.characters)) {
    one(`char:${id}/name`, c.name, (x) => {
      c.name = x;
    });
    one(`char:${id}/refuse`, c.refuse, (x) => {
      c.refuse = x;
    });
    one(`char:${id}/hug`, c.hug, (x) => {
      c.hug = x;
    });
  }
  for (const [v, list] of Object.entries(game.rules.fallbacks)) if (list) lines(list, `rules/fallbacks.${v}`, fn);
  (game.rules.kinds ?? []).forEach((k, i) =>
    one(`rules/${k.id ? `kinds.${k.id}` : `kinds[${i}]`}.say`, k.say, (x) => {
      k.say = x;
    }),
  );
  (game.rules.on ?? []).forEach((r, i) => cmds(r.do, `rules/${rulePathSeg(i, r)}.do`, fn, minigames));
  (game.scripts ?? []).forEach((sc) => cmds(sc.do, `scripts.${sc.id}.do`, fn, minigames));
  (game.events ?? []).forEach((ev, i) => cmds(ev.do, `${eventPathSeg(i, ev)}.do`, fn, minigames));
  if (game.globalTalk)
    for (const k of ['hug', 'bye', 'byeLine'] as const)
      one(`globalTalk/${k}`, game.globalTalk[k], (x) => {
        game.globalTalk![k] = x;
      });
  if (game.players?.give)
    one('players/give', game.players.give, (x) => {
      game.players!.give = x;
    });
  cmds(game.start.intro, 'start/intro', fn, minigames);
  for (const [k, v] of Object.entries(game.ui))
    if (typeof v === 'string')
      one(`ui/${k}`, v, (x) => {
        (game.ui as unknown as Record<string, string>)[k] = x;
      });
  (game.credits ?? []).forEach((t, i) =>
    one(`credits[${i}]`, t, (x) => {
      game.credits![i] = x;
    }),
  );
  one('titleScreen/footer', game.titleScreen?.footer, (x) => {
    game.titleScreen!.footer = x;
  });
  for (const [id, r] of Object.entries(game.map?.regions ?? {}))
    one(`map/regions.${id}.name`, r.name, (x) => {
      r.name = x;
    });
  for (const [id, p] of Object.entries(game.map?.places ?? {}))
    one(`map/places.${id}.name`, p.name, (x) => {
      p.name = x;
    });
  if (game.ending?.guess) {
    const g = game.ending.guess;
    for (const k of ['right', 'wrong', 'none'] as const)
      one(`ending/guess.${k}`, g[k], (x) => {
        g[k] = x;
      });
    for (const [k, v] of Object.entries(g.labels))
      one(`ending/guess.labels.${k}`, v, (x) => {
        g.labels[k] = x;
      });
  }
  if (game.ending?.password && 'typed' in game.ending.password)
    one('ending/password.prompt', game.ending.password.prompt, (x) => {
      (game.ending!.password as { typed: true; prompt: string }).prompt = x;
    });
}

/** Every text of the game with its path, in content order. */
export function textPaths(game: GameDef, minigames: MinigameTexts = {}): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  walkTexts(
    structuredClone(game),
    (path, text) => {
      out.push({ path, text });
      return undefined;
    },
    minigames,
  );
  return out;
}

/** The game with its texts translated from `table` (path → text); texts the table lacks stay as written. */
export function applyLocale<T extends GameDef>(
  game: T,
  table: Record<string, string> | undefined,
  minigames: MinigameTexts = {},
): T {
  if (!table) return game;
  const g = structuredClone(game);
  walkTexts(
    g,
    (path, text) => {
      const t = table[path];
      return typeof t === 'string' && (t !== '' || text === '') ? t : undefined;
    },
    minigames,
  );
  return g;
}

export interface Merged {
  table: Record<string, string>;
  added: number;
  remapped: number;
  revived: number;
  stale: string[];
}

/**
 * A translation table brought up to date with the game's current texts: a translated path is kept; a path that is new
 * but whose source text (as `oldBase` recorded it at the previous extraction) matches an entry that disappeared takes
 * its translation (a reordered list, a moved rule); the rest gets the source text, to translate. Entries that no longer
 * match anything are kept under `_stale:<old path>` (ignored by `applyLocale`, listed by `localeStatus`), and such an
 * entry comes back when its path exists again.
 */
export function mergeLocale(
  paths: { path: string; text: string }[],
  existing: Record<string, string>,
  oldBase: Record<string, string> = {},
): Merged {
  const known = new Set(paths.map((p) => p.path));
  const now = new Map(paths.map((p) => [p.path, p.text]));
  // The pool of translations with no current home: parked ones, paths that disappeared, and paths whose source text
  // changed since the previous reference (the old translation belongs to the old text).
  const pool = new Map<string, string>();
  for (const [k, v] of Object.entries(existing)) {
    if (k.startsWith('_stale:')) pool.set(k.slice(7), v);
    else if (k.startsWith('_')) continue;
    else if (!known.has(k)) pool.set(k, v);
    else if (oldBase[k] !== undefined && oldBase[k] !== now.get(k) && v !== oldBase[k]) pool.set(k, v);
  }
  const bySrc = new Map<string, string[]>();
  for (const p of pool.keys()) {
    const src = oldBase[p];
    if (src !== undefined && pool.get(p) !== src) bySrc.set(src, [...(bySrc.get(src) ?? []), p]);
  }
  const table: Record<string, string> = {};
  const used = new Set<string>();
  let added = 0,
    remapped = 0,
    revived = 0;
  for (const { path, text } of paths) {
    if (existing[path] && !pool.has(path)) {
      table[path] = existing[path];
      continue;
    }
    if (pool.has(path) && !used.has(path) && (oldBase[path] === undefined || oldBase[path] === text)) {
      table[path] = pool.get(path)!;
      used.add(path);
      revived++;
      continue;
    }
    const cand = bySrc.get(text)?.filter((o) => !used.has(o))[0];
    if (cand !== undefined) {
      used.add(cand);
      table[path] = pool.get(cand)!;
      remapped++;
      continue;
    }
    table[path] = text;
    added++;
  }
  for (const [p, v] of pool) if (!used.has(p) && v !== oldBase[p]) table[`_stale:${p}`] = v;
  return {
    table,
    added,
    remapped,
    revived,
    stale: [...pool.keys()].filter((p) => !used.has(p) && pool.get(p) !== oldBase[p]),
  };
}

/** Coverage of a translation table against the game: what is missing, what no longer exists, what is long. */
export function localeStatus(game: GameDef, table: Record<string, string>, maxText = 140) {
  const paths = textPaths(game);
  const keys = new Set(paths.map((p) => p.path));
  const missing = paths.filter((p) => !(p.path in table)).map((p) => p.path);
  const stale = Object.keys(table).filter((k) =>
    k.startsWith('_stale:') ? !keys.has(k.slice(7)) : !k.startsWith('_') && !keys.has(k),
  );
  const long = paths.filter((p) => (table[p.path] ?? '').length > maxText).map((p) => p.path);
  // Present but identical to the source text: not translated yet (names and numbers can legitimately stay the same).
  const same = paths
    .filter((p) => p.text && table[p.path] === p.text && !/^[\d\s.,:%-]*$/.test(p.text))
    .map((p) => p.path);
  const allowed = new Set(game.i18n?.same ?? []);
  const untranslated = same.filter((p) => !allowed.has(p));
  return { total: paths.length, translated: paths.length - missing.length, missing, stale, long, same, untranslated };
}
