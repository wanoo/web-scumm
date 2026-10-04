// What a player downloads, in bytes: before the first room can be played (`initial`), to show each room, and over each
// chapter (every room a player can be in during it). The same images the engine preloads when it builds a room
// (dom/room.ts): the backdrop, the props in every state, the characters who can stand there (every playable one, the
// room's actors) with their variants and mouths; plus the room's music and the sound effects its commands play.
// `npm run weight` prints it against `assetBudgets` (`initialKB`, `roomKB`, `chapterKB`); docs/en/TOOLS.md "Weight".
import { eachCmd } from '../core/cmds';
import type { Cmd, GameDef, Id, RoomDef } from '../core/types';

export interface WeightBudgets { initialKB?: number; roomKB?: number; chapterKB?: number }

/** The images a character shows (sprites, mouths, every variant's). */
function characterImages(game: GameDef, c: Id, out: Set<string>) {
  const def = game.characters[c];
  for (const set of [def?.sprites, ...(def?.variants ?? []).map((v) => v.sprites)]) for (const frames of Object.values(set ?? {})) frames.forEach((f) => out.add(`img:${f}`));
  for (const m of [def?.mouths, ...(def?.variants ?? []).map((v) => v.mouths)]) for (const ms of Object.values(m ?? {})) [ms.closed, ...ms.open, ms.blink, ms.smile].forEach((f) => f && out.add(`img:${f}`));
}

/** Every command list a room owns. */
function roomCmds(room: RoomDef): (Cmd[] | undefined)[] {
  return [room.onEnter, ...(room.on ?? []).map((r) => r.do), ...Object.values(room.talk ?? {}).flatMap((ts) => ts.map((t) => t.do)),
    ...(room.scripts ?? []).map((s) => s.do), ...(room.events ?? []).map((e) => e.do)];
}

/** The asset keys (`img:`, `music:`, `sfx:`) a room needs on screen. */
export function roomAssets(game: GameDef, room: RoomDef): string[] {
  const out = new Set<string>([`img:${room.decor}`]);
  for (const p of Object.values(room.props ?? {})) { if (p.img) out.add(`img:${p.img}`); Object.values(p.states ?? {}).forEach((x) => out.add(`img:${x}`)); }
  const chars = new Set<Id>([game.hero, ...(game.players?.ids ?? []), ...Object.values(room.actors ?? {}).map((a) => a.char)]);
  for (const c of chars) characterImages(game, c, out);
  const music = room.music && game.audio?.music?.[room.music];
  if (music) out.add(`music:${music}`);
  for (const list of roomCmds(room)) eachCmd(list, (c) => { if (typeof c !== 'string' && 'sfx' in c) { const f = game.audio?.sfx?.[c.sfx]; if (f) out.add(`sfx:${f}`); } });
  return [...out].sort();
}

/** What the first room needs, plus the title screen, the column's icons and the bag's icons at the start. */
export function initialAssets(game: GameDef): string[] {
  const start = game.rooms.find((r) => r.id === game.start.room);
  const out = new Set<string>(start ? roomAssets(game, start) : []);
  const T = game.titleScreen;
  for (const x of [T?.decor, T?.logo]) if (x) out.add(`img:${x}`);
  const tm = T?.music && game.audio?.music?.[T.music];
  if (tm) out.add(`music:${tm}`);
  const icons = game.skin?.icons;
  for (const x of [icons?.map, icons?.pause, icons?.music]) if (x) out.add(`img:${x}`);
  for (const it of game.start.inventory ?? []) { const icon = game.items[it]?.icon; if (icon) out.add(`img:${icon}`); }
  return [...out].sort();
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

export function weightReport(game: GameDef, sizes: Record<string, number | null>, chapters: { id: string; rooms: Id[] }[] = [], budgets: WeightBudgets = game.assetBudgets ?? {}): WeightReport {
  const byRoom = new Map(game.rooms.map((r) => [r.id, roomAssets(game, r)]));
  const initial = weigh(initialAssets(game), sizes);
  const rooms = game.rooms.map((r) => ({ id: r.id, ...weigh(byRoom.get(r.id)!, sizes) })).sort((a, b) => b.bytes - a.bytes);
  const ch = chapters.map((c) => ({ ...c, ...weigh([...new Set(c.rooms.flatMap((r) => byRoom.get(r) ?? []))], sizes) }));
  const over: string[] = [];
  if (budgets.initialKB !== undefined && kb(initial.bytes) > budgets.initialKB) over.push(`initial download ${kb(initial.bytes)} KB > initialKB ${budgets.initialKB}`);
  if (budgets.roomKB !== undefined) for (const r of rooms) if (kb(r.bytes) > budgets.roomKB) over.push(`room ${r.id} ${kb(r.bytes)} KB > roomKB ${budgets.roomKB}`);
  if (budgets.chapterKB !== undefined) for (const c of ch) if (kb(c.bytes) > budgets.chapterKB) over.push(`chapter ${c.id} ${kb(c.bytes)} KB > chapterKB ${budgets.chapterKB}`);
  return { initial, rooms, chapters: ch, over };
}
