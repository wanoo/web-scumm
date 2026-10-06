// The storyboard's schema (storyboard-schema.md), its normalisation and its Markdown export. Pure (no Node API): used
// by the storyboard page (storyboard.ts), the Studio core (POST storyboard/markdown) and the Studio UI.
import type { GameDef } from '../../src/engine/core/types';

export interface SbLine {
  who: string;
  text: string;
}
export interface SbPanel {
  id: string;
  title: string;
  action?: string;
  lines?: SbLine[];
  sfx?: string[];
}
export interface SbTopic {
  topic: string;
  lines?: SbLine[];
}
export interface SbReaction {
  action: string;
  lines?: SbLine[];
}
export interface SbBoard {
  id: string;
  title: string;
  room?: string;
  goal?: string;
  music?: string;
  arrival?: SbLine[];
  panels: SbPanel[];
  hints?: string[];
  /** Talk topics per character id. */
  talks?: Record<string, SbTopic[]>;
  /** Optional reactions (not needed to finish the game). */
  reactions?: SbReaction[];
  exit?: string;
}
export interface Storyboard {
  title?: string;
  intro?: string;
  boards: SbBoard[];
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const field = (v: unknown, k: string): unknown => (isObj(v) ? v[k] : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Lines in their canonical `{ who, text }` form; accepts `[who, text]` and bare strings (4.1.0: one normalisation for
 * the page, the Studio and the MCP). `keep`: the other fields of an object line stay (the Studio edits them in place).
 */
export function sbLines(v: unknown, keep = false): SbLine[] {
  return list(v).map((l) =>
    Array.isArray(l)
      ? { who: String(l[0]), text: String(l[1] ?? '') }
      : typeof l === 'string'
        ? { who: 'hero', text: l }
        : {
            ...(keep && isObj(l) ? l : {}),
            who: String(field(l, 'who') ?? 'hero'),
            text: String(field(l, 'text') ?? ''),
          },
  );
}

/** Talk topics: `{ topic, lines }`, also `{ q, answer }` and `do` for the lines. `keep`: other fields stay. */
export function sbTopics(v: unknown, keep = false): SbTopic[] {
  return list(v).map((t) => {
    const { q, answer, ...rest } = isObj(t) ? t : {};
    return {
      ...(keep ? rest : {}),
      topic: String(field(t, 'topic') ?? q ?? ''),
      lines: sbLines(field(t, 'lines') ?? answer ?? field(t, 'do'), keep),
    };
  });
}

/** Talks per character: a record of topic lists, or a list of `{ who | actor, topics }`. */
export function sbTalks(v: unknown, keep = false): Record<string, SbTopic[]> | undefined {
  if (Array.isArray(v))
    return Object.fromEntries(
      v.map((x) => [String(field(x, 'who') ?? field(x, 'actor')), sbTopics(field(x, 'topics'), keep)]),
    );
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, t]) => [k, sbTopics(t, keep)]));
  return undefined;
}

/** Optional reactions: `{ action, lines }` or `[action, text]`. `keep`: other fields stay. */
export function sbReactions(v: unknown, keep = false): SbReaction[] {
  return list(v).map((r) =>
    Array.isArray(r)
      ? { action: String(r[0] ?? ''), lines: r[1] ? [{ who: 'hero', text: String(r[1]) }] : [] }
      : {
          ...(keep && isObj(r) ? r : {}),
          action: String(field(r, 'action') ?? ''),
          lines: sbLines(field(r, 'lines'), keep),
        },
  );
}

/**
 * What makes a storyboard.json unreadable, one sentence each, the same wherever it is read or written (4.1.0: the
 * page generator, the Studio's server and its demo, the MCP's `set_storyboard`). Empty: it can be normalised.
 */
export function storyboardProblems(raw: unknown): string[] {
  if (!isObj(raw) || !Array.isArray(raw.boards)) return ['a storyboard is an object with a `boards` list'];
  const out: string[] = [];
  const lineProblems = (where: string, v: unknown) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) return void out.push(`${where}: a list of lines`);
    v.forEach((l, k) => {
      if (!(typeof l === 'string' || Array.isArray(l) || isObj(l)))
        out.push(`${where}[${k}]: a line is "text", [who, text] or { who, text }`);
    });
  };
  raw.boards.forEach((b, i) => {
    const at = `boards[${i}]`;
    if (!isObj(b)) return void out.push(`${at}: a board is an object`);
    if (typeof b.id !== 'string' && typeof b.id !== 'number') out.push(`${at}: no \`id\``);
    if (b.panels !== undefined && !Array.isArray(b.panels)) out.push(`${at}.panels: a list of panels`);
    list(b.panels).forEach((p, j) => {
      if (!isObj(p)) out.push(`${at}.panels[${j}]: a panel is an object`);
      else lineProblems(`${at}.panels[${j}].lines`, p.lines);
    });
    lineProblems(`${at}.arrival`, b.arrival);
  });
  return out;
}

/** Normalises a parsed storyboard.json (tolerates a few aliases: `talk`, `optional`, talk lists, `{ q, answer }`). */
export function normalizeStoryboard(raw: unknown): Storyboard {
  return {
    title: field(raw, 'title') as string | undefined,
    intro: field(raw, 'intro') as string | undefined,
    boards: list(field(raw, 'boards')).map((b): SbBoard => {
      const g = (k: string) => field(b, k);
      return {
        id: String(g('id')),
        title: String(g('title') ?? g('id')),
        room: g('room') as string | undefined,
        goal: g('goal') as string | undefined,
        music: g('music') as string | undefined,
        exit: g('exit') as string | undefined,
        arrival: g('arrival') ? sbLines(g('arrival')) : undefined,
        panels: list(g('panels')).map((p) => ({
          // A panel without an id or a title has empty ones, as in the Studio (4.1.0).
          id: String(field(p, 'id') ?? ''),
          title: String(field(p, 'title') ?? field(p, 'id') ?? ''),
          action: field(p, 'action') as string | undefined,
          lines: sbLines(field(p, 'lines')),
          sfx: field(p, 'sfx') as string[] | undefined,
        })),
        hints: g('hints') as string[] | undefined,
        talks: sbTalks(g('talks') ?? g('talk')),
        reactions: (g('reactions') ?? g('optional')) ? sbReactions(g('reactions') ?? g('optional')) : undefined,
      };
    }),
  };
}

/** What the Markdown export needs from the game. */
export type SbGame = Pick<GameDef, 'title' | 'hero' | 'rooms' | 'characters'>;

/** A speaker's display name (`hero` is the game's hero; unknown ids are shown as they are). */
export function speakerName(game: SbGame, who: string): string {
  const id = who === 'hero' ? game.hero : who;
  return game.characters[id]?.name ?? who;
}

/** The plain-text storyboard (games/<id>/storyboard.md) that sub-agents and reviewers read. */
export function storyboardMarkdown(ctx: { game: SbGame }, sb: Storyboard): string {
  const g = ctx.game;
  const who = (w: string) => (w === 'action' ? 'ACTION' : w === 'stage' ? 'STAGE' : speakerName(g, w).toUpperCase());
  const ln = (l: SbLine, pad = '') => `${pad}- ${who(l.who)}: ${l.text}`;
  const md = [
    `# ${sb.title ?? g.title}: storyboard`,
    '',
    "Generated from `storyboard.json` by `npm run page:storyboard -- --md` (or the Studio's Export Markdown). Do not edit: edit the JSON.",
    '',
    'Legend: ACTION = what the player does; STAGE = stage direction; otherwise NAME: line.',
    '',
  ];
  if (sb.intro) md.push(sb.intro, '');
  sb.boards.forEach((b, i) => {
    const room = g.rooms.find((r) => r.id === b.room);
    md.push(`## ${i + 1}. ${b.title}`, `*Room: ${b.room ? `${room?.name ?? '?'} (\`${b.room}\`)` : 'none'}*`, '');
    if (b.goal) md.push(`**Goal:** ${b.goal}`, '');
    if (b.music) md.push(`**Music:** ${b.music}`, '');
    if (b.arrival?.length) md.push('**On arrival:**', ...b.arrival.map((l) => ln(l)), '');
    for (const p of b.panels) {
      md.push(`### ${p.id} · ${p.title}`);
      if (p.action) md.push(`- ACTION: ${p.action}`);
      md.push(...(p.lines ?? []).map((l) => ln(l)));
      if (p.sfx?.length) md.push(`- SFX: ${p.sfx.join(', ')}`);
      md.push('');
    }
    if (b.talks && Object.keys(b.talks).length) {
      md.push('**Talk topics:**');
      for (const [c, ts] of Object.entries(b.talks)) {
        md.push(`- *${speakerName(g, c)}*`);
        for (const t of ts) md.push(`  - "${t.topic}"`, ...(t.lines ?? []).map((l) => ln(l, '    ')));
      }
      md.push('');
    }
    if (b.reactions?.length) {
      md.push('**Optional reactions:**');
      for (const r of b.reactions) md.push(`- ${r.action}`, ...(r.lines ?? []).map((l) => ln(l, '  ')));
      md.push('');
    }
    if (b.hints?.length) md.push('**Hints (vague to precise):**', ...b.hints.map((h, k) => `${k + 1}. ${h}`), '');
    if (b.exit) md.push(`**Exit:** ${b.exit}`, '');
    md.push('---', '');
  });
  return md.join('\n');
}
