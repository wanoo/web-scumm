// Playtests: sessions shared from phones (`games/<id>/playtests/*.session.json`, ids and indices only), replayed on
// the real game and summed up: where players spend their time, where they stall (the same action over and over
// without effect), which hints they needed, where they stopped. The heat map is keyed by puzzle-graph node ids, so
// `toPuzzleSvg({ heat })` and the Studio's Check tab show it as they show the solver's heat.
import type { GameDef, Id, Layout, SessionEntry } from '../core/types';
import type { CustomCommands } from '../core/custom';
import { labelOf, replay, type SessionFile } from './replay';

export interface PlaytestFile { name: string; file: SessionFile }

export interface PlaytestSummary {
  name: string;
  /** Inputs in the file: the `start` entry is not one (`played` counts against `entries`). */
  entries: number;
  played: number;
  ended: boolean;
  /** The device family the file says it was played on (3.7.1), when it says. */
  device?: string;
  /** The content changed since the recording: the replay stopped there (counts stop there too). */
  divergedAt?: number;
  divergence?: string;
  /** Play time in ms (pauses longer than `pauseMs` excluded); absent when the file carries no timestamps. */
  durationMs?: number;
  /** Where the player stopped: the last entry. */
  abandon: { room: Id; label: string; index: number };
}

export interface RoomStat { ms: number; entries: number; effective: number; noops: number; hints: number; abandons: number }

export interface Stall { file: string; room: Id; action: string; repeats: number; ms?: number; at: number }

export interface PlaytestReport {
  files: PlaytestSummary[];
  rooms: Record<Id, RoomStat>;
  /** Times each puzzle-graph node (rule, topic, listener, script) ran, plus `room:<id>` per entry. */
  heat: Record<string, number>;
  stalls: Stall[];
  /** `hint:<room>/<i>` → times that hint was given; `hint:<room>/none` when none applied. */
  hints: Record<string, number>;
  minigames: Record<Id, number>;
  aborts: number;
  divergences: number;
  total: { files: number; entries: number; ms: number };
}

export interface PlaytestOptions {
  commands?: CustomCommands;
  /** Consecutive effect-less tries of the same action that count as a stall (default 3). */
  stallRepeats?: number;
  /** A gap longer than this (ms) is a pause, not play time (default 60 s). */
  pauseMs?: number;
}

const actionKey = (en: SessionEntry) => 'act' in en ? `${en.act.verb} ${en.act.a}${en.act.b ? ` ${en.act.b}` : ''}` : null;

export async function analyzePlaytests(game: GameDef, layouts: Record<Id, Layout>, files: PlaytestFile[], opts: PlaytestOptions = {}): Promise<PlaytestReport> {
  const stallRepeats = opts.stallRepeats ?? 3, pauseMs = opts.pauseMs ?? 60000;
  const report: PlaytestReport = { files: [], rooms: {}, heat: {}, stalls: [], hints: {}, minigames: {}, aborts: 0, divergences: 0, total: { files: files.length, entries: 0, ms: 0 } };
  const room = (id: Id): RoomStat => (report.rooms[id] ??= { ms: 0, entries: 0, effective: 0, noops: 0, hints: 0, abandons: 0 });
  const bump = (map: Record<string, number>, key: string, n = 1) => { map[key] = (map[key] ?? 0) + n; };

  for (const { name, file } of files) {
    const log = file.session.log;
    const roomAt: Id[] = [file.session.base?.room ?? game.start.room];
    const digests: (string | undefined)[] = [];
    const r = await replay(game, layouts, file.session, { commands: opts.commands, onEntry: (i, e) => { roomAt[i + 1] = e.state.room; digests[i] = log[i].digest ?? e.session?.log.at(-1)?.digest; } });
    const played = r.played, first = r.first;
    for (const en of log) if ('act' in en && en.aborted) report.aborts++;
    if (r.divergedAt !== undefined) report.divergences++;
    const timed = log.some((en) => en.t !== undefined);
    let duration = 0;
    let run: { key: string; room: Id; count: number; from: number; at: number } | null = null;
    for (let i = first; i < first + played; i++) {
      const en = log[i];
      const here = roomAt[i] ?? roomAt[0];
      const stat = room(here);
      stat.entries++;
      report.total.entries++;
      bump(report.heat, `room:${here}`);
      for (const id of en.ran ?? []) {
        bump(report.heat, id);
        if (id.startsWith('hint:')) { bump(report.hints, id); stat.hints++; }
        if (id.startsWith('minigame:')) bump(report.minigames, id.slice('minigame:'.length));
      }
      const changed = i === first ? true : digests[i] !== digests[i - 1];
      if (changed) stat.effective++; else stat.noops++;
      // Time: this entry's duration is the gap to the next one, pauses excluded.
      let dt: number | undefined;
      if (timed && en.t !== undefined && log[i + 1]?.t !== undefined) { dt = log[i + 1].t! - en.t; if (dt > pauseMs || dt < 0) dt = undefined; else { duration += dt; stat.ms += dt; } }
      // Stalls: the same action, no effect, again and again.
      const key = actionKey(en);
      if (key && !changed && !('aborted' in en && en.aborted)) {
        if (run && run.key === key && run.room === here) { run.count++; if (dt !== undefined) run.from += dt; }
        else run = { key, room: here, count: 1, from: dt ?? 0, at: i };
        if (run.count === stallRepeats) report.stalls.push({ file: name, room: here, action: key, repeats: run.count, ms: timed ? run.from : undefined, at: run.at });
        else if (run.count > stallRepeats) { const s = report.stalls[report.stalls.length - 1]; s.repeats = run.count; if (timed) s.ms = run.from; }
      } else run = null;
    }
    const lastIndex = Math.max(first, first + played - 1);
    const abandon = { room: roomAt[lastIndex] ?? roomAt[0], label: log[lastIndex] ? labelOf(game, log[lastIndex]) : '(empty)', index: lastIndex };
    if (!r.ended) room(abandon.room).abandons++;
    report.total.ms += duration;
    report.files.push({ name, entries: log.length - first, played, ended: r.ended, ...(file.device ? { device: file.device } : {}), divergedAt: r.divergedAt, divergence: r.divergence, durationMs: timed ? duration : undefined, abandon });
  }
  report.stalls.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0) || b.repeats - a.repeats);
  return report;
}

const secs = (ms: number) => `${Math.round(ms / 1000)} s`;

/** The report as Markdown (the terminal, the Studio panel, the MCP tool). */
export function playtestsMarkdown(r: PlaytestReport, game: GameDef): string {
  const roomName = (id: Id) => game.rooms.find((x) => x.id === id)?.name ?? id;
  const out = [`# Playtests (${r.total.files} session${r.total.files === 1 ? '' : 's'}, ${r.total.entries} inputs${r.total.ms ? `, ${secs(r.total.ms)} of play` : ''})`, ''];
  if (!r.files.length) { out.push('No playtests yet: play on a phone, then "Share session" in the pause menu and drop the file in `games/<id>/playtests/`.', ''); return out.join('\n'); }
  out.push('| Session | inputs | ended | diverged | play time | stopped at |', '|---|---|---|---|---|---|');
  for (const f of r.files) out.push(`| ${f.name} | ${f.played}/${f.entries} | ${f.ended ? 'yes' : 'no'} | ${f.divergedAt !== undefined ? `#${f.divergedAt + 1}` : ''} | ${f.durationMs !== undefined ? secs(f.durationMs) : ''} | ${roomName(f.abandon.room)}: ${f.abandon.label} |`);
  out.push('');
  if (r.stalls.length) {
    out.push('## Where players stall', '', '| Session | room | action | tries | time |', '|---|---|---|---|---|');
    for (const s of r.stalls.slice(0, 20)) out.push(`| ${s.file} | ${roomName(s.room)} | ${s.action} | ${s.repeats} | ${s.ms !== undefined ? secs(s.ms) : ''} |`);
    out.push('');
  }
  const rooms = Object.entries(r.rooms).sort((a, b) => b[1].ms - a[1].ms || b[1].entries - a[1].entries);
  out.push('## Time per room', '', '| Room | play time | inputs | effective | no effect | hints | stopped here |', '|---|---|---|---|---|---|---|');
  for (const [id, s] of rooms) out.push(`| ${roomName(id)} | ${s.ms ? secs(s.ms) : ''} | ${s.entries} | ${s.effective} | ${s.noops} | ${s.hints} | ${s.abandons || ''} |`);
  out.push('');
  const hints = Object.entries(r.hints).sort((a, b) => b[1] - a[1]);
  if (hints.length) { out.push('## Hints shown', '', ...hints.map(([k, n]) => `- ${k.slice('hint:'.length)}: ${n}`), ''); }
  if (Object.keys(r.minigames).length) out.push('## Minigames played', '', ...Object.entries(r.minigames).map(([k, n]) => `- ${k}: ${n}`), '');
  if (r.aborts) out.push(`${r.aborts} interrupted walk(s).`, '');
  const diverged = r.files.filter((f) => f.divergedAt !== undefined);
  if (diverged.length) out.push('## Content changed since the recording', '', ...diverged.map((f) => `- ${f.name}: stopped at #${f.divergedAt! + 1}, ${f.divergence ?? ''} (re-record or delete the file)`), '');
  return out.join('\n');
}

/** What a field release asks of its playtests (3.7.1): `verify:field`'s quotas, each optional. */
export interface PlaytestQuotas { sessions?: number; completed?: number; devices?: number }

/**
 * The quotas these playtests miss, one line each (empty: met). A diverged session counts for none of them: it no
 * longer says what the game is.
 */
export function quotaShortfalls(files: Pick<PlaytestSummary, 'ended' | 'divergedAt' | 'device'>[], q: PlaytestQuotas): string[] {
  const ok = files.filter((f) => f.divergedAt === undefined);
  const done = ok.filter((f) => f.ended).length;
  const devices = new Set(ok.map((f) => f.device).filter(Boolean)).size;
  const out: string[] = [];
  if (q.sessions !== undefined && ok.length < q.sessions) out.push(`${ok.length} session(s), ${q.sessions} asked`);
  if (q.completed !== undefined && done < q.completed) out.push(`${done} played to the end, ${q.completed} asked`);
  if (q.devices !== undefined && devices < q.devices) out.push(`${devices} device famil${devices === 1 ? 'y' : 'ies'}, ${q.devices} asked`);
  return out;
}
