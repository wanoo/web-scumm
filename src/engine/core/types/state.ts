// The state of a game in progress: what a save holds. (core/types.ts re-exports every name; 4.1.0 "Clarity".)
import type { Id, Point, Value } from './content';

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
  scripts?: Record<
    Id,
    { pc: number /** Stable next-step id in schema v3 saves. */; step?: Id; done?: boolean; off?: boolean }
  >;
  /** Camera of the current room: left edge x, or following the hero. */
  camera?: { x: number; follow: boolean };
  /** The character the player controls (`GameDef.players`; otherwise `hero`). */
  active?: Id;
  /** The other playable characters: their room, positions and inventory (the active one lives in the flat fields). */
  players?: Record<Id, { room: Id; inventory: Id[]; hero: Record<Id, Point>; used?: Id[] }>;
  started: number;
  done?: boolean;
  /** Where the music was when this was saved (3.6): its track and its position in the file, in seconds. Written by the
   *  player's app, read back by it to resume the music there; the engine and the tools never read it. */
  music?: { id: Id; at: number };
}
