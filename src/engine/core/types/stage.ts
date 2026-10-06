// The stage of a room (layers, lights, particles, transitions) and its layout (where things stand, walk areas). (core/types.ts re-exports every name; 4.1.0 "Clarity".)
import type { Cond, Id, Point } from './content';

// ---------------------------------------------------------------------------
// Stagecraft (3.4): what a room shows beyond its backdrop. The content says what exists and when (ids, images,
// conditions); the layout says where (geometry); the painter draws it. Nothing here changes the game's state: a layer,
// a light or a link is never a puzzle by itself (a gated link is a way to walk, its puzzle is a rule).
// ---------------------------------------------------------------------------

/** A picture of the room: `backdrop` behind everything, `scenery` among the characters (depth from its layout `z`),
 *  `foreground` in front of them, `effect` above all (fog, a vignette). */
export interface StageLayer {
  /** Stable id: its geometry is `layout.layers[id]`, a mask can be its alpha (`occluders[].layer`). */
  id: Id;
  image: Id;
  role: 'backdrop' | 'scenery' | 'foreground' | 'effect';
  /** Shown only while this holds (a window lit at night, a curtain drawn). */
  visible?: Cond;
}

export interface LightDef {
  id: Id;
  /** `radial`: a pool of light at `layout.lights[id]`; `ambient`: a colour over the whole room. */
  kind: 'radial' | 'ambient';
  color: string;
  /** 0–1 (default 0.6). */
  intensity?: number;
  /** `screen` brightens (a lamp), `multiply` darkens (night, a shadow). Default: `screen` for radial, `multiply` for ambient. */
  blend?: 'screen' | 'multiply';
  visible?: Cond;
}

export interface EmitterDef {
  id: Id;
  kind: 'dust' | 'rain' | 'snow' | 'sparks' | 'smoke' | 'leaves';
  /** A particle image (a manifest id); default a small dot of `color`. */
  image?: Id;
  color?: string;
  /** Particles per second (default by kind). */
  rate?: number;
  visible?: Cond;
}

export type TransitionKind = 'cut' | 'fade' | 'wipe';

export interface StageDef {
  layers?: StageLayer[];
  lights?: LightDef[];
  emitters?: EmitterDef[];
  /** How the room appears when entered (default `cut`). `reduceMotion` makes every transition a cut. */
  transition?: TransitionKind | { kind: TransitionKind; ms?: number };
  /** The logic of walk links (`layout.walkLinks`): a link whose `if` does not hold cannot be walked. */
  links?: Record<Id, { if?: Cond /** Said when the hero tries it while it is closed. */; locked?: string }>;
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
  hotspots?: Record<
    Id,
    { rect?: [number, number, number, number]; poly?: Point[]; approach?: Point; face?: 'left' | 'right' }
  >;
  /** Props: foot position (bottom-center) and height. `z` forces the depth line, `on` = placed on a piece of furniture. */
  props?: Record<
    Id,
    {
      x: number;
      y: number;
      h: number;
      z?: number;
      on?: boolean;
      flip?: boolean;
      /** Vertical mirror. */
      flipV?: boolean;
      /** Rotation in degrees, clockwise, around the foot point. */
      rot?: number;
      approach?: Point;
      /** Different position depending on state (e.g. stool pulled out). Missing fields fall back to the object's own. */
      states?: Record<
        string,
        {
          x: number;
          y: number;
          h?: number;
          z?: number;
          rot?: number;
          flip?: boolean;
          flipV?: boolean;
          approach?: Point;
        }
      >;
    }
  >;
  /** `z` forces the actor's layer (like a prop) instead of following their feet. */
  actors?: Record<Id, { x: number; y: number; h?: number; z?: number; flip?: boolean; approach?: Point }>;
  /** Stage layers' geometry (`RoomDef.stage.layers`): top-left corner, depth line, parallax factor per axis (1: moves
   *  with the room, 0.5: half as fast, behind; 1.2: faster, in front), blend mode and opacity. */
  layers?: Record<
    Id,
    {
      x?: number;
      y?: number;
      z?: number;
      parallax?: [number, number];
      blend?: 'normal' | 'multiply' | 'screen' | 'overlay';
      opacity?: number;
    }
  >;
  /** What hides a character standing behind it (a pillar, a counter, a window frame): a polygon, a black-and-white
   *  mask image, or a stage layer's alpha, drawn over whatever stands deeper than `z` (canvas painter). */
  occluders?: Record<Id, { polygon?: Point[]; mask?: Id; layer?: Id; z: number; feather?: number; invert?: boolean }>;
  /** Several walkable floors (3.4): replaces `walk` when present. Each zone has its own depth scale and camera zoom. */
  walkZones?: Record<
    Id,
    {
      area: Point[];
      holes?: Point[][];
      scale?: [[number, number], [number, number]];
      elevation?: number;
      zoom?: number;
    }
  >;
  /** How to go from one zone to another: walking, stairs, a ladder, a jump, a teleport; its logic is in
   *  `RoomDef.stage.links[id]`. */
  walkLinks?: Record<
    Id,
    {
      from: { zone: Id; at: Point };
      to: { zone: Id; at: Point };
      mode: 'walk' | 'stairs' | 'ladder' | 'jump' | 'teleport';
      anim?: string;
      ms?: number;
      facing?: 'left' | 'right';
      oneWay?: boolean;
    }
  >;
  /** Where the radial lights are (`RoomDef.stage.lights`). */
  lights?: Record<Id, { at: Point; radius: number }>;
  /** Where particles appear (`RoomDef.stage.emitters`): a rectangle [x, y, w, h]. */
  emitters?: Record<Id, { area: [number, number, number, number] }>;
}
