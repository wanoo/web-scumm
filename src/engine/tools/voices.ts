// Voice production (3.4): the table a studio records from. One row per line with a stable id and per language: who
// speaks, the text in that language, the clip (`audio.voices` for the game's language, `audio.voicesByLang[lang]`
// for the others) and where the line stands (draft, to record, recorded, approved: `games/<id>/voices.json`). CSV or
// JSON out for the actors, back in with their statuses and notes; the clips' facts (duration, loudness, peak, rate,
// codec, measured by `npm run voices -- check` with ffmpeg) judged here. Pure: the command line does the files.
import { lineIds } from '../core/content-ids';
import type { GameDef, Id } from '../core/types';

export type VoiceStatus = 'draft' | 'record' | 'recorded' | 'approved';
export const VOICE_STATUSES: readonly VoiceStatus[] = ['draft', 'record', 'recorded', 'approved'];
/** `voices.json`: per language, per line id, where the line stands. */
export type VoiceSheet = Record<string, Record<Id, { status: VoiceStatus; note?: string; actor?: string }>>;

export interface VoiceRow {
  id: Id;
  who: Id;
  text: string;
  status: VoiceStatus;
  file?: string;
  note?: string;
  actor?: string;
}

/** The clips of a language: `audio.voices` for the game's own, `audio.voicesByLang[lang]` for the others. */
export function clipsOf(game: GameDef, lang: string): Record<Id, string> {
  return lang === (game.lang ?? 'en') ? (game.audio?.voices ?? {}) : (game.audio?.voicesByLang?.[lang] ?? {});
}

/**
 * The table of a language. `localized`: the game with that language applied (`applyLocale`), for the texts; the ids
 * are the same in every language. A line with no status yet is `recorded` when it has a clip, else `draft`.
 */
export function voiceTable(game: GameDef, sheet: VoiceSheet, lang: string, localized: GameDef = game): VoiceRow[] {
  const clips = clipsOf(game, lang),
    s = sheet[lang] ?? {};
  const texts = new Map(lineIds(localized).map((l) => [l.id, l.text]));
  return lineIds(game).map((l) => {
    const row = s[l.id];
    return {
      id: l.id,
      who: l.who,
      text: texts.get(l.id) ?? l.text,
      status: row?.status ?? (clips[l.id] ? 'recorded' : 'draft'),
      ...(clips[l.id] ? { file: clips[l.id] } : {}),
      ...(row?.note ? { note: row.note } : {}),
      ...(row?.actor ? { actor: row.actor } : {}),
    };
  });
}

/** Clips no line claims, in a language. */
export function orphanClips(game: GameDef, lang: string): { id: Id; file: string }[] {
  const ids = new Set(lineIds(game).map((l) => l.id));
  return Object.entries(clipsOf(game, lang))
    .filter(([id]) => !ids.has(id))
    .map(([id, file]) => ({ id, file }));
}

const COLUMNS = ['id', 'who', 'text', 'status', 'file', 'actor', 'note'] as const;
const cell = (v: string | undefined) => (v === undefined ? '' : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: VoiceRow[]): string {
  return (
    [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((k) => cell(r[k] as string | undefined)).join(','))].join('\n') +
    '\n'
  );
}

/** RFC 4180: quoted fields, doubled quotes, line breaks inside quotes. The header names the columns. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    f = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (ch === '"') q = false;
      else f += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(f);
      f = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      f = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else f += ch;
  }
  if (f !== '' || row.length) {
    row.push(f);
    if (row.some((x) => x !== '')) rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** What an actor's table brings back: statuses, actors and notes, for the lines the game has; the others reported. */
export function mergeSheet(
  sheet: VoiceSheet,
  lang: string,
  rows: Record<string, string>[],
  ids: Set<Id>,
): { sheet: VoiceSheet; unknown: string[]; bad: string[] } {
  const out: VoiceSheet = structuredClone(sheet);
  const s = (out[lang] ??= {});
  const unknown: string[] = [],
    bad: string[] = [];
  for (const r of rows) {
    if (!r.id) continue;
    if (!ids.has(r.id)) {
      unknown.push(r.id);
      continue;
    }
    const status = (r.status || 'draft').trim() as VoiceStatus;
    if (!VOICE_STATUSES.includes(status)) {
      bad.push(`${r.id}: unknown status "${r.status}"`);
      continue;
    }
    s[r.id] = {
      status,
      ...(r.note?.trim() ? { note: r.note.trim() } : {}),
      ...(r.actor?.trim() ? { actor: r.actor.trim() } : {}),
    };
  }
  return { sheet: out, unknown, bad };
}

/** What `ffprobe` and `ffmpeg -af ebur128` say about a clip. */
export interface ClipFacts {
  durationMs: number;
  sampleRate: number;
  codec: string;
  lufs?: number;
  peak?: number;
}

/** A voice clip in a release: present when the line is approved, readable, of a plausible length, at a speech level. */
export function clipVerdict(row: VoiceRow, facts: ClipFacts | null): { errors: string[]; warnings: string[] } {
  const errors: string[] = [],
    warnings: string[] = [];
  const at = `${row.id}${row.file ? ` (${row.file})` : ''}`;
  if (!row.file) {
    if (row.status === 'approved') errors.push(`${at}: approved without a clip`);
    else if (row.status === 'recorded') warnings.push(`${at}: recorded, but no clip in audio.voices`);
    return { errors, warnings };
  }
  if (!facts) {
    errors.push(`${at}: the clip cannot be read`);
    return { errors, warnings };
  }
  if (!['mp3', 'vorbis', 'opus', 'aac', 'pcm_s16le', 'flac'].includes(facts.codec))
    errors.push(`${at}: codec ${facts.codec} (mp3, ogg vorbis or opus, aac, wav, flac)`);
  if (facts.sampleRate < 22050) warnings.push(`${at}: ${facts.sampleRate} Hz (22 050 Hz or more for speech)`);
  const reading = Math.max(1500, row.text.length * 70);
  if (facts.durationMs < 300) warnings.push(`${at}: ${facts.durationMs} ms, too short for a line`);
  else if (facts.durationMs > reading * 3)
    warnings.push(
      `${at}: ${(facts.durationMs / 1000).toFixed(1)} s for ${row.text.length} characters (more than three times the reading time)`,
    );
  if (facts.lufs !== undefined && (facts.lufs < -23 || facts.lufs > -12))
    warnings.push(`${at}: ${facts.lufs.toFixed(1)} LUFS (speech: about −16, between −23 and −12)`);
  if (facts.peak !== undefined && facts.peak > -1)
    warnings.push(`${at}: peak ${facts.peak.toFixed(1)} dBFS (keep below −1)`);
  return { errors, warnings };
}
