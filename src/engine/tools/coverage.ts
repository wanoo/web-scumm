// Storyboard coverage: what the story says, checked against what the game implements. A storyboard (games/<id>/
// storyboard.json, the Studio's Storyboard tab) names rooms, speakers, talk characters and sounds by id, and says the
// rest in prose: panel actions ("Open Grandpa's armchair"), lines, topics, hints. Each is looked up in the content:
// ok (found), partial (the pieces exist but not the whole: the entities but no rule, a close line, a character not in
// that room), missing (the game has nothing of it), unknown (prose the checker cannot read). Pure TypeScript: the
// Studio (badges on the panels, a Check panel), the `storyboard_coverage` tool and `npm run page:storyboard` read it.
import { listPathSeg, listText } from '../core/list-lines';
import type { GameDef, Id, RoomDef, Rule, VerbId } from '../core/types';
import { textPaths } from './i18n';
import { cmdLists, eachCmd } from '../core/cmds';
import { normalizeExits } from '../core/define';

/** The storyboard, normalised (`normalizeStoryboard` in tools/pages/storyboard-data.ts): only what the checker reads. */
export interface CoverLine {
  who: string;
  text: string;
}
export interface CoverBoard {
  id: string;
  title: string;
  room?: string;
  arrival?: CoverLine[];
  hints?: string[];
  panels: { id: string; title: string; action?: string; lines?: CoverLine[]; sfx?: string[] }[];
  talks?: Record<string, { topic: string; lines?: CoverLine[] }[]>;
  reactions?: { action: string; lines?: CoverLine[] }[];
}
export interface CoverStoryboard {
  boards: CoverBoard[];
}

export type CoverStatus = 'ok' | 'partial' | 'missing' | 'unknown';
export interface Check {
  what: string;
  status: CoverStatus;
  detail?: string /** The content path that matched (a text, a rule). */;
  path?: string;
}
export interface PanelCoverage {
  id: string;
  title: string;
  action?: Check;
  lines: Check[];
  sfx: Check[];
  status: CoverStatus;
  score: number;
}
export interface BoardCoverage {
  id: string;
  title: string;
  room?: Check;
  arrival: Check[];
  hints: Check[];
  talks: { actor: Check; topics: Check[] }[];
  reactions: Check[];
  panels: PanelCoverage[];
  status: CoverStatus;
  score: number;
}
export interface Coverage {
  boards: BoardCoverage[];
  totals: Record<CoverStatus, number>;
  score: number;
}

/** Lowercase, no parenthesised notes, no punctuation, one space. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[’‘`]/g, "'")
    .replace(/[«»“”"]/g, ' ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const words = (s: string) =>
  new Set(
    norm(s)
      .split(' ')
      .filter((w) => w.length > 1),
  );
/** How alike two texts are: shared words over all words. */
export function alike(a: string, b: string): number {
  const A = words(a),
    B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

const worst = (list: CoverStatus[]): CoverStatus =>
  list.includes('missing')
    ? 'missing'
    : list.includes('partial')
      ? 'partial'
      : list.some((s) => s === 'ok')
        ? 'ok'
        : 'unknown';
const scoreOf = (checks: Check[]) => {
  const c = checks.filter((x) => x.status !== 'unknown');
  return c.length ? c.filter((x) => x.status === 'ok').length / c.length : 1;
};
const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

export function storyboardCoverage(gameIn: GameDef, sb: CoverStoryboard): Coverage {
  const game = normalizeExits(structuredClone(gameIn)); // declared exits become hotspots and rules
  const texts = textPaths(game).map((t) => ({ path: t.path, text: t.text, n: norm(t.text) }));
  // A minigame's texts live in its `params`: they count as the game's lines too.
  for (const { list, path } of cmdLists(game))
    eachCmd(list, (c, p) => {
      if (typeof c === 'string' || !('minigame' in c) || !c.params) return;
      const walk = (v: unknown, at: string) => {
        if (typeof v === 'string') {
          if (v.length > 3 && /\s/.test(v)) texts.push({ path: `${path}${p}.params${at}`, text: v, n: norm(v) });
          return;
        }
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
      };
      walk(c.params, '');
    });
  const rooms = new Map(game.rooms.map((r) => [r.id, r]));
  const sfxIds = new Set(Object.keys(game.audio?.sfx ?? {}));
  const totals: Record<CoverStatus, number> = { ok: 0, partial: 0, missing: 0, unknown: 0 };
  const count = (c: Check) => {
    totals[c.status]++;
    return c;
  };

  /** A line of the story against the game's texts (the room's first, then all). */
  const lineCheck = (l: CoverLine, roomId?: string): Check => {
    const what = `${l.who}: ${l.text}`;
    if (l.who !== 'hero' && l.who !== 'action' && l.who !== 'stage' && !game.characters[l.who])
      return count({ what, status: 'missing', detail: `no character "${l.who}"` });
    if (l.who === 'action' || l.who === 'stage' || !l.text.trim())
      return count({ what, status: 'unknown', detail: 'a stage direction' });
    const n = norm(l.text);
    if (!n) return count({ what, status: 'unknown' });
    const pool = roomId
      ? [
          ...texts.filter((t) => t.path.startsWith(`room:${roomId}/`)),
          ...texts.filter((t) => !t.path.startsWith(`room:${roomId}/`)),
        ]
      : texts;
    const exact = pool.find((t) => t.n === n);
    if (exact) return count({ what, status: 'ok', path: exact.path });
    let best: { path: string; score: number } | null = null;
    const long = (x: string) => x.length >= 12 && x.split(' ').length >= 3;
    for (const t of pool) {
      const s = long(t.n) && long(n) && (t.n.includes(n) || n.includes(t.n)) ? 0.8 : alike(t.text, l.text);
      if (!best || s > best.score) best = { path: t.path, score: s };
    }
    if (best && best.score >= 0.5) return count({ what, status: 'partial', detail: 'a close line', path: best.path });
    return count({ what, status: 'missing', detail: 'no such line in the game' });
  };

  /** The character ids standing in a room (actor instances and their characters). */
  const instancesOf = (room: RoomDef | undefined, char: string): string[] =>
    Object.entries(room?.actors ?? {})
      .filter(([id, a]) => a.char === char || id === char)
      .map(([id]) => id);

  /** "Open Grandpa's armchair", "Use pipe with tank", "Give token to seller": a verb of the game and the things named. */
  const actionCheck = (text: string, room: RoomDef | undefined): Check => {
    const what = text;
    // "Talk to Lou: Where is the key?": the part after the colon is a topic (or the hug of `globalTalk`).
    const colon = text.indexOf(':');
    const topic = colon > 0 ? text.slice(colon + 1).trim() : '';
    const t = norm((colon > 0 ? text.slice(0, colon) : text).replace(/→.*$/, '').replace(/\s*\/\s*\w+/, ''));
    if (!t) return count({ what, status: 'unknown' });
    const verbs = [...game.verbs].sort((a, b) => b.label.length - a.label.length);
    const verb = verbs.find((v) => t === norm(v.label) || t.startsWith(norm(v.label) + ' '));
    if (!verb) return count({ what, status: 'unknown', detail: 'no verb of the game at the start' });
    const rest = t.slice(norm(verb.label).length).trim();
    const join = verb.join ? norm(verb.join) : '';
    const seps = [...new Set([join, 'with', 'on', 'to', 'at', 'into'].filter(Boolean))];
    let a = rest,
      b: string | undefined;
    for (const s of seps) {
      const i = rest.indexOf(` ${s} `);
      if (i > 0) {
        a = rest.slice(0, i).trim();
        b = rest.slice(i + s.length + 2).trim();
        break;
      }
    }
    const wild = (p: string) => /^(anything|everything|any (item|thing|object)|an item|something)$/.test(p);
    const named = (phrase: string, preferItem: boolean): { id: string; kind: string } | null => {
      const p = norm(phrase).replace(/^(the|a|an|my|his|her|their|grandma's|grandpa's)\s+/, '');
      const cands: { id: string; name: string; kind: string }[] = [];
      if (preferItem) for (const [id, x] of Object.entries(game.items)) cands.push({ id, name: x.name, kind: 'item' });
      for (const [id, x] of Object.entries(room?.hotspots ?? {})) cands.push({ id, name: x.name, kind: 'hotspot' });
      for (const [id, x] of Object.entries(room?.props ?? {}))
        if (x.name) cands.push({ id, name: x.name, kind: 'prop' });
      for (const [id, x] of Object.entries(room?.actors ?? {}))
        cands.push({ id, name: x.name ?? game.characters[x.char]?.name ?? id, kind: 'actor' });
      if (!preferItem) for (const [id, x] of Object.entries(game.items)) cands.push({ id, name: x.name, kind: 'item' });
      for (const [id, x] of Object.entries(game.characters))
        if (!cands.some((c) => c.kind === 'actor' && (c.id === id || room?.actors?.[c.id]?.char === id)))
          cands.push({ id, name: x.name, kind: 'character' });
      const exact = cands.find((c) => norm(c.name) === p || c.id === p || norm(c.id) === p);
      if (exact) return exact;
      const inside = cands
        .filter((c) => p.includes(norm(c.name)) || norm(c.name).includes(p) || p.split(' ').includes(c.id))
        .sort((x, y) => y.name.length - x.name.length);
      if (inside.length) return inside[0];
      // "the garden window" and "big window": the head noun decides
      const head = p.split(' ').at(-1)!;
      const byHead = cands.filter((c) => norm(c.name).split(' ').at(-1) === head || c.id === head);
      if (byHead.length === 1) return byHead[0];
      let best: { c: (typeof cands)[0]; s: number } | null = null;
      for (const c of cands) {
        const s = alike(c.name, p);
        if (!best || s > best.s) best = { c, s };
      }
      return best && best.s >= 0.5 ? best.c : null;
    };
    const anyA = wild(a),
      anyB = !!b && wild(b);
    const A = anyA ? null : named(a, !!b),
      B = b && !anyB ? named(b, false) : null;
    if ((!A && !anyA) || (b && !B && !anyB))
      return count({
        what,
        status: 'missing',
        detail: `nothing named "${!A && !anyA ? a : b}" in ${room?.id ?? 'the game'}`,
      });
    const ids: [string | undefined, string | undefined] =
      B && A ? (A.kind === 'item' || B.kind !== 'item' ? [A.id, B.id] : [B.id, A.id]) : [A?.id, B?.id];
    const has = (x: Id | Id[] | undefined, v: Id | undefined) =>
      x === undefined ? v === undefined : v !== undefined && asList(x).includes(v);
    const kindsOf = (id: string | undefined) =>
      id === undefined
        ? []
        : room?.actors?.[id]
          ? (game.characters[room.actors[id].char]?.kind ?? [])
          : (room?.props?.[id]?.kind ?? room?.hotspots?.[id]?.kind ?? game.items[id]?.kind ?? []);
    if (verb.id === 'talk' && topic) {
      const hug = game.globalTalk?.hug;
      if (hug && norm(hug) === norm(topic)) return count({ what, status: 'ok', path: 'globalTalk.hug' });
      const insts = ids[0] ? [ids[0], ...instancesOf(room, ids[0])] : [];
      const gameTopics = insts.flatMap((inst) =>
        (room?.talk?.[inst] ?? []).map((x, i) => ({
          path: `room:${room!.id}/talk.${inst}[${i}].topic`,
          text: x.topic,
        })),
      );
      const exact = gameTopics.find((x) => norm(x.text) === norm(topic));
      if (exact) return count({ what, status: 'ok', path: exact.path });
      const close = gameTopics.map((x) => ({ x, s: alike(x.text, topic) })).sort((p, q) => q.s - p.s)[0];
      return count(
        close && close.s >= 0.5
          ? { what, status: 'partial', detail: 'a close topic', path: close.x.path }
          : { what, status: 'missing', detail: `no such topic for ${ids[0]} in ${room?.id ?? 'this room'}` },
      );
    }
    if (!anyA && !anyB) {
      const lists: [Rule[], string][] = [
        [room?.on ?? [], `room:${room?.id}/on`],
        [game.rules.on ?? [], 'rules/on'],
      ];
      for (const [rules, prefix] of lists) {
        const i = rules.findIndex(
          (r) =>
            asList(r.verb).includes(verb.id as VerbId) &&
            ((has(r.a, ids[0]) && has(r.b, ids[1])) || (!!ids[1] && has(r.a, ids[1]) && has(r.b, ids[0]))),
        );
        if (i >= 0) return count({ what, status: 'ok', path: `${prefix}[${i}]` });
      }
    }
    // A reaction by kind ("never pull a cat", "use anything on Biscuit") answers it too.
    const target = ids[1] ?? ids[0];
    const kinds = kindsOf(target);
    const ki = (game.rules.kinds ?? []).findIndex(
      (k) =>
        asList(k.verb).includes(verb.id as VerbId) &&
        (k.target === target || (!k.target && !!k.kind && kinds.includes(k.kind))) &&
        (k.item === undefined || anyA || (ids[1] !== undefined && asList(k.item).includes(ids[0]!))),
    );
    if (ki >= 0) return count({ what, status: 'ok', path: `rules/kinds[${ki}]` });
    if (
      verb.id === 'talk' &&
      !ids[1] &&
      ids[0] &&
      room?.talk &&
      (room.talk[ids[0]] || instancesOf(room, ids[0]).some((x) => room.talk![x]))
    )
      return count({ what, status: 'ok', path: `room:${room.id}/talk.${ids[0]}` });
    if (verb.id === 'look' && !ids[1] && ids[0] && (room?.look?.[ids[0]] || game.items[ids[0]]?.look))
      return count({
        what,
        status: 'ok',
        path: room?.look?.[ids[0]] ? `room:${room.id}/look.${ids[0]}` : `items.${ids[0]}.look`,
      });
    const named1 = A ? `${A.kind} ${A.id}` : 'anything';
    return count({
      what,
      status: 'partial',
      detail: `${named1}${b ? ` and ${B ? `${B.kind} ${B.id}` : 'anything'}` : ''} exist, no rule answers ${verb.label}`,
    });
  };

  const boards = sb.boards.map((b): BoardCoverage => {
    const room = b.room ? rooms.get(b.room) : undefined;
    const roomCheck: Check | undefined = b.room
      ? count({ what: b.room, status: room ? 'ok' : 'missing', detail: room ? undefined : 'no such room' })
      : undefined;
    const arrival = (b.arrival ?? []).map((l) => lineCheck(l, room?.id));
    const hints = (b.hints ?? []).map((t) => {
      const what = t;
      const n = norm(t);
      const pool = (room?.hints ?? []).flatMap((hd, i) =>
        hd.lines.map((l, j) => ({
          path: `room:${room!.id}/${hd.id ? `hints.${hd.id}` : `hints[${i}]`}.lines${listPathSeg(j, l)}`,
          n: norm(listText(l)),
          text: listText(l),
        })),
      );
      const exact = pool.find((x) => x.n === n);
      if (exact) return count({ what, status: 'ok', path: exact.path });
      const close = pool.find((x) => alike(x.text, t) >= 0.5);
      return count(
        close
          ? { what, status: 'partial', detail: 'a close hint', path: close.path }
          : { what, status: 'missing', detail: room ? 'no such hint in this room' : 'no room' },
      );
    });
    const talks = Object.entries(b.talks ?? {}).map(([char, topics]) => {
      const insts = instancesOf(room, char);
      const actor: Check = !game.characters[char]
        ? count({ what: char, status: 'missing', detail: 'no such character' })
        : !room
          ? count({ what: char, status: 'unknown', detail: 'no room on the board' })
          : !insts.length
            ? count({ what: char, status: 'partial', detail: `${char} is not in ${room.id}` })
            : count({ what: char, status: 'ok', path: `room:${room.id}/talk.${insts[0]}` });
      const gameTopics = insts.flatMap((inst) =>
        (room?.talk?.[inst] ?? []).map((t, i) => ({
          path: `room:${room!.id}/talk.${inst}[${i}].topic`,
          text: t.topic,
          n: norm(t.topic),
        })),
      );
      const tChecks = topics.map((t): Check => {
        const n = norm(t.topic);
        if (game.globalTalk?.hug && norm(game.globalTalk.hug) === n)
          return count({ what: t.topic, status: 'ok', path: 'globalTalk.hug' });
        const exact = gameTopics.find((x) => x.n === n);
        if (exact) return count({ what: t.topic, status: 'ok', path: exact.path });
        const close = gameTopics.map((x) => ({ x, s: alike(x.text, t.topic) })).sort((p, q) => q.s - p.s)[0];
        return count(
          close && close.s >= 0.5
            ? { what: t.topic, status: 'partial', detail: 'a close topic', path: close.x.path }
            : {
                what: t.topic,
                status: 'missing',
                detail: insts.length
                  ? `no such topic for ${char} in ${room!.id}`
                  : `${char} has no topics in ${room?.id ?? 'this room'}`,
              },
        );
      });
      return { actor, topics: tChecks };
    });
    const reactions = (b.reactions ?? []).map((r) => actionCheck(r.action, room));
    const panels = b.panels.map((p): PanelCoverage => {
      const action = p.action ? actionCheck(p.action, room) : undefined;
      const lines = (p.lines ?? []).map((l) => lineCheck(l, room?.id));
      const sfx = (p.sfx ?? []).map((s) =>
        count({
          what: s,
          status: sfxIds.has(s) ? 'ok' : 'missing',
          detail: sfxIds.has(s) ? undefined : 'not in audio.sfx',
        }),
      );
      const all = [...(action ? [action] : []), ...lines, ...sfx];
      return {
        id: p.id,
        title: p.title,
        action,
        lines,
        sfx,
        status: worst(all.map((c) => c.status)),
        score: scoreOf(all),
      };
    });
    const all = [
      ...(roomCheck ? [roomCheck] : []),
      ...arrival,
      ...hints,
      ...talks.flatMap((t) => [t.actor, ...t.topics]),
      ...reactions,
      ...panels.flatMap((p) => [...(p.action ? [p.action] : []), ...p.lines, ...p.sfx]),
    ];
    return {
      id: b.id,
      title: b.title,
      room: roomCheck,
      arrival,
      hints,
      talks,
      reactions,
      panels,
      status: worst(all.map((c) => c.status)),
      score: scoreOf(all),
    };
  });
  const counted = totals.ok + totals.partial + totals.missing;
  return { boards, totals, score: counted ? totals.ok / counted : 1 };
}

const mark: Record<CoverStatus, string> = { ok: '✓', partial: '~', missing: '✗', unknown: '?' };

/** The coverage as Markdown: a line per check that is not ok, the score per board. */
export function coverageMarkdown(c: Coverage): string {
  const out = [
    `# Storyboard coverage: ${Math.round(c.score * 100)}%`,
    '',
    `${c.totals.ok} implemented · ${c.totals.partial} partial · ${c.totals.missing} missing · ${c.totals.unknown} not checked (stage directions, prose)`,
    '',
  ];
  const line = (x: Check, pad = '  ') =>
    `${pad}- ${mark[x.status]} ${x.what}${x.detail ? ` — ${x.detail}` : ''}${x.path && x.status !== 'ok' ? ` (${x.path})` : ''}`;
  for (const b of c.boards) {
    out.push(
      `## ${mark[b.status]} ${b.title} (${Math.round(b.score * 100)}%)${b.room ? ` — room ${b.room.what}${b.room.status === 'ok' ? '' : ': missing'}` : ''}`,
      '',
    );
    const bad = (list: Check[]) => list.filter((x) => x.status !== 'ok' && x.status !== 'unknown');
    for (const x of bad(b.arrival)) out.push(line(x, '  arrival '));
    for (const x of bad(b.hints)) out.push(line(x, '  hint '));
    for (const t of b.talks) {
      if (t.actor.status !== 'ok') out.push(line(t.actor, '  talk '));
      for (const x of bad(t.topics)) out.push(line(x, '  topic '));
    }
    for (const x of bad(b.reactions)) out.push(line(x, '  reaction '));
    for (const p of b.panels) {
      const items = [...(p.action ? [p.action] : []), ...p.lines, ...p.sfx];
      out.push(
        `- ${mark[p.status]} **${p.id}** ${p.title}${p.status === 'ok' ? '' : ` (${Math.round(p.score * 100)}%)`}`,
      );
      for (const x of bad(items)) out.push(line(x, '    '));
    }
    out.push('');
  }
  return out.join('\n');
}
