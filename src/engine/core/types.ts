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
 * - `{ actorIn: ['grandpa', 'garden'] }`: the character is in that room (one that moves: `CharacterDef.room`, `moveActor`).
 * - `{ player: 'laverne' }`: this character is the one the player controls now (`GameDef.players`).
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
  | { seen: string }
  | { actorIn: [Id, Id] }
  | { player: Id };

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
/**
 * One line of a list the engine draws from (a look list, a hint, the fallback answers): a plain string, keyed by its
 * position in translations, or `{ id, text }` (schema 3, `npm run ids -- --lines=all`), keyed by its id so that
 * inserting or moving a line never shifts its translation or voice clip (`audio.voices[id]` is its clip).
 */
export type ListLine = string | { id: Id; text: string };

export type Cmd =
  | string
  // --- speech
  | { say: [Who, string]; shout?: boolean;
      /** Stable id of the line (schema 3, `npm run ids -- --lines`): translations and voice clips are keyed by it, so
       *  inserting or moving a line never shifts them. A plain string line stays keyed by its owner and position. */
      id?: Id;
      /** A voice clip (`audio.voices`): the line stays as long as the clip plays, then moves on. Defaults to the
       *  line's `id` when `audio.voices` has a clip under it. */
      voice?: Id }
  // --- movement and poses
  | { walk: WalkTarget; who?: Who }
  | { face: 'left' | 'right' | Id; who?: Who }
  | { pose: [Who, string] }
  /** `at`: commands run when the animation reaches that frame (index in the pose's images, at the character's `fps`). */
  | { anim: [Who, string]; ms?: number; at?: Record<number, Cmd[]> }
  | { place: [Who, Point]; face?: 'left' | 'right' }
  | { wait: number }
  | { parallel: Cmd[][] }
  /**
   * Camera of a wide room (`Layout.width` > 640): follow the hero again, pan to a left edge x (animated over `ms`),
   * centre on something (`to`), or `reset` (= follow). Ignored in a 640-wide room.
   */
  | { camera: 'follow' | 'reset' | { pan: number; ms?: number } | { to: Id; ms?: number } }
  /** Plays a prop animation (`PropDef.anims`): waits for it to end, unless it loops. Its `at` commands run on the way. */
  | { play: [Id, string] }
  /** Stops a looping prop animation: the prop shows its state image again. */
  | { stopAnim: Id }
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
  /**
   * Moves a character to another room, where it must be declared as an actor (and placed in the layout). The character
   * needs a starting room (`CharacterDef.room`). `at`: an entry point or a point of that room; otherwise its layout position.
   */
  | { moveActor: [Id, Id]; at?: Id | Point }
  // --- events and scripts (EventRule, ScriptDef)
  /** Fires an event: the listeners of the current room, then of the game (`events`), run right here, in order. */
  | { emit: Id }
  /** In a script: pause until the condition holds. */
  | { waitUntil: Cond }
  /** In a script: pause until the event is emitted. */
  | { waitEvent: Id }
  // --- several playable characters (GameDef.players)
  /** The player now controls this character: the view moves to their room, their inventory shows. */
  | { switchPlayer: Id }
  /** Hands an item of the active character to another playable character (their own inventory). */
  | { transfer: [Id, Id] }
  /**
   * A command the game defines in code (`commands` exported by games/<id>/index.ts, see core/custom.ts): its declared
   * `effects` run here (the solver and the save know them), then its `run` draws whatever it wants in the browser.
   */
  | { custom: string; args?: unknown }
  /** Starts a script from its first command (again, if it was done or stopped). */
  | { startScript: Id }
  /** Stops a script; `startScript` brings it back. */
  | { stopScript: Id }
  // --- audio and effects
  | { sfx: Id }
  | { music: Id | { push: Id } | { pop: true } | { stop: true } | { once: Id } }
  | { toast: string; id?: Id }
  | { shake: number }
  // --- logic
  | { if: Cond; then: Cmd[]; else?: Cmd[] }
  | { once: Cmd[]; /** Stable persistence id (v3). */ id?: Id; /** @deprecated v2 alias. */ key?: string }
  | { nth: Cmd[][]; /** Stable persistence id (v3). */ id?: Id; /** @deprecated v2 alias. */ key?: string }
  | { cycle: Cmd[][]; /** Stable persistence id (v3). */ id?: Id; /** @deprecated v2 alias. */ key?: string }
  | { random: Cmd[][]; /** Stable persistence id (v3). */ id?: Id; /** @deprecated v2 alias. */ key?: string }
  // --- sequences and screens
  | { cutscene: Cmd[] }
  | { choice: Choice[] }
  | { minigame: Id; params?: Record<string, unknown>; then?: Cmd[] }
  /** Incoming call. A list = several callers in the same call (shown side by side). */
  | { phone: Who | Who[]; do: Cmd[] }
  | { guide: { verb: VerbId; target: Id; say: string }; id?: Id }
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
  /** Stable id used by saves, translations and voice production (required by schema v3). */
  id?: Id;
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
  /** Stable id used by saves, diagnostics and the puzzle graph (required by schema v3). */
  id?: Id;
  verb: VerbId | VerbId[];
  a: Id | Id[];
  b?: Id | Id[];
  if?: Cond;
  do: Cmd[];
  /** Generated from this exit of `RoomDef.exits` (core/define.ts): not written by the author. */
  exit?: Id;
}

/**
 * Reaction by "kind": applies to anything with this `kind` (e.g. `person`, `cat`), before fallback responses.
 * `target` targets a specific id (takes priority over `kind`), `item` restricts to a used/given item.
 * `{nom}` is replaced by the target's name, `{objet}` by the item.
 */
export interface KindRule {
  /** Stable id (schema 3, `npm run ids -- --lines`): its translation (`kinds.<id>.say`) and voice clip follow it. */
  id?: Id;
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
  /**
   * What the character looks like, in words, for the art prompts (`npm run prompts`, docs/en/PROMPTS.md): age, hair,
   * glasses, build, outfit, signature accessory, personality. Not shown in the game. The more specific, the more
   * consistent the character stays across sheets generated in different conversations.
   */
  description?: string;
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
  /**
   * Starting room of a character that moves between rooms (`moveActor`, `actorIn`): only its actor in that room shows
   * at first, the ones declared in other rooms wait for it. Without it, every actor of the character shows (the usual case).
   */
  room?: Id;
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
  /**
   * Palette swap: source colour → target colour, both `#rrggbb` (e.g. `{ '#492a25': '#b0592a' }`). The room view
   * recolours every sprite and mouth frame of the character once (offscreen canvas, cached), keeping alpha. Exact RGB
   * matches only, unless `paletteTolerance` is set. Exact colours survive best with the `pixel` art style (site.json
   * `artStyle`), whose cutter writes one exact value per material. Portraits in menus are not recoloured.
   */
  palette?: Record<string, string>;
  /**
   * RGB distance under which a pixel counts as a source colour of `palette` (default 0: exact matches only). With a
   * tolerance, the nearest source colour wins and the pixel keeps its offset from it, so painted (`cel`) art and lossy
   * WebP still recolour cleanly. Around 10 to 16 suits cel art; keep it below the distance to the outline colour.
   */
  paletteTolerance?: number;
  /**
   * Image sets depending on state: the first variant whose condition is true replaces sprites / mouths / portrait,
   * and `palette` / `paletteTolerance` when it has them (a variant with no palette keeps the character's).
   */
  variants?: { if: Cond; sprites?: SpriteSet; mouths?: Record<string, MouthSet>; portrait?: Id; palette?: Record<string, string>; paletteTolerance?: number }[];
}

export interface ItemDef {
  name: string;
  icon: Id;
  /** Looking at the item in the inventory. A list = a different line each time (looped). */
  look?: string | ListLine[];
  kind?: string[];
}

/** A prop in the scenery, with states (e.g. amp off/on). Its position comes from the layout. */
/** A prop animation: images in order at `fps` (default 8); `at` = commands run when a frame is reached (index). */
export interface PropAnim { frames: Id[]; fps?: number; loop?: boolean; at?: Record<number, Cmd[]> }

export interface PropDef {
  /** A single image, or one image per state. */
  img?: Id;
  states?: Record<string, Id>;
  /** Animations played by `{ play: [prop, name] }`; the prop goes back to its state image afterwards. */
  anims?: Record<string, PropAnim>;
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
  /** Generated from `RoomDef.exits` (core/define.ts): not written by the author. */
  exit?: boolean;
}

export interface TalkTopic {
  /** Stable id used by saves and translations (required by schema v3). */
  id?: Id;
  topic: string;
  if?: Cond;
  do: Cmd[];
}

/**
 * A way out of the room, declared rather than written as a hotspot plus a rule. The engine turns it into exactly that
 * (core/define.ts `normalizeExits`): a hotspot `id` (placed in the layout like any zone, kind `exit`) and, first in the
 * room's rules, "VERB id → goto". So everything else (look lines, other rules, the editor, the solver) sees a hotspot.
 * Declared exits also give the tools the map of the world (unreachable rooms, one-way passages).
 */
export interface ExitDef {
  name: string;
  to: Id;
  /** Entry point (layout `entries`) or point in the target room. */
  entry?: Id | Point;
  /** Passable only if… (otherwise `locked` is said, or the fallback). */
  if?: Cond;
  /** The hero's line when the exit is not passable yet. */
  locked?: string;
  /** Verbs that take the exit. Default: use, open, walk, go, enter, push, pull (those the game has). */
  verbs?: VerbId[];
  /** Sound played when leaving. */
  sfx?: Id;
  visible?: Cond;
  kind?: string[];
  /** The player cannot come back this way: the tools stop reporting it as a missing way back. */
  oneWay?: boolean;
}

export interface HintDef {
  /** Stable id (schema 3, `npm run ids -- --lines`): translations follow it (`hints.<id>.lines…`), not its position. */
  id?: Id;
  /** The hint holds as long as this condition is false. The first unsatisfied hint is given. */
  until: Cond;
  lines: ListLine[];
}

/**
 * A script of the world: it runs on its own, without a player action, one command at a time, in the gaps between the
 * player's actions (never during one, a cutscene, a conversation or a minigame). A room's scripts run while the player
 * is in the room; the game's scripts run everywhere. Its position is saved: it resumes where it was.
 */
export interface ScriptDef {
  /** Unique in the whole game. */
  id: Id;
  /** Runs only while this holds; when false, the script rewinds and waits. */
  while?: Cond;
  /** Starts again from the top when done. A loop needs a `wait`, `waitUntil` or `waitEvent`. */
  loop?: boolean;
  do: Cmd[];
  /** Stable id of each command in `do`, at the matching position (required by schema v3). */
  stepIds?: Id[];
}

/** A listener: when `on` is emitted (`{ emit }`) and the condition holds, `do` runs. `once`: only the first time. */
export interface EventRule {
  /** Stable id used by saves and diagnostics (required by schema v3). */
  id?: Id;
  on: Id;
  if?: Cond;
  once?: boolean;
  do: Cmd[];
}

export interface RoomDef {
  id: Id;
  name: string;
  /** Background image. */
  decor: Id;
  /**
   * What the background shows, left to right, with its light and mood: the LOCATION line of the background prompt
   * (`npm run prompts`, docs/en/PROMPTS.md). Not shown in the game.
   */
  description?: string;
  /**
   * Furniture drawn on its own sheet rather than painted into the decor (image ids, e.g. `furniture_dining/table`), so
   * the engine can depth-sort it with the characters. Props whose image lives in a `furniture_*` folder are counted
   * anyway; list here the pieces no prop uses yet. Only read by `npm run prompts`.
   */
  furniture?: Id[];
  music?: Id;
  props?: Record<Id, PropDef>;
  actors?: Record<Id, ActorDef>;
  hotspots?: Record<Id, HotspotDef>;
  /** Ways out (see ExitDef): hotspots with a goto rule, and the world's map for the tools. */
  exits?: Record<Id, ExitDef>;
  /** Look: a line, or a list (looped). Anything visible should have one. */
  look?: Record<Id, string | ListLine[]>;
  on?: Rule[];
  /** Conversation topics per actor (2 or 3). "Want a hug?" and "Bye" are added by the game. */
  talk?: Record<Id, TalkTopic[]>;
  hints?: HintDef[];
  onEnter?: Cmd[];
  /** Scripts that run on their own while the player is in the room (see ScriptDef). */
  scripts?: ScriptDef[];
  /** Listeners of the room's events, then of the game's (see EventRule). */
  events?: EventRule[];
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
  fallbacks: Partial<Record<VerbId | 'use2', ListLine[]>>;
  kinds?: KindRule[];
  /** Rules valid everywhere (e.g. combining two inventory items). */
  on?: Rule[];
}

export interface AudioDef {
  music?: Record<Id, string>;
  sfx?: Record<Id, string>;
  /** Voice clips (`games/<id>/audio/voice/<file>`), played by `say` with `voice`. */
  voices?: Record<Id, string>;
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
  /** CSS font families (--font-ui and --font-pixel variables). Default: 'DotGothic16' and 'Press Start 2P'. `readable`: the "readable font" setting (e.g. a dyslexia-friendly family the game ships). */
  fonts?: { ui?: string; pixel?: string; readable?: string };
  /** Default heights for characters with no `height` (logical units). Default: actor 110, hero 84. */
  heights?: { actor?: number; hero?: number };
  /** Poses tried, in order, for a call's frame (`phone`). Default: phone, front, face, idle. */
  callPoses?: string[];
  /**
   * Pixel-art game (site.json `artStyle: "pixel"`): images scaled up by the browser keep hard edges
   * (`image-rendering: pixelated` on the scene's images) instead of being smoothed. Default off.
   */
  pixelArt?: boolean;
}

export interface GameDef {
  /** Authoring schema. Version 3 requires stable ids and is compiled before use. Omitted means legacy v2 content. */
  schemaVersion?: 2 | 3;
  id: Id;
  title: string;
  /** Language of the content as written (BCP 47, e.g. 'en', 'fr'). Translations: `locales/<lang>.json` (tools/i18n.ts). */
  lang?: string;
  /** Save format version. Bump it if the content changes incompatibly. */
  saveVersion: number;
  hero: Id;
  /**
   * Several playable characters (Day of the Tentacle style). `hero` is the one controlled first. Each has their own
   * room, position and inventory (unless `sharedInventory`); `{ switchPlayer }`, the switch buttons and `{ transfer }`
   * move between them. A character declared as an actor in a room stands for that player there when they are not
   * active; otherwise the engine shows the inactive players standing where they are.
   */
  players?: {
    ids: Id[];
    sharedInventory?: boolean;
    /** Where the others start (default: the start room, nothing in hand). */
    start?: Record<Id, { room: Id; inventory?: Id[] }>;
    /** Line said when an item is handed to another player with no written rule ({objet}, {nom}). Default English. */
    give?: string;
  };
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
  /** Scripts that run everywhere (see ScriptDef). */
  scripts?: ScriptDef[];
  /** Listeners of the game's events, after the room's (see EventRule). */
  events?: EventRule[];
  /** Topics added to every conversation. */
  globalTalk?: { hug?: string; bye?: string; byeLine?: string };
  start: { room: Id; inventory?: Id[]; flags?: Record<Id, Value>; unlocked?: Id[]; intro?: Cmd[] };
  audio?: AudioDef;
  /** UI skin (icons, sounds, fonts, default heights). */
  skin: SkinDef;
  /** Sealed ending, optional. */
  ending?: EndingDef;
  /**
   * Ready-to-use states for testing a specific moment (teleport in dev mode, solver). A checkpoint with `goals` is the
   * end of a chapter: `npm run solve -- --chapters` proves each chapter from the previous checkpoint until its goals hold.
   */
  checkpoints?: Record<Id, { room: Id; inventory?: Id[]; flags?: Record<Id, Value>; unlocked?: Id[]; props?: Record<string, string>;
    /** Where the moving characters are (character → room); the others are in their starting room. */
    where?: Record<Id, Id>;
    /** Conditions that must all hold when the chapter ending here is done (solver `--chapters`). */
    goals?: Cond[];
    /** Several playable characters: who is active, and where the others are. */
    active?: Id;
    players?: Record<Id, { room: Id; inventory?: Id[]; used?: Id[] }>;
    /** Items already used (`used` once/`used` conditions) and topics / listeners / choices already seen (`seen`
     *  keys by id): a checkpoint that the proof by chapters recognises as a reachable boundary state names them. */
    used?: Id[];
    seen?: Record<string, 1> }>;
  /** Conditions that must never become true (the solver reports the path that makes one true). */
  invariants?: Cond[];
  /** Manual save slots (pause menu: save, load, export, import). Absent or 0: autosave only. */
  saves?: { slots: number };
  /**
   * A Settings entry in the pause menu: text speed and size, reduced motion (no shake, instant camera and fades),
   * readable font (`skin.fonts.readable`), music / sound / voice volumes. Kept in the browser, outside the save.
   */
  settings?: boolean;
  /**
   * What the game caches for offline play. `full` (default): after the current room and its neighbours, every image
   * and sound of the game is fetched in the background, in batches, so the whole game plays offline after the first
   * visit (skipped on a "save data" or 2G connection; music waits for better than 3G). `nearby`: only the current
   * room and its neighbours, a room never visited may need the network.
   */
  offline?: 'full' | 'nearby';
  /** Content lint (`npm run lint`): codes to silence, as `code`, `code:<stable id>` or `code:<room>/<path>`. */
  lint?: { ignore?: string[] };
  /** Translation paths whose text stays the same in every language on purpose (a name, "OK", ▲): every other text
   *  identical to the source is an untranslated line and fails `npm run i18n -- status`. */
  i18n?: { same?: string[] };
  /**
   * Background-preload batch sizes (per step, not totals: `initialImages`, `neighboringRooms`, `audioFiles`), and the
   * weight budgets in KB that `npm run weight` holds the game to: before the first room is playable (`initialKB`), per
   * room (`roomKB`), per chapter (`chapterKB`, every room a player can be in during it). The batch sizes never affect the
   * assets required to render the current room.
   */
  assetBudgets?: { initialImages?: number; neighboringRooms?: number; audioFiles?: number; initialKB?: number; roomKB?: number; chapterKB?: number };
  /**
   * How to bring an older save up to date, one step per version, as data: renames and drops. A save whose version has
   * no migration starts a new game (as before). The chain must reach `saveVersion`.
   */
  migrations?: Migration[];
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

/** One step of save migration: from version `from` to `from + 1`. Keys are old ids, values new ones. */
export interface Migration {
  from: number;
  renameFlag?: Record<Id, Id>;
  renameItem?: Record<Id, Id>;
  renameRoom?: Record<Id, Id>;
  /** `room.prop` → `room.prop`. */
  renameProp?: Record<string, string>;
  /** `room.actor` → `room.actor`. */
  renameActor?: Record<string, string>;
  renamePlace?: Record<Id, Id>;
  /** Persistent v3 ids. */
  renameCounter?: Record<Id, Id>;
  renameSeen?: Record<Id, Id>;
  renameScript?: Record<Id, Id>;
  /** Script id → old step id → new step id. */
  renameScriptStep?: Record<Id, Record<Id, Id>>;
  renamePlayer?: Record<Id, Id>;
  renameCharacter?: Record<Id, Id>;
  dropFlag?: Id[];
  dropItem?: Id[];
  dropCounter?: Id[];
  dropSeen?: Id[];
  dropScript?: Id[];
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
  // --- manual saves (`GameDef.saves`); English defaults when absent
  save?: string;
  load?: string;
  /** "Slot {n}" ({n} replaced). */
  slot?: string;
  emptySlot?: string;
  exportSave?: string;
  importSave?: string;
  /** The session file (the inputs since the game started: a bug report `npm run replay` reproduces). */
  exportSession?: string;
  confirmOverwrite?: string;
  /** Visible warning when the browser refuses or loses a save write. */
  saveFailed?: string;
  /** The pause menu's "Share session" row (Web Share, else a download): a playtest file for `npm run playtests`. */
  shareSession?: string;
  /** Label of the "tap to continue" marker for screen readers (Space / Enter advance a line). English default. */
  advance?: string;
  /** ARIA label of the verb bar (English default "Verbs"). */
  verbs?: string;
  /** Prefix shown when obsolete references were removed from an otherwise valid save. */
  saveAdjusted?: string;
  /** The pause menu's offline row: its label, the word for a complete cache, the word that invites a retry. English defaults. */
  offlineStatus?: string;
  offlineComplete?: string;
  offlineRetry?: string;
  /** Prompt displayed when a new PWA build is ready. */
  updateAvailable?: string;
  updateNow?: string;
  // --- settings (`GameDef.settings`); English defaults when absent
  settings?: string;
  textSpeed?: string;
  textSize?: string;
  reduceMotion?: string;
  readableFont?: string;
  volumeMusic?: string;
  volumeSfx?: string;
  volumeVoice?: string;
  /** Language row of the settings menu (when the game ships translations). */
  language?: string;
  /** Values of text speed / size: slow, normal, fast, large. */
  slow?: string;
  normal?: string;
  fast?: string;
  large?: string;
}

// ---------------------------------------------------------------------------
// Geometry (layout/<room>.json, written by the editor)
// ---------------------------------------------------------------------------

export interface Layout {
  /** Width of the room in logical units (default 640): wider, the room scrolls and a camera follows the hero. */
  width?: number;
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
  /** Room of each moving character (`CharacterDef.room`, `moveActor`). Absent in old saves. */
  where?: Record<Id, Id>;
  /** Position of each script: next command, finished, stopped. Absent in old saves. */
  scripts?: Record<Id, { pc: number; /** Stable next-step id in schema v3 saves. */ step?: Id; done?: boolean; off?: boolean }>;
  /** Camera of the current room: left edge x, or following the hero. */
  camera?: { x: number; follow: boolean };
  /** The character the player controls (`GameDef.players`; otherwise `hero`). */
  active?: Id;
  /** The other playable characters: their room, positions and inventory (the active one lives in the flat fields). */
  players?: Record<Id, { room: Id; inventory: Id[]; hero: Record<Id, Point>; used?: Id[] }>;
  started: number;
  done?: boolean;
}

// ---------------------------------------------------------------------------
// Session: the player's inputs since the game started (or a save was loaded), enough to replay them
// ---------------------------------------------------------------------------

/** A player action: VERB a (with/to b). `a` can be an inventory item, `b` is always a target. */
export interface Action { verb: VerbId; a: Id; b?: Id }

/**
 * One input of a session (`Engine.session`). The answers given while it ran (`picks`, `maps`, `rnd`) are what makes it
 * replayable; `ran` lists the rules, topics, listeners and scripts that answered (the ids of the puzzle graph).
 */
export type SessionEntry = (
  | { act: Action; /** The walk to the target was interrupted: nothing happened. */ aborted?: true }
  | { travel: Id }
  | { switch: Id }
  | { map: true }
  | { step: Id }
  | { script: Cmd[] }
  | { enter: Id }
  | { start: 'new' }
) & {
  picks?: number[]; maps?: (Id | null)[]; rnd?: number[];
  /** `skip()` was called after that many commands. */
  skipAt?: number;
  ran?: string[];
  /** The state after the entry (`stateDigest`), to spot where a replay diverges. */
  digest?: string;
  /** Milliseconds since the session started (`Engine.clock`; absent in the solver and the tests): playtests read it, replay ignores it. */
  t?: number;
};

export interface Session {
  v: number;
  /** How it started: a new game (the intro's answers are in the first entry), a save, a checkpoint. */
  start: { kind: 'new' } | { kind: 'load' } | { kind: 'checkpoint'; id: Id };
  /** The state it started from. */
  base: GameState;
  log: SessionEntry[];
  /** When it started (epoch ms), when a clock was set. */
  at?: number;
}
