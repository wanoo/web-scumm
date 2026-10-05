// What a player downloads, in bytes: before the first room can be played (`initial`: the app shell the service worker
// precaches, the title and the first room), to show each room, and over each chapter (every room a player can be in
// during it). The scopes come from the asset graph (src/engine/core/asset-graph.ts), which the renderer's preload, the
// warm-up and the offline plan read too; `scripts/e2e-weight.mjs` checks the prediction against the bytes a browser
// really transfers.
// `npm run weight` prints it against `assetBudgets` (`initialKB`, `roomKB`, `chapterKB`); docs/en/TOOLS.md "Weight".
import { assetGraph, initialScope, type AssetGraph, type MinigameBindings } from '../core/asset-graph';
import type { GameDef, Id, RoomDef } from '../core/types';

export interface WeightBudgets { initialKB?: number; roomKB?: number; chapterKB?: number }

/** The asset keys a room can need (`room:<id>` of the asset graph, src/engine/core/asset-graph.ts). */
export function roomAssets(game: GameDef, room: RoomDef, graph: AssetGraph = assetGraph(game)): string[] {
  return graph.rooms[room.id] ?? [];
}

/** What the first room needs, plus the title, the column's icons and the bag at the start (the graph's initial scope). */
export function initialAssets(game: GameDef, graph: AssetGraph = assetGraph(game)): string[] {
  return initialScope(graph, game);
}

export interface Weighed { bytes: number; files: number; missing: string[] }
export function weigh(keys: string[], sizes: Record<string, number | null>): Weighed {
  let bytes = 0, files = 0;
  const missing: string[] = [];
  for (const k of keys) { const b = sizes[k]; if (b === null || b === undefined) missing.push(k); else { bytes += b; files++; } }
  return { bytes, files, missing };
}

export interface WeightReport {
  initial: Weighed;
  rooms: ({ id: Id } & Weighed)[];
  chapters: ({ id: string; rooms: Id[] } & Weighed)[];
  /** One line per budget exceeded. */
  over: string[];
}

const kb = (b: number) => Math.round(b / 1024);

export function weightReport(game: GameDef, sizes: Record<string, number | null>, chapters: { id: string; rooms: Id[] }[] = [], budgets: WeightBudgets = game.assetBudgets ?? {}, opts: { bindings?: MinigameBindings; shell?: string[] } = {}): WeightReport {
  const graph = assetGraph(game, { bindings: opts.bindings });
  const byRoom = new Map(game.rooms.map((r) => [r.id, roomAssets(game, r, graph)]));
  // The first visit: the app shell (what the service worker precaches, when the build is there) and the initial scope.
  const initial = weigh([...(opts.shell ?? []), ...initialAssets(game, graph)], sizes);
  const rooms = game.rooms.map((r) => ({ id: r.id, ...weigh(byRoom.get(r.id)!, sizes) })).sort((a, b) => b.bytes - a.bytes);
  const ch = chapters.map((c) => ({ ...c, ...weigh([...new Set(c.rooms.flatMap((r) => byRoom.get(r) ?? []))], sizes) }));
  const over: string[] = [];
  if (budgets.initialKB !== undefined && kb(initial.bytes) > budgets.initialKB) over.push(`initial download ${kb(initial.bytes)} KB > initialKB ${budgets.initialKB}`);
  if (budgets.roomKB !== undefined) for (const r of rooms) if (kb(r.bytes) > budgets.roomKB) over.push(`room ${r.id} ${kb(r.bytes)} KB > roomKB ${budgets.roomKB}`);
  if (budgets.chapterKB !== undefined) for (const c of ch) if (kb(c.bytes) > budgets.chapterKB) over.push(`chapter ${c.id} ${kb(c.bytes)} KB > chapterKB ${budgets.chapterKB}`);
  return { initial, rooms, chapters: ch, over };
}
