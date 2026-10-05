// The contract between the room's scene model (dom/room.ts: who is where, which image, the camera, walking, mouths,
// the hit test) and what paints it. The model works in logical units (640 × 400 per screen, wider rooms scroll) and
// hands the painter finished sprites; the painter only draws. The DOM painter (dom/render-dom.ts) is the reference;
// a Canvas painter implements the same contract (D10). Hit tests, walking and every logical decision stay in the
// model, so two painters cannot disagree on what a tap touches.
import type { Id, Point } from '../core/types';

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

/** A stage layer, resolved: its image, its box in the room (logical units, before parallax), its depth and look. */
export interface LayerSpec {
  id: Id; url: string; role: 'backdrop' | 'scenery' | 'foreground' | 'effect';
  x: number; y: number; w: number; h: number; z: number;
  /** Per axis: 1 moves with the room, below 1 slower (further), above 1 faster (nearer). */
  parallax: [number, number];
  blend: 'normal' | 'multiply' | 'screen' | 'overlay';
  opacity: number;
  visible: boolean;
}
/** What hides a character deeper than `z`: the backdrop's pixels (or a layer's) inside a polygon, a mask image or a layer's alpha. */
export interface OccluderSpec {
  id: Id; z: number;
  polygon?: Point[];
  /** A black-and-white mask (white hides), stretched over the backdrop's box. */
  mask?: string;
  /** A layer whose own pixels hide (its alpha is the mask). */
  layer?: Id;
  feather: number; invert: boolean;
}
export interface LightSpec { id: Id; kind: 'radial' | 'ambient'; color: string; intensity: number; blend: 'screen' | 'multiply'; at?: Point; radius?: number; visible: boolean }
export interface EmitterSpec { id: Id; kind: 'dust' | 'rain' | 'snow' | 'sparks' | 'smoke' | 'leaves'; url?: string; color: string; rate: number; area: [number, number, number, number]; visible: boolean }
/** Everything a room shows besides its sprites (`RoomDef.stage`, normalized by `stageOf`, conditions evaluated by the model). */
export interface StageSpec {
  /** The backdrop's box in the room (`object-fit: cover` over the room's width and 400): layers and masks align on it. */
  backdrop: { url: string; x: number; y: number; w: number; h: number };
  layers: LayerSpec[];
  occluders: OccluderSpec[];
  lights: LightSpec[];
  emitters: EmitterSpec[];
  /** No particles, no parallax (`prefers-reduced-motion`, the settings). */
  reduceMotion: boolean;
}

export interface SceneRenderer {
  /** The scene's root element: the painter's surface, and the layer the accessible targets go in. Moves with the camera. */
  readonly el: HTMLElement;
  /** A new room: its backdrop and logical width. Clears every sprite. */
  reset(backdrop: string, width: number): void;
  /** Adds or updates a sprite. */
  sprite(s: SpriteSpec): void;
  /** The camera: its left and top edges (logical units) and its zoom (1: a 640 × 400 view; 1.5: a 427 × 267 one). */
  camera(x: number, width: number, y?: number, zoom?: number): void;
  /** Pixels per logical unit. */
  resize(u: number): void;
  /** The room's stage (after `reset`, and again when a condition changes what shows). */
  stage(s: StageSpec): void;
  dispose(): void;
}
