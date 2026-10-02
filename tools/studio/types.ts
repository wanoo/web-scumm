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
  /** Sound effect ids of `audio.sfx` (sounds at `/assets/audio/<file>`). */
  sfx?: Id[];
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
  /** ISO date of the last edit (PUT notes/:id), absent if never edited. */
  edited?: string;
}
export interface NewNote { about?: string; author?: string; text: string }
export interface NotesFile { entries: Note[] }
/** PUT notes/:id: the new text (and optionally a new `about`). */
export interface NoteEdit { text: string; about?: string }

/** POST storyboard/markdown: the file written (relative to the repository root) and its size. */
export interface MarkdownResult { ok: true; file: string; bytes: number; boards: number; panels: number }

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
// ---------------------------------------------------------------------------
// Demo mode (no server: GitHub Pages): a snapshot of the game, the user's edits as a patch list.
// ---------------------------------------------------------------------------

/** public/studio-demo/snapshot.json, written by tools/studio/snapshot.ts at build time. */
export interface StudioSnapshot {
  format: 'web-scumm-studio-snapshot';
  version: 1;
  /** ISO date of the build. */
  created: string;
  game: GameInfo;
  rooms: Record<Id, RoomData>;
  storyboard: Record<string, unknown>;
  notes: NotesFile;
  /** Markdown documents by name (CONTENT_GUIDE). */
  docs: Record<string, string>;
}

/** One edit made in the demo Studio, replayed on top of the snapshot (and by `npm run studio-apply`). */
export type StudioPatch =
  | { kind: 'text'; room: Id; path: string; value: string | null }
  | { kind: 'layout'; room: Id; layout: Layout }
  | { kind: 'entity'; room: Id; entity: AddEntity }
  | { kind: 'storyboard'; storyboard: Record<string, unknown> }
  | { kind: 'note'; note: Note }
  | { kind: 'note-edit'; id: string; text: string; about?: string; edited: string }
  | { kind: 'note-delete'; id: string };

/** The file "Download patch" produces. */
export interface StudioPatchFile {
  format: 'web-scumm-studio-patch';
  version: 1;
  game: string;
  created: string;
  patches: StudioPatch[];
}

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
  /** `layout`: set when the editor could not write the file (Studio demo, no dev server): the Studio stores it. */
  | { source: 'web-scumm-editor'; type: 'saved'; room: Id; ok: boolean; error?: string; layout?: Layout };

export type StudioToEditor =
  | { source: 'web-scumm-studio'; type: 'select'; kind: EntityKind; id: Id }
  /** Give geometry to an entity the room declares but the layout lacks (no-op if it has some). */
  | { source: 'web-scumm-studio'; type: 'create'; kind: EntityKind; id: Id; at?: Point }
  | { source: 'web-scumm-studio'; type: 'save' };
