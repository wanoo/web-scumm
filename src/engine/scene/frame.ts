// The scene frame (4.1.11 "Viewport", ADR 0011): an immutable picture of a room in logical units (640 × 400 per
// screen), made by a pure function from the state, the layouts and what the presentation animates (where each entity
// stands now, which image it shows, the camera). The room view (dom/room.ts) makes one and paints it; a renderer
// (`Renderer` below) only draws a frame and sends back intentions (`Intent`), never a state (D21). The hit test is
// precomputed here, from the same boxes the painter draws, so two painters cannot disagree on what a tap touches.
// Pure: no DOM, no engine; the painter's specs are imported as types only.
import { inPolygon } from '../core/stage';
import type { GameState, Id, Layout, Point } from '../core/types';
import type { EmitterSpec, LayerSpec, LightSpec, OccluderSpec, SpriteSpec, StageSpec } from '../dom/renderer';

/** Where the camera looks: its left and top edges, its zoom, and the room's logical width. */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  width: number;
}

/** One layer of the frame, in the order a painter adds them (a painter sorts by `z` to draw). */
export type RenderLayer =
  | { kind: 'backdrop'; id: Id; z: number; url: string; x: number; y: number; w: number; h: number }
  | { kind: 'layer'; id: Id; z: number; layer: LayerSpec }
  | { kind: 'occluder'; id: Id; z: number; occluder: OccluderSpec }
  | { kind: 'prop'; id: Id; z: number; order: number; sprite: SpriteSpec };

/** A character in the frame: who, where, which way, whether it speaks or walks, and its sprite. */
export interface RenderActor {
  id: Id;
  /** The character sheet it is drawn from. */
  cell?: Id;
  at: Point;
  facing: 'left' | 'right';
  speaking: boolean;
  moving: boolean;
  /** Arrival in the room: the order its sprite was first painted (the DOM painter's element order). */
  order: number;
  sprite: SpriteSpec;
}

/**
 * Something a tap or a key can target: its id, its shape in logical units (a polygon from the layout, else the box
 * of what is drawn, rotation included), the box the accessible button covers, the area that ranks overlapping
 * targets (the smallest wins), its default verb and its accessible label.
 */
export interface RenderHotspot {
  id: Id;
  polygon: Point[];
  /** `poly`: the layout's polygon decides; `box`: the box, edges included (the rule since 3.4). */
  shape: 'poly' | 'box';
  box: [number, number, number, number];
  area: number;
  verb?: Id;
  label: string;
}

/** What the stage adds over the picture: lights, particles, the transition the room enters with. */
export type RenderEffect =
  | { kind: 'light'; light: LightSpec }
  | { kind: 'emitter'; emitter: EmitterSpec }
  | { kind: 'transition'; transition: { kind: 'cut' | 'fade' | 'wipe'; ms: number } };

/**
 * A room as it is to be drawn: immutable, in logical units. `hash` digests the rest: a renderer skips a frame equal to
 * the last one.
 * @extension
 */
export interface SceneFrame {
  readonly hash: string;
  readonly room: Id;
  readonly camera: CameraState;
  readonly layers: readonly RenderLayer[];
  readonly actors: readonly RenderActor[];
  readonly hotspots: readonly RenderHotspot[];
  readonly effects: readonly RenderEffect[];
  /** No particles, no parallax (`prefers-reduced-motion`, the settings). */
  readonly reduceMotion: boolean;
}

/**
 * What a renderer sends the engine's side: the only thing it may (D21). A tap on a target with the verb the player
 * chose (`act`, with `item` when one is used on it), a walk to a point of the floor, a pick in a choice, a skip, a
 * screen opened.
 * @extension
 */
export type Intent =
  | { kind: 'act'; verb: Id; target: Id; item?: Id }
  | { kind: 'walk'; to: Point }
  | { kind: 'pick'; choice: number }
  | { kind: 'skip' }
  | { kind: 'open'; what: 'map' | 'inventory' | 'menu' };

/**
 * A renderer: mounted in an element, given frames, it tells its intentions. The DOM and Canvas painters are wrapped
 * as one (dom/frame-renderer.ts); `NullRenderer` (scene/null-renderer.ts) draws nothing, for tests and headless runs.
 * @extension
 */
export interface Renderer {
  mount(root: HTMLElement): void;
  render(frame: SceneFrame): void;
  onIntent(f: (i: Intent) => void): void;
  unmount(): void;
}

/** One entity of the room as the presentation has it now (its sprite already resolved by the room view). */
export interface FrameEntity {
  id: Id;
  kind: 'prop' | 'actor' | 'hero';
  cell?: Id;
  sprite: SpriteSpec;
  /** The box a tap is tested against (rotation included), when the entity shows an image. */
  bbox?: [number, number, number, number];
  moving: boolean;
}

/** What the presentation hands `sceneFrame`: the stage, the camera, the entities in arrival order, the targets. */
export interface FrameInput {
  stage: StageSpec;
  camera: CameraState;
  entities: readonly FrameEntity[];
  /** The targets the room offers now (the engine's `targets`), with their label and default verb. */
  targets: readonly { id: Id; label: string; verb?: Id | null }[];
  talking: Id | null;
  transition: { kind: 'cut' | 'fade' | 'wipe'; ms: number };
}

/** FNV-1a over a string (the frame's hash). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const bounds = (poly: Point[]): [number, number, number, number] => {
  const xs = poly.map((p) => p[0]),
    ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
const corners = ([x, y, w, h]: [number, number, number, number]): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/**
 * The frame of the current room. Pure: the same state, layouts and presentation give the same frame (and hash).
 * A target's box is its drawn entity's when it shows an image, else the layout's rectangle, else its polygon's bounds;
 * a target with none of them is not in the frame (nothing to tap).
 */
export function sceneFrame(state: GameState, layouts: Record<Id, Layout>, anim: FrameInput): SceneFrame {
  const L = layouts[state.room] ?? {};
  const st = anim.stage;
  const layers: RenderLayer[] = [
    { kind: 'backdrop', id: 'backdrop', z: -1e9, ...st.backdrop },
    ...st.layers.map((l): RenderLayer => ({ kind: 'layer', id: l.id, z: l.z, layer: l })),
    ...st.occluders.map((o): RenderLayer => ({ kind: 'occluder', id: o.id, z: o.z, occluder: o })),
  ];
  const actors: RenderActor[] = [];
  const drawn = new Map<Id, [number, number, number, number]>();
  anim.entities.forEach((e, order) => {
    if (e.bbox && e.sprite.url) drawn.set(e.id, e.bbox);
    if (e.kind === 'prop') layers.push({ kind: 'prop', id: e.id, z: e.sprite.z, order, sprite: e.sprite });
    else
      actors.push({
        id: e.id,
        ...(e.cell ? { cell: e.cell } : {}),
        at: [e.sprite.fx, e.sprite.fy],
        facing: e.sprite.flip ? 'left' : 'right',
        speaking: anim.talking === e.id,
        moving: e.moving,
        order,
        sprite: e.sprite,
      });
  });
  const hotspots: RenderHotspot[] = [];
  for (const t of anim.targets) {
    const hs = L.hotspots?.[t.id];
    const box = drawn.get(t.id) ?? hs?.rect ?? (hs?.poly ? bounds(hs.poly) : undefined);
    if (!box) continue;
    hotspots.push({
      id: t.id,
      polygon: hs?.poly ? hs.poly.map((p) => [p[0], p[1]] as Point) : corners(box),
      shape: hs?.poly ? 'poly' : 'box',
      box: [box[0], box[1], box[2], box[3]],
      area: box[2] * box[3],
      ...(t.verb ? { verb: t.verb } : {}),
      label: t.label,
    });
  }
  const effects: RenderEffect[] = [
    ...st.lights.map((light): RenderEffect => ({ kind: 'light', light })),
    ...st.emitters.map((emitter): RenderEffect => ({ kind: 'emitter', emitter })),
    { kind: 'transition', transition: anim.transition },
  ];
  const body = {
    room: state.room,
    camera: anim.camera,
    layers,
    actors,
    hotspots,
    effects,
    reduceMotion: st.reduceMotion,
  };
  return { hash: fnv(JSON.stringify(body)), ...body };
}

/** What a tap at `p` touches in a frame: the smallest target that contains it (null: the floor). */
export function hitTest(frame: SceneFrame, p: Point): Id | null {
  let best: Id | null = null,
    area = Infinity;
  for (const h of frame.hotspots) {
    const [x, y, w, hh] = h.box;
    const inside =
      h.shape === 'poly' ? inPolygon(p, h.polygon) : p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + hh;
    if (inside && h.area < area) {
      best = h.id;
      area = h.area;
    }
  }
  return best;
}

/** The stage a frame shows, as a painter's `stage()` takes it (layers and occluders in their order). */
export function stageOfFrame(f: SceneFrame): StageSpec {
  const b = f.layers.find((l) => l.kind === 'backdrop');
  return {
    backdrop:
      b?.kind === 'backdrop' ? { url: b.url, x: b.x, y: b.y, w: b.w, h: b.h } : { url: '', x: 0, y: 0, w: 0, h: 0 },
    layers: f.layers.flatMap((l) => (l.kind === 'layer' ? [l.layer] : [])),
    occluders: f.layers.flatMap((l) => (l.kind === 'occluder' ? [l.occluder] : [])),
    lights: f.effects.flatMap((e) => (e.kind === 'light' ? [e.light] : [])),
    emitters: f.effects.flatMap((e) => (e.kind === 'emitter' ? [e.emitter] : [])),
    reduceMotion: f.reduceMotion,
  };
}

/** The sprites of a frame (props and characters) in their arrival order: the order a painter adds them. */
export function spritesOfFrame(f: SceneFrame): SpriteSpec[] {
  const all: { order: number; sprite: SpriteSpec }[] = [
    ...f.layers.flatMap((l) => (l.kind === 'prop' ? [l] : [])),
    ...f.actors,
  ];
  return all.sort((a, b) => a.order - b.order).map((x) => x.sprite);
}
