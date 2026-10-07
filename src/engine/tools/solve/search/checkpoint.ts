// Checkpoint and resume (4.1.13): a search written down between two batches (the store, the frontier with its order,
// the counters, what the expansions counted) and taken up again where it stood, to the same verdict and the same
// witness. The text is a header line (what a tool reads to know how far it got) and the body. A snapshot names the
// search it belongs to (a fingerprint of the game and of the options that change what is found): another search
// ignores it and starts from the beginning. This file never touches a disk: the caller's `save` does
// (tools/checkpoint.ts writes a file, then renames it, so a kill leaves the previous snapshot whole).
import type { GameDef, GameState, Layout } from '../../../core/types';
import type { ExpandStats, SolveOptions } from '../model';
import type { SolveProfile, SolveResult } from '../report';
import type { Dims } from '../abstractions';
import { fnv64, type StoreSnapshot } from './compact';

/** What a tool reads of a snapshot without parsing the rest. */
export interface SnapshotHeader {
  v: 1;
  fingerprint: string;
  states: number;
  expansions: number;
  /** Time spent before this snapshot, over every run that led to it. */
  ms: number;
}

/** The search's own counters and findings, besides the store and the frontier. */
interface LoopSnapshot {
  postponed: number;
  hashHits: number;
  maxQueue: number;
  expansions: number;
  triesSum: number;
  triesMax: number;
  pruned: number;
  worst?: SolveProfile['branching']['worst'];
  perRoom: [string, number][];
  unlocked: string[];
  deadEnds: SolveResult['deadEnds'];
  broken: SolveResult['broken'];
  brokenSeen: number[];
  errors: string[];
  finish: number | null;
  last: number;
}

export interface SearchSnapshot {
  header: SnapshotHeader;
  store: StoreSnapshot;
  frontier: {
    items: { v: { i: number; state: GameState; dims: Dims; len: number }; score: number; seq: number }[];
    seq: number;
  };
  loop: LoopSnapshot;
  stats: ReturnType<typeof statsToJson>;
}

/** The search a snapshot belongs to: the game, its layouts and every option that changes what the search finds. */
export function fingerprint(game: GameDef, layouts: Record<string, Layout>, opts: SolveOptions, batch: number): string {
  const { mode, start, goal, por, memo, canonicalPlayers, mobility, ownership, dominance, reality, symmetry } = opts;
  const text = JSON.stringify({
    game,
    layouts,
    o: { mode, start, goal, por, memo, canonicalPlayers, mobility, ownership, dominance, reality, symmetry, batch },
    rep: opts.representation ?? 'compact',
    // The custom commands' effects change what the search finds: their source is part of the search.
    commands: Object.entries(opts.commands ?? {}).map(([k, c]) => [
      k,
      JSON.stringify(c, (_, v) => (typeof v === 'function' ? String(v) : v)),
    ]),
  });
  const [hi, lo] = fnv64(text);
  return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}-${text.length}`;
}

export function statsToJson(s: ExpandStats) {
  return {
    itemsInRules: [...s.itemsInRules],
    itemsSeen: [...s.itemsSeen],
    flags: [...s.flags],
    gained: [...s.gained],
    roomsReached: [...s.roomsReached],
    attempted: [...s.attempted],
    perAction: [...s.perAction],
    fallbackByRoom: [...s.fallbackByRoom],
    n: s.n,
    timing: s.timing,
    canon: s.canon,
    mob: s.mob,
    own: s.own,
  };
}

/** Puts a snapshot's counts back into a fresh expander's stats. */
export function statsFromJson(j: ReturnType<typeof statsToJson>, into: ExpandStats) {
  for (const k of ['itemsInRules', 'itemsSeen', 'flags', 'gained', 'roomsReached'] as const)
    for (const x of j[k]) into[k].add(x);
  for (const k of ['attempted', 'perAction'] as const) for (const [x, n] of j[k]) into[k].set(x, n);
  for (const [r, f] of j.fallbackByRoom) into.fallbackByRoom.set(r, f);
  Object.assign(into.n, j.n);
  Object.assign(into.timing, j.timing);
  Object.assign(into.canon, j.canon);
  Object.assign(into.mob, j.mob);
  Object.assign(into.own, j.own);
}

export function encodeSnapshot(s: SearchSnapshot): string {
  const { header, ...body } = s;
  return `${JSON.stringify(header)}\n${JSON.stringify(body)}`;
}

/** The header of a snapshot's text (its first line), or null when it is not one. */
export function snapshotHeader(text: string): SnapshotHeader | null {
  try {
    const h = JSON.parse(text.slice(0, text.indexOf('\n'))) as SnapshotHeader;
    return h && h.v === 1 && typeof h.fingerprint === 'string' ? h : null;
  } catch {
    return null;
  }
}

export function decodeSnapshot(text: string): SearchSnapshot | null {
  const header = snapshotHeader(text);
  if (!header) return null;
  try {
    return { header, ...(JSON.parse(text.slice(text.indexOf('\n') + 1)) as Omit<SearchSnapshot, 'header'>) };
  } catch {
    return null;
  }
}
