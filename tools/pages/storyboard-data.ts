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

/** Normalises a parsed storyboard.json (tolerates a few aliases: `talk`, `optional`, talk lists, `{ q, answer }`). */
export function normalizeStoryboard(raw: any): Storyboard {
  const lines = (v: any): SbLine[] =>
    (Array.isArray(v) ? v : []).map((l: any) =>
      Array.isArray(l)
        ? { who: String(l[0]), text: String(l[1] ?? '') }
        : typeof l === 'string'
          ? { who: 'hero', text: l }
          : { who: String(l.who ?? 'hero'), text: String(l.text ?? '') },
    );
  const topics = (v: any): SbTopic[] =>
    (Array.isArray(v) ? v : []).map((t: any) => ({
      topic: String(t.topic ?? t.q ?? ''),
      lines: lines(t.lines ?? t.answer ?? t.do),
    }));
  return {
    title: raw?.title,
    intro: raw?.intro,
    boards: (raw?.boards ?? []).map((b: any): SbBoard => {
      let talks: Record<string, SbTopic[]> | undefined;
      const t = b.talks ?? b.talk;
      if (Array.isArray(t)) talks = Object.fromEntries(t.map((x: any) => [String(x.who ?? x.actor), topics(x.topics)]));
      else if (t && typeof t === 'object')
        talks = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, topics(v)]));
      return {
        id: String(b.id),
        title: String(b.title ?? b.id),
        room: b.room,
        goal: b.goal,
        music: b.music,
        exit: b.exit,
        arrival: b.arrival ? lines(b.arrival) : undefined,
        panels: (b.panels ?? []).map((p: any) => ({
          id: String(p.id),
          title: String(p.title ?? p.id),
          action: p.action,
          lines: lines(p.lines),
          sfx: p.sfx,
        })),
        hints: b.hints,
        talks,
        reactions: (b.reactions ?? b.optional)?.map((r: any) => ({
          action: String(r.action ?? r[0] ?? ''),
          lines: lines(r.lines ?? (r[1] ? [{ who: 'hero', text: r[1] }] : [])),
        })),
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
