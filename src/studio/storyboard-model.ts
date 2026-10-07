// The Storyboard tab's model (4.1.8, programme §4.7: the Studio's biggest owners split into model / IO / view): the
// document as edited, its normalisation, the list moves, the ids, the speakers and the coverage lookups. Pure: no DOM,
// no API, so it is tested without a browser and the view and the tab share one definition of each rule.
import { sbLines, sbReactions, sbTalks, type SbBoard, type SbPanel } from '../../tools/pages/storyboard-data';
import type { CoverageData, GameInfo } from './api';
import type { BoardCoverage, Check, PanelCoverage } from '@engine/tools/coverage';
import { must } from '../engine/core/must';

export type Doc = Record<string, unknown> & { title?: string; intro?: string; boards: SbBoard[] };

/** The speakers that are not characters: an action of the player, a stage direction. */
export const STAGE = new Set(['action', 'stage']);

/**
 * Light normalisation in place: lines, `talk` / talk lists, `optional`, through the page generator's helpers with the
 * other fields kept (`tools/pages/storyboard-data.ts`, 4.1.0: one normalisation for the page, the Studio and the MCP).
 */
export function normDoc(raw: unknown): Doc {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Doc;
  if (!Array.isArray(doc.boards)) doc.boards = [];
  for (const b of doc.boards as unknown as Record<string, unknown>[]) {
    if (!Array.isArray(b.panels)) b.panels = [];
    for (const p of b.panels as Record<string, unknown>[]) {
      if (p.lines !== undefined) p.lines = sbLines(p.lines, true);
      if (p.id === undefined) p.id = '';
      if (p.title === undefined) p.title = '';
    }
    if (b.arrival !== undefined) b.arrival = sbLines(b.arrival, true);
    if (b.talk !== undefined && b.talks === undefined) {
      b.talks = b.talk;
      delete b.talk;
    }
    if (b.talks !== undefined) b.talks = sbTalks(b.talks, true) ?? b.talks;
    if (b.optional !== undefined && b.reactions === undefined) {
      b.reactions = b.optional;
      delete b.optional;
    }
    if (Array.isArray(b.reactions)) b.reactions = sbReactions(b.reactions, true);
  }
  return doc;
}

/** Swaps `list[i]` with its neighbour at `i + d`; false (and nothing moved) when that is out of range. */
export function move<T>(list: T[], i: number, d: number): boolean {
  const j = i + d;
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [must(list[j], 'item to swap'), must(list[i], 'item to move')];
  return true;
}

/** Panels in play order: [id, title, board title] (for the Notes tab). */
export function panelList(doc: Doc | undefined): [string, string, string][] {
  return (doc?.boards ?? []).flatMap((b) => b.panels.map((p) => [p.id, p.title, b.title] as [string, string, string]));
}

/** Where a panel id is: its board index and its index in the board, or undefined. */
export function findPanel(doc: Doc | undefined, id: string): { bi: number; pi: number } | undefined {
  const bi = doc?.boards.findIndex((b) => b.panels.some((p) => p.id === id)) ?? -1;
  if (bi < 0 || !doc) return undefined;
  return { bi, pi: must(doc.boards[bi], 'board just found').panels.findIndex((p) => p.id === id) };
}

/** Every panel id of the document, in play order (duplicates included). */
export function panelIds(doc: Doc): string[] {
  return doc.boards.flatMap((b) => b.panels.map((p) => p.id));
}

/** Why the document cannot be saved as it is (panel ids are what notes attach to), or undefined. */
export function idProblem(doc: Doc): string | undefined {
  const ids = panelIds(doc);
  const dup = ids.find((x, i) => ids.indexOf(x) !== i);
  if (dup) return `Two panels have the id "${dup}": notes are attached to panel ids, make them unique.`;
  if (ids.some((x) => !x.trim())) return 'A panel has no id.';
  return undefined;
}

/** `base`, or `base2`, `base3`… when a panel already has that id. */
export function uniquePanelId(doc: Doc, base: string): string {
  const ids = new Set(panelIds(doc));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** The id of a new board: `board-<n>` from the count, skipping the ids taken. */
export function nextBoardId(doc: Doc): string {
  let n = doc.boards.length + 1;
  while (doc.boards.some((b) => b.id === `board-${n}`)) n++;
  return `board-${n}`;
}

/** The id of a new panel of `b`: `<board id>-<n>` from the count, skipping the panel ids taken anywhere. */
export function nextPanelId(doc: Doc, b: SbBoard): string {
  const ids = new Set(panelIds(doc));
  let n = b.panels.length + 1;
  while (ids.has(`${b.id}-${n}`)) n++;
  return `${b.id}-${n}`;
}

/** A deep copy of `p` placed after it: a unique `-copy` id, the title marked "(copy)". */
export function duplicatePanel(doc: Doc, p: SbPanel): SbPanel {
  const copy: SbPanel = JSON.parse(JSON.stringify(p));
  copy.id = uniquePanelId(doc, `${p.id}-copy`);
  copy.title = p.title ? `${p.title} (copy)` : '';
  return copy;
}

/** The speaker choices of a line: the hero, the stage speakers, the other characters, and `current` if unknown. */
export function speakerOptions(info: GameInfo, current: string): [string, string][] {
  const { characters, hero } = info;
  const opts: [string, string][] = [
    ['hero', `hero (${characters[hero]?.name ?? hero})`],
    ['action', 'action'],
    ['stage', 'stage'],
  ];
  for (const [id, c] of Object.entries(characters))
    if (id !== hero) opts.push([id, c.name === id ? id : `${c.name} (${id})`]);
  if (!opts.some(([v]) => v === current)) opts.push([current, `${current} (unknown)`]);
  return opts;
}

/** The character id behind a speaker (`hero` resolved). */
export const charOf = (info: GameInfo, who: string): string => (who === 'hero' ? info.hero : who);

/** The speaker's colour, none for the stage speakers or an unknown character. */
export function colorOf(info: GameInfo, who: string): string | undefined {
  if (STAGE.has(who)) return undefined;
  return info.characters[charOf(info, who)]?.color;
}

/** The character's name behind a speaker, the id when unknown. */
export const speakerName = (info: GameInfo, who: string): string => info.characters[charOf(info, who)]?.name ?? who;

export function boardCov(cov: CoverageData | null, id: string): BoardCoverage | undefined {
  return cov?.coverage.boards.find((b) => b.id === id);
}
export function panelCov(cov: CoverageData | null, id: string): PanelCoverage | undefined {
  return cov?.coverage.boards.flatMap((b) => b.panels).find((p) => p.id === id);
}

/** The checks of a panel that are not fully in the game (its action, lines and sounds). */
export function panelIssues(pc: PanelCoverage | undefined): Check[] {
  if (!pc) return [];
  return [...(pc.action ? [pc.action] : []), ...pc.lines, ...pc.sfx].filter(
    (x) => x.status === 'partial' || x.status === 'missing',
  );
}
