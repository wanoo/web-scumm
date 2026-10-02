// Content format types (the "DSL"). The whole game is written with these types, as pure data:
// no functions in the content, so it can be validated, saved and solved automatically.
// The engine knows no particular game: nothing here refers to a specific game.

export type Id = string;
export type Value = boolean | number | string;
/** Logical coordinates of a backdrop: 640 × 400, origin top-left. */
export type Point = [number, number];

// ---------------------------------------------------------------------------
// Conditions (data, never closures)
// ---------------------------------------------------------------------------

/**
 * A condition.
 * - `'flag'`: the flag is true; `'!flag'`: the flag is false or absent.
 * - `{ has: 'item' }`: the item is in the inventory.
 * - `{ flag: 'x', eq: 3 }`, `{ flag: 'x', gte: 2 }`, `{ flag: 'x', lt: 5 }`.
 * - `{ not: … }`, `{ all: […] }`, `{ any: […] }`.
 * - `{ visited: 'room' }`: this room has already been entered; `{ room: 'room' }`: we're in it.
 * - `{ prop: ['amp', 'on'] }`: the prop is in that state (in the current room, or `'room.prop'`).
 * - `{ unlocked: 'place' }`: the place is unlocked on the map.
 * - `{ seen: 'room.actor.0' }`: the conversation topic has already been heard.
 */
export type Cond =
  | string
  | { has: Id }
  | { flag: Id; eq?: Value; gte?: number; lt?: number }
  | { not: Cond }
  | { all: Cond[] }
  | { any: Cond[] }
  | { visited: Id }
  | { room: Id }
  | { prop: [Id, string] }
  | { unlocked: Id }
  | { seen: string };

// ---------------------------------------------------------------------------
// Script commands
// ---------------------------------------------------------------------------

/** Who speaks or acts. `'hero'` always designates the hero, whatever their id. */
export type Who = Id;

/** Target of a move: a hotspot, an actor or a prop in the room (its approach point), or a point. */
export type WalkTarget = Id | Point;

/**
 * A command. A plain string = the hero says this line.
 * Command lists run in order, each one waiting for the previous one to finish.
 */
export type Cmd =
  | string
  // --- speech
  | { say: [Who, string]; shout?: boolean }
  // --- movement and poses
  | { walk: WalkTarget; who?: Who }
  | { face: 'left' | 'right' | Id; who?: Who }
  | { pose: [Who, string] }
  | { anim: [Who, string]; ms?: number }
  | { place: [Who, Point]; face?: 'left' | 'right' }
  | { wait: number }
  | { parallel: Cmd[][] }
  // --- world
  | { prop: [Id, string] }
  | { show: Id; fade?: number }
  | { hide: Id; fade?: number }
  | { gain: Id }
  | { lose: Id }
  /** The item has been used: it stays in the inventory, greyed out, and isn't offered again unless a rule targets it. `gain` re-enables it. */
  | { used: Id | Id[] }
  | { set: Id | [Id, Value] }
  | { unset: Id }
  | { inc: Id; by?: number }
  | { unlock: Id }
  | { goto: Id; at?: Id | Point }
  | { map: true }
  // --- audio and effects
  | { sfx: Id }
  | { music: Id | { push: Id } | { pop: true } | { stop: true } | { once: Id } }
  | { toast: string }
  | { shake: number }
  // --- logic
  | { if: Cond; then: Cmd[]; else?: Cmd[] }
  | { once: Cmd[]; key?: string }
  | { nth: Cmd[][]; key?: string }
  | { cycle: Cmd[][]; key?: string }
  | { random: Cmd[][]; key?: string }
  // --- sequences and screens
  | { cutscene: Cmd[] }
  | { choice: Choice[] }
  | { minigame: Id; params?: Record<string, unknown>; then?: Cmd[] }
  /** Incoming call. A list = several callers in the same call (shown side by side). */
  | { phone: Who | Who[]; do: Cmd[] }
  | { guide: { verb: VerbId; target: Id; say: string } }
  | { talk: Id }
  | { hint: true }
  /**
   * The sealed ending (`ending` module): decryption, scratch ticket and confetti rain, then `after` (celebration lines),
   * then the final card. `{ reveal: true }` is the old name, still accepted.
   */
  | { ending: true; after?: Cmd[] }
  | { reveal: true; after?: Cmd[] }
  | { end: true };

export interface Choice {
  text: string;
  if?: Cond;
  /** Disappears once chosen. */
  once?: boolean;
  do: Cmd[];
}

// ---------------------------------------------------------------------------
// Verbs and reactions
// ---------------------------------------------------------------------------

/**
 * Verb id, free-form: the game's own `verbs` declare them.
 * Four ids have meaning to the engine: `look` ("Look" text for rooms and items), `talk` (conversation
 * topics, hint item), `give` and `use` (two terms: inventory item then target; `use` alone on an inventory
 * item selects it). Other verbs are only handled through written rules and fallback responses.
 */
export type VerbId = string;

export interface VerbDef {
  id: VerbId;
  label: string;
  color: string;
  /** For Use / Give: joining word shown in the sentence ("with", "to"). */
  join?: string;
}

/**
 * A written reaction: "when VERB is done on A (with/to B), if CONDITION, then …".
 * `a` and `b` accept a list: the rule works with any of them.
 * For Use/Give with two terms, `a` is the inventory item, `b` the target. The reverse order is also accepted
 * for two inventory items (combining).
 */
export interface Rule {
  verb: VerbId | VerbId[];
  a: Id | Id[];
  b?: Id | Id[];
  if?: Cond;
  do: Cmd[];
}

/**
 * Reaction by "kind": applies to anything with this `kind` (e.g. `person`, `cat`), before fallback responses.
 * `target` targets a specific id (takes priority over `kind`), `item` restricts to a used/given item.
 * `{nom}` is replaced by the target's name, `{objet}` by the item.
 */
export interface KindRule {
  verb: VerbId | VerbId[];
  kind?: string;
  target?: Id;
  item?: Id | Id[];
  say: string;
}

// ---------------------------------------------------------------------------
// Characters, items, rooms
// ---------------------------------------------------------------------------

/** A set of images for a character: pose → list of images (looped). */
export type SpriteSet = Record<string, Id[]>;

/**
 * Mouth images for a pose: the body doesn't move while speaking, only the mouth changes.
 * `closed` replaces the idle pose's image (t1), `open` cycles randomly during the line (t2, t3, t4),
 * `blink` occasionally returns to idle (t5), `smile` ends a happy line (t6).
 */
export interface MouthSet { closed: Id; open: Id[]; blink?: Id; smile?: Id }

export interface CharacterDef {
  name: string;
  /** Color of their dialogue text. */
  color: string;
  /** On-screen height, in logical units (640 × 400), in the foreground. */
  height?: number;
  /** Poses: at minimum `idle`. Conventions: idle, talk, walk, walk_front, walk_back, point, use, + special poses. */
  sprites?: SpriteSet;
  /** Portrait for the map, calls and conversation menus. */
  portrait?: Id;
  /** Kinds, for kind-based reactions (e.g. ['person'], ['cat']). */
  kind?: string[];
  /** Offscreen voice: speaks in a frame at the top of the screen (narrator, plush toy, phone). */
  offscreen?: boolean;
  /** Refusal when given an item with no written reaction. */
  refuse?: string;
  /** Response to the global "Want a hug?" topic. */
  hug?: string;
  /** Animation frames per second (default 8). */
  fps?: number;
  /** Soft glow around the character (CSS color), e.g. an apparition. */
  glow?: string;
  /** Mouths per pose (see MouthSet). With no mouth for a pose, the character keeps the same image while speaking. */
  mouths?: Record<string, MouthSet>;
  /** Image sets depending on state: the first variant whose condition is true replaces sprites / mouths / portrait. */
  variants?: { if: Cond; sprites?: SpriteSet; mouths?: Record<string, MouthSet>; portrait?: Id }[];
}

export interface ItemDef {
  name: string;
  icon: Id;
  /** Looking at the item in the inventory. A list = a different line each time (looped). */
  look?: string | string[];
  kind?: string[];
}

/** A prop in the scenery, with states (e.g. amp off/on). Its position comes from the layout. */
export interface PropDef {
  /** A single image, or one image per state. */
  img?: Id;
  states?: Record<string, Id>;
  initial?: string;
  /** Display name: if there is one, the prop is interactive. */
  name?: string;
  kind?: string[];
  /** Visible only if… */
  visible?: Cond;
}

export interface ActorDef {
  char: Id;
  /** false: living scenery, neither clickable nor named (e.g. an apparition). */
  interactive?: boolean;
  pose?: string;
  facing?: 'left' | 'right';
  visible?: Cond;
  /** Display name if different from the character. */
  name?: string;
}

export interface HotspotDef {
  name: string;
  kind?: string[];
  visible?: Cond;
}

export interface TalkTopic {
  topic: string;
  if?: Cond;
  do: Cmd[];
}

export interface HintDef {
  /** The hint holds as long as this condition is false. The first unsatisfied hint is given. */
  until: Cond;
  lines: string[];
}

export interface RoomDef {
  id: Id;
  name: string;
  /** Background image. */
  decor: Id;
  music?: Id;
  props?: Record<Id, PropDef>;
  actors?: Record<Id, ActorDef>;
  hotspots?: Record<Id, HotspotDef>;
  /** Look: a line, or a list (looped). Anything visible should have one. */
  look?: Record<Id, string | string[]>;
  on?: Rule[];
  /** Conversation topics per actor (2 or 3). "Want a hug?" and "Bye" are added by the game. */
  talk?: Record<Id, TalkTopic[]>;
  hints?: HintDef[];
  onEnter?: Cmd[];
  /** Is the hero present? (no for a pure cutscene) */
  hero?: boolean;
  /** Narrator voice for the room, for offscreen comments. */
}

// ---------------------------------------------------------------------------
// World map
// ---------------------------------------------------------------------------

export interface MapRegion {
  name: string;
  image: Id;
  /** Parent region (France opens from World). */
  parent?: Id;
  /** The region's area on the parent image (0–100%), for the zoom button. */
  frame?: [number, number, number, number];
}

export interface PlaceDef {
  name: string;
  room: Id;
  region: Id;
  /** Position on the region's image, in % [x, y]. */
  pos: [number, number];
  portrait?: Id;
  /** Vehicle drawn along the route. */
  vehicle?: 'car' | 'plane';
  /** "!" shown while this condition is true. */
  news?: Cond;
}

export interface MapDef {
  regions: Record<Id, MapRegion>;
  /** Region shown on opening. */
  start: Id;
  places: Record<Id, PlaceDef>;
  music?: Id;
  vehicles?: { car?: Id; plane?: Id; pin?: Id; news?: Id };
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

export interface GameRules {
  /** Fallback responses per verb (picked at random, never the same one twice in a row). `use2` = two items that don't go together. */
  fallbacks: Partial<Record<VerbId | 'use2', string[]>>;
  kinds?: KindRule[];
  /** Rules valid everywhere (e.g. combining two inventory items). */
  on?: Rule[];
}

export interface AudioDef {
  music?: Record<Id, string>;
  sfx?: Record<Id, string>;
}

/** Sealed ending (`ending` module): encrypted content, decrypted at the end of the game and shown on a card. */
export interface EndingDef {
  /** Encrypted file produced by `npm run seal`. */
  file: string;
  /** Password: typed by the player, or given to the engine (simpler, less secret). */
  password: { typed: true; prompt: string } | { given: string };
  /**
   * Player's guess, asked at the start (flag set by a script) and judged on the final card.
   * `labels` gives the word for each flag value; `{guess}` is replaced in the texts.
   */
  guess?: { flag: Id; labels: Record<string, string>; right: string; wrong: string; none: string };
  /** Params for the `scratch` minigame (the scratch ticket): `ticket` required, `sfx`, `color`… The hidden text comes from the sealed file. */
  scratch?: Record<string, unknown>;
  /** Final card: `accent` = color of the frame and scratched text (default #d4145a). */
  card?: { accent?: string };
}
/** Old name for EndingDef. */
export type RevealDef = EndingDef;

/**
 * UI skin: everything the engine shows or plays without the content referencing it.
 * Image ids come from the manifest; sounds are ids from `audio.sfx` (phone, plane, confetti)
 * or `audio.music` (jingle, end). A missing sound = silence.
 */
export interface SkinDef {
  icons: {
    /** Column buttons: map, pause, music. */
    map: Id; pause: Id; music: Id;
    /** Guided tutorial spark. */
    spark?: Id;
    /** Map: pin, "!" for news, vehicles (plane, car) (MapDef.vehicles replaces them where present). */
    pin?: Id; news?: Id; plane?: Id; car?: Id;
    /** Ending confetti (images drawn in alternation). */
    confetti?: Id[];
    /** Final card image when the sealed file has no photo. */
    cardFallback?: Id;
  };
  sounds?: { phone?: Id; plane?: Id; confetti?: Id; jingle?: Id; end?: Id };
  /** CSS font families (--font-ui and --font-pixel variables). Default: 'DotGothic16' and 'Press Start 2P'. */
  fonts?: { ui?: string; pixel?: string };
  /** Default heights for characters with no `height` (logical units). Default: actor 110, hero 84. */
  heights?: { actor?: number; hero?: number };
  /** Poses tried, in order, for a call's frame (`phone`). Default: phone, front, face, idle. */
  callPoses?: string[];
}

export interface GameDef {
  id: Id;
  title: string;
  /** Save format version. Bump it if the content changes incompatibly. */
  saveVersion: number;
  hero: Id;
  /** Inventory item that gives hints when talked to. */
  hintItem?: Id;
  /** Character who speaks during hints (often the plush toy, offscreen). */
  hintVoice?: Id;
  verbs: VerbDef[];
  characters: Record<Id, CharacterDef>;
  items: Record<Id, ItemDef>;
  rooms: RoomDef[];
  map?: MapDef;
  rules: GameRules;
  /** Topics added to every conversation. */
  globalTalk?: { hug?: string; bye?: string; byeLine?: string };
  start: { room: Id; inventory?: Id[]; flags?: Record<Id, Value>; unlocked?: Id[]; intro?: Cmd[] };
  audio?: AudioDef;
  /** UI skin (icons, sounds, fonts, default heights). */
  skin: SkinDef;
  /** Sealed ending, optional. */
  ending?: EndingDef;
  /** Ready-to-use states for testing a specific moment (teleport in dev mode, solver). */
  checkpoints?: Record<Id, { room: Id; inventory?: Id[]; flags?: Record<Id, Value>; unlocked?: Id[]; props?: Record<string, string> }>;
  /** Engine texts (menus, confirmations). The engine never hardcodes any text. */
  ui: UiTexts;
  /** Title screen: background image, logo, music, footer. */
  titleScreen?: { decor: Id; logo?: Id; music?: Id; footer?: string;
    /** Silent looping video behind the title (file in public/assets/video/), the backdrop serves as a poster. */
    video?: string };
  /** Credits background: same video as the title by default. */
  creditsScreen?: { video?: string; decor?: Id };
  /** End credits, line by line (an empty line = a blank space). */
  credits?: string[];
}

export interface UiTexts {
  walkTo: string;
  newGame: string;
  continue: string;
  confirmErase: string;
  yes: string;
  no: string;
  pause: string;
  resume: string;
  music: string;
  sfx: string;
  autosave: string;
  credits: string;
  restart: string;
  skip: string;
  rotate: string;
  rotateSub: string;
  mapTitle: string;
  mapLocked?: string;
  mapBack: string;
  world: string;
  zoomIn: string;
  arrival: string;
  pickUp: string;
  hangUp?: string;
  calling: string;
  loading: string;
  on: string;
  off: string;
  giveWhat: string;
  replay: string;
  miniGame: string;
  /** Runner minigame zones. */
  jump?: string;
  duck?: string;
  password?: string;
  /** Footer of the transcript panel ("▼ tap to continue"). */
  tapToContinue: string;
  /** Confirm button (sealed ending password). */
  ok: string;
}

// ---------------------------------------------------------------------------
// Geometry (layout/<room>.json, written by the editor)
// ---------------------------------------------------------------------------

export interface Layout {
  /** Floor bottom (logical y): computed approach points never go lower. Default FLOOR (395, core/define.ts). */
  floor?: number;
  /** Walkable zone: an outer polygon and holes (furniture). */
  walk?: { area: Point[]; holes?: Point[][] };
  /** Character scale by depth: [back y, scale], [front y, scale]. */
  scale?: [[number, number], [number, number]];
  /** Hero entry points (at least `default`). */
  entries?: Record<Id, Point>;
  hotspots?: Record<Id, { rect?: [number, number, number, number]; poly?: Point[]; approach?: Point; face?: 'left' | 'right' }>;
  /** Props: foot position (bottom-center) and height. `z` forces the depth line, `on` = placed on a piece of furniture. */
  props?: Record<Id, { x: number; y: number; h: number; z?: number; on?: boolean; flip?: boolean;
    /** Vertical mirror. */
    flipV?: boolean;
    /** Rotation in degrees, clockwise, around the foot point. */
    rot?: number;
    approach?: Point;
    /** Different position depending on state (e.g. stool pulled out). Missing fields fall back to the object's own. */
    states?: Record<string, { x: number; y: number; h?: number; z?: number; rot?: number; flip?: boolean; flipV?: boolean; approach?: Point }> }>;
  /** `z` forces the actor's layer (like a prop) instead of following their feet. */
  actors?: Record<Id, { x: number; y: number; h?: number; z?: number; flip?: boolean; approach?: Point }>;
}

// ---------------------------------------------------------------------------
// Game state (serialised as-is in the save)
// ---------------------------------------------------------------------------

export interface GameState {
  v: number;
  room: Id;
  inventory: Id[];
  flags: Record<Id, Value>;
  /** Prop states, key `room.prop`. */
  props: Record<string, string>;
  /** Actors moved, hidden or shown by script, key `room.actor`. */
  actors: Record<string, { x?: number; y?: number; pose?: string; facing?: 'left' | 'right'; visible?: boolean }>;
  /** Hero position per room. */
  hero: Record<Id, Point>;
  unlocked: Id[];
  visited: Record<Id, number>;
  /** Counters for once / nth / cycle / random blocks and list looks. */
  counters: Record<string, number>;
  seen: Record<string, 1>;
  /** Used inventory items (greyed out). Absent in old saves. */
  used?: Id[];
  started: number;
  done?: boolean;
}
