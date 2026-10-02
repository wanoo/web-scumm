// Shared types of the Studio: the core functions (tools/studio/core.ts), the dev-server API (tools/studio/plugin.ts),
// the Studio UI (src/studio/) and the MCP server all speak these shapes. Type-only: safe to import from the browser.
import type { CharacterDef, GameDef, Id, ItemDef, Layout, Point, RoomDef, VerbDef } from '../../src/engine/core/types';

/** What a text literal is, from its JSON path in the room file. */
export type TextKind =
  | 'name'    // room / prop / hotspot / actor display name
  | 'look'    // a look line
  | 'say'     // { say: [who, text] }: `who` holds the speaker
  | 'hero'    // a bare string in a command list: the hero says it
  | 'topic'   // a conversation topic
  | 'hint'    // a hint line
  | 'toast'   // { toast: text }
  | 'choice'  // { choice: [{ text }] }
  | 'guide';  // { guide: { say } }

/** A text literal of a room file, addressed by its JSON path under `defineRoom({...})`. */
export interface TextRef {
  /** `look.piano[1]`, `on[3].do[0]`, `talk.grandma[0].topic`, `hints[2].lines[0]`, `props.lamp.name`… */
  path: string;
  value: string;
  /** The room file, relative to the repository root (absolute when the game lives elsewhere). */
  file: string;
  /** 1-based line of the literal. */
  line: number;
  kind: TextKind;
  /** For `say`: the speaker id (`say[0]`), when it is a literal. */
  who?: string;
}

export interface GameInfo {
  id: string;
  title: string;
  rooms: { id: Id; name: string; decor: Id }[];
  characters: Record<Id, Pick<CharacterDef, 'name' | 'color' | 'portrait'>>;
  items: Record<Id, Pick<ItemDef, 'name' | 'icon'>>;
  verbs: VerbDef[];
  checkpoints: NonNullable<GameDef['checkpoints']>;
  hero: Id;
  /** Image ids of the asset manifest with their size (thumbnails: `/assets/img/<id>.webp`). */
  images: Record<Id, [number, number]>;
}

export interface RoomData {
  def: RoomDef;
  layout: Layout;
  texts: TextRef[];
  /** The room file, relative to the repository root. */
  file: string;
}

export type EntityKind = 'prop' | 'hotspot' | 'actor';

export interface AddEntity {
  kind: EntityKind;
  id: Id;
  /** Display name (required for props and hotspots; optional for an actor: defaults to the character's name). */
  name?: string;
  /** Prop image id (manifest). */
  img?: Id;
  /** Actor character id. */
  char?: Id;
  /** Foot point (prop, actor) or center (hotspot), logical 640 × 400. */
  at: Point;
  /** Optional first look line, written in `look` at the same time. */
  look?: string;
}

/** `{ path, value }`: replace. `value: null`: delete (an array element, or a whole `look.<id>`). `path` ending in `[+]`: append. */
export interface SetText { path: string; value: string | null }

export interface EditResult { ok: true; line: number; changed: boolean }

export interface Note {
  id: string;
  /** What it is about: a panel id, a room id, `room.entity`, or free text. */
  about: string;
  author: string;
  text: string;
  /** ISO date. */
  at: string;
}
export interface NewNote { about?: string; author?: string; text: string }
export interface NotesFile { entries: Note[] }

export interface ValidateResult { ok: boolean; errors: string[]; warnings: string[]; ms: number }

export interface SolveData {
  finished: boolean;
  states: number;
  truncated: boolean;
  path: string[];
  roomsReached: string[];
  unlockedReached: string[];
  flagsReached: string[];
  itemsNeverUsed: string[];
  unusedItems: string[];
  deadEnds: { room: string; inventory: string[]; path: string[] }[];
  errors: string[];
  from: string | null;
  ms: number;
}

export type ScreenshotResult = { file: string; url: string } | { unavailable: true; reason: string };

/** Server-sent event of GET /__studio/api/events. `file` is relative to the game folder (`rooms/house.ts`). */
export type StudioEvent = { type: 'changed'; file: string } | { type: 'hello'; game: string };

// ---------------------------------------------------------------------------
// postMessage bridge between the placement editor (iframe, src/engine/dev/editor.ts) and the Studio.
// ---------------------------------------------------------------------------

/** Selection key used by the editor: `prop:<id>`, `hs:<id>` (hotspot), `actor:<id>`, `entry:<name>`, `walk`, `scale`. */
export type EditorKey = string;

export type EditorToStudio =
  | { source: 'web-scumm-editor'; type: 'ready'; room: Id; missing: { kind: EntityKind; id: Id }[] }
  | { source: 'web-scumm-editor'; type: 'select'; room: Id; key: EditorKey; kind?: EntityKind; id?: Id }
  | { source: 'web-scumm-editor'; type: 'dirty'; room: Id; dirty: boolean }
  | { source: 'web-scumm-editor'; type: 'saved'; room: Id; ok: boolean; error?: string };

export type StudioToEditor =
  | { source: 'web-scumm-studio'; type: 'select'; kind: EntityKind; id: Id }
  /** Give geometry to an entity the room declares but the layout lacks (no-op if it has some). */
  | { source: 'web-scumm-studio'; type: 'create'; kind: EntityKind; id: Id; at?: Point }
  | { source: 'web-scumm-studio'; type: 'save' };
