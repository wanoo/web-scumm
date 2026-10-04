// Content profiler: not CPU, game design. What each room, item and character amounts to, so an author (or an AI) sees
// at a glance what is thin: hotspots with no look line, verbs that only get fallbacks, props that never change, items
// obtained but never used, characters with unreachable topics, long lines. Pure: runs in node and in the Studio.
import { asLines, listText } from '../core/list-lines';
import type { Cmd, Cond, GameDef, Id, Layout, RoomDef } from '../core/types';
import { eachCmd, someCmd } from '../core/cmds';
import { normalizeExits } from '../core/define';
import { worldGraph } from './graph';
import { localeStatus } from './i18n';

export interface RoomReport {
  id: Id; name: string;
  hotspots: number; props: number; actors: number; exits: number;
  noLook: Id[];
  /** Verbs no rule of the room uses (the fallback answers every time). */
  verbsUnused: string[];
  rules: number; topics: number; hints: number; scripts: number; events: number;
  /** Props with states that no command of the game changes. */
  propsNeverChanged: Id[];
  longLines: number;
}
export interface ItemReport { id: Id; name: string; gainedIn: string[]; usedIn: number; consumed: boolean }
export interface CharacterReport { id: Id; name: string; rooms: Id[]; topics: number; lines: number; longLines: number; unreachableTopics: string[] }
export interface ContentReport {
  rooms: RoomReport[];
  items: ItemReport[];
  characters: CharacterReport[];
  world: { unreachable: Id[]; oneWay: string[] };
  /** Translation coverage per language (`locales` given). */
  locales?: { lang: string; total: number; translated: number; missing: number; stale: number; long: number }[];
  totals: { rooms: number; items: number; characters: number; rules: number; lines: number; words: number };
}

const asList = <T>(x: T | T[] | undefined): T[] => x === undefined ? [] : Array.isArray(x) ? x : [x];

/** Every text line said anywhere in a command list, with its speaker. */
function lines(cmds: unknown, out: { who: string; text: string }[]) {
  eachCmd(cmds as Cmd[], (c) => {
    if (typeof c === 'string') { out.push({ who: 'hero', text: c }); return; }
    if ('say' in c) out.push({ who: String(c.say[0]), text: c.say[1] });
    else if ('choice' in c) c.choice.forEach((x) => out.push({ who: 'hero', text: x.text }));
    else if ('guide' in c) out.push({ who: 'hero', text: c.guide.say });
  });
}

/** Does any command of the list (deep) satisfy the test? */
const has = (cmds: unknown, test: (o: Record<string, unknown>) => boolean) => someCmd(cmds as Cmd[], (c) => test(c as Record<string, unknown>));

/** All the command lists of a room (rules, topics, hints excluded, onEnter, scripts, events). */
function roomCmds(r: RoomDef): unknown[][] {
  return [r.onEnter ?? [], ...(r.on ?? []).map((x) => x.do), ...Object.values(r.talk ?? {}).flat().map((t) => t.do),
    ...(r.scripts ?? []).map((s) => s.do), ...(r.events ?? []).map((e) => e.do)];
}

export function report(gameIn: GameDef, _layouts: Record<string, Layout> = {}, opts: { maxText?: number; locales?: Record<string, Record<string, string>> } = {}): ContentReport {
  const game = normalizeExits(structuredClone(gameIn));
  const maxText = opts.maxText ?? 140;
  const allCmds: unknown[][] = [game.start.intro ?? [], ...(game.rules.on ?? []).map((x) => x.do), ...(game.scripts ?? []).map((s) => s.do), ...(game.events ?? []).map((e) => e.do)];
  for (const r of game.rooms) allCmds.push(...roomCmds(r));
  const verbs = game.verbs.map((v) => v.id);

  const rooms: RoomReport[] = game.rooms.map((r) => {
    const named = [...Object.keys(r.hotspots ?? {}), ...Object.entries(r.props ?? {}).filter(([, p]) => p.name).map(([k]) => k), ...Object.entries(r.actors ?? {}).filter(([, a]) => a.interactive !== false).map(([k]) => k)];
    const noLook = named.filter((id) => !r.look?.[id] && !(r.on ?? []).some((x) => asList(x.verb).includes('look') && asList(x.a).includes(id)));
    const used = new Set<string>();
    for (const rule of r.on ?? []) asList(rule.verb).forEach((v) => used.add(v));
    if (r.talk && Object.keys(r.talk).length) used.add('talk');
    if (r.look && Object.keys(r.look).length) used.add('look');
    const propsNeverChanged = Object.entries(r.props ?? {}).filter(([id, p]) => p.states && Object.keys(p.states).length > 1 &&
      !allCmds.some((l) => has(l, (o) => Array.isArray(o.prop) && (o.prop[0] === id || o.prop[0] === `${r.id}.${id}`)))).map(([id]) => id);
    const ls: { who: string; text: string }[] = [];
    roomCmds(r).forEach((l) => lines(l, ls));
    Object.values(r.look ?? {}).forEach((t) => asLines(t).forEach((x) => ls.push({ who: 'hero', text: listText(x) })));
    return {
      id: r.id, name: r.name,
      hotspots: Object.values(r.hotspots ?? {}).filter((h) => !h.exit).length, props: Object.keys(r.props ?? {}).length,
      actors: Object.keys(r.actors ?? {}).length, exits: Object.keys(r.exits ?? {}).length,
      noLook, verbsUnused: verbs.filter((v) => !used.has(v) && !['give', 'use'].includes(v)),
      rules: (r.on ?? []).filter((x) => !x.exit).length, topics: Object.values(r.talk ?? {}).reduce((n, t) => n + t.length, 0), hints: (r.hints ?? []).length,
      scripts: (r.scripts ?? []).length, events: (r.events ?? []).length,
      propsNeverChanged, longLines: ls.filter((x) => x.text.length > maxText).length,
    };
  });

  const items: ItemReport[] = Object.entries(game.items).map(([id, it]) => {
    const gainedIn: string[] = [];
    if (game.start.inventory?.includes(id)) gainedIn.push('start');
    for (const r of game.rooms) if (roomCmds(r).some((l) => has(l, (o) => o.gain === id))) gainedIn.push(r.id);
    if ([game.start.intro ?? [], ...(game.rules.on ?? []).map((x) => x.do)].some((l) => has(l, (o) => o.gain === id))) gainedIn.push('game');
    let usedIn = 0;
    for (const list of [...game.rooms.map((r) => r.on ?? []), game.rules.on ?? []]) for (const rule of list) if (asList(rule.a).includes(id) || asList(rule.b).includes(id)) usedIn++;
    const consumed = allCmds.some((l) => has(l, (o) => o.lose === id || o.used === id || (Array.isArray(o.used) && o.used.includes(id))));
    return { id, name: it.name, gainedIn, usedIn, consumed };
  });

  const characters: CharacterReport[] = Object.entries(game.characters).map(([id, c]) => {
    const inRooms = game.rooms.filter((r) => Object.values(r.actors ?? {}).some((a) => a.char === id)).map((r) => r.id);
    let topics = 0;
    const unreachable: string[] = [];
    for (const r of game.rooms) for (const [actor, ts] of Object.entries(r.talk ?? {})) {
      if (r.actors?.[actor]?.char !== id) continue;
      topics += ts.length;
      for (const t of ts) if (t.if && neverTrue(t.if, game)) unreachable.push(`${r.id}: ${t.topic}`);
    }
    const ls: { who: string; text: string }[] = [];
    allCmds.forEach((l) => lines(l, ls));
    const mine = ls.filter((x) => x.who === id);
    return { id, name: c.name, rooms: inRooms, topics, lines: mine.length, longLines: mine.filter((x) => x.text.length > maxText).length, unreachableTopics: unreachable };
  });

  const all: { who: string; text: string }[] = [];
  allCmds.forEach((l) => lines(l, all));
  for (const r of game.rooms) Object.values(r.look ?? {}).forEach((t) => asLines(t).forEach((x) => all.push({ who: 'hero', text: listText(x) })));
  const g = worldGraph(gameIn);
  return {
    rooms, items, characters,
    world: { unreachable: g.unreachable, oneWay: g.oneWay.map((e) => `${e.from} → ${e.to} (${e.via})`) },
    locales: opts.locales && Object.keys(opts.locales).length ? Object.entries(opts.locales).map(([lang, table]) => {
      const st = localeStatus(gameIn, table, maxText);
      return { lang, total: st.total, translated: st.translated, missing: st.missing.length, stale: st.stale.length, long: st.long.length };
    }) : undefined,
    totals: { rooms: game.rooms.length, items: items.length, characters: characters.length,
      rules: game.rooms.reduce((n, r) => n + (r.on ?? []).filter((x) => !x.exit).length, 0) + (game.rules.on ?? []).length,
      lines: all.length, words: all.reduce((n, x) => n + x.text.split(/\s+/).filter(Boolean).length, 0) },
  };
}

/** A topic condition that reads a flag nothing sets (so it can never be true). Cheap static check. */
function neverTrue(c: Cond, game: GameDef): boolean {
  if (typeof c !== 'string' || c.startsWith('!')) return false;
  const json = JSON.stringify(game);
  return !new RegExp(`"set":"${c}"|"set":\\["${c}"|"inc":"${c}"|"flags":\\{[^}]*"${c}"`).test(json);
}

/** The report as Markdown, for the terminal, the Studio and the AI tools. */
export function reportMarkdown(r: ContentReport): string {
  const out: string[] = [];
  out.push(`# Content report`, '', `${r.totals.rooms} rooms · ${r.totals.items} items · ${r.totals.characters} characters · ${r.totals.rules} rules · ${r.totals.lines} lines (${r.totals.words} words)`, '');
  if (r.world.unreachable.length) out.push(`**Unreachable rooms:** ${r.world.unreachable.join(', ')}`, '');
  if (r.world.oneWay.length) out.push(`**Exits with no way back:** ${r.world.oneWay.join('; ')}`, '');
  if (r.locales?.length) out.push(`**Translations:** ${r.locales.map((l) => `${l.lang} ${l.translated}/${l.total}${l.missing ? ` (${l.missing} missing)` : ''}${l.stale ? ` (${l.stale} stale)` : ''}`).join(' · ')}`, '');
  out.push('## Rooms', '', '| Room | zones | props | actors | exits | rules | topics | hints | scripts | notes |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const x of r.rooms) {
    const notes: string[] = [];
    if (x.noLook.length) notes.push(`no look: ${x.noLook.join(', ')}`);
    if (x.verbsUnused.length) notes.push(`fallback only: ${x.verbsUnused.join(', ')}`);
    if (x.propsNeverChanged.length) notes.push(`never change: ${x.propsNeverChanged.join(', ')}`);
    if (x.longLines) notes.push(`${x.longLines} long line(s)`);
    out.push(`| ${x.name} (${x.id}) | ${x.hotspots} | ${x.props} | ${x.actors} | ${x.exits} | ${x.rules} | ${x.topics} | ${x.hints} | ${x.scripts}+${x.events}ev | ${notes.join(' · ') || '—'} |`);
  }
  out.push('', '## Items', '', '| Item | obtained in | rules using it | consumed |', '|---|---|---|---|');
  for (const x of r.items) out.push(`| ${x.name} (${x.id}) | ${x.gainedIn.join(', ') || '**never**'} | ${x.usedIn || '**0**'} | ${x.consumed ? 'yes' : 'no'} |`);
  out.push('', '## Characters', '', '| Character | rooms | topics | lines | notes |', '|---|---|---|---|---|');
  for (const x of r.characters) {
    const notes: string[] = [];
    if (x.unreachableTopics.length) notes.push(`unreachable: ${x.unreachableTopics.join('; ')}`);
    if (x.longLines) notes.push(`${x.longLines} long line(s)`);
    out.push(`| ${x.name} (${x.id}) | ${x.rooms.join(', ') || '—'} | ${x.topics} | ${x.lines} | ${notes.join(' · ') || '—'} |`);
  }
  return out.join('\n') + '\n';
}
