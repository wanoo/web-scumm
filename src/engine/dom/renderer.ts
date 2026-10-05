// The contract between the room's scene model (dom/room.ts: who is where, which image, the camera, walking, mouths,
// the hit test) and what paints it. The model works in logical units (640 × 400 per screen, wider rooms scroll) and
// hands the painter finished sprites; the painter only draws. The DOM painter (dom/render-dom.ts) is the reference;
// a Canvas painter implements the same contract (D10). Hit tests, walking and every logical decision stay in the
// model, so two painters cannot disagree on what a tap touches.
import type { Id } from '../core/types';

/** One thing drawn in the scene, in logical units. `fx, fy`: its feet (bottom centre), the pivot of rotations. */
export interface SpriteSpec {
  id: Id;
  /** The image to draw (already palette-swapped), or null when the entity has nothing to show. */
  url: string | null;
  fx: number; fy: number; w: number; h: number;
  /** Lifted above the feet (a talking character's bob), drawn higher without moving the feet. */
  bob: number;
  /** Depth: higher is in front. */
  z: number;
  flip: boolean; flipV: boolean;
  /** Degrees, clockwise, around the feet. */
  rot: number;
  visible: boolean;
  /** 0–1, for fades (`show` with `fade`). */
  opacity: number;
  /** A CSS filter for a glow (`CharacterDef.glow`). */
  filter?: string;
  /** The shadow under a character (none for props). */
  shadow?: { x: number; y: number; w: number; h: number; z: number; visible: boolean };
}

export interface SceneRenderer {
  /** The scene's root element: the painter's surface, and the layer the accessible targets go in. Moves with the camera. */
  readonly el: HTMLElement;
  /** A new room: its backdrop and logical width. Clears every sprite. */
  reset(backdrop: string, width: number): void;
  /** Adds or updates a sprite. */
  sprite(s: SpriteSpec): void;
  /** The camera's left edge, logical units. */
  camera(x: number, width: number): void;
  /** Pixels per logical unit. */
  resize(u: number): void;
  dispose(): void;
}
