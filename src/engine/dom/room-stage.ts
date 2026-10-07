// A room's stage for the painter (4.1.11, out of dom/room.ts): `stageOf` (core/stage.ts) with its conditions evaluated
// on the state and its images placed on the backdrop's box (`object-fit: cover` over the room), so a layer cut from the
// full-size art lies exactly over it. What the scene frame (scene/frame.ts) carries as its layers, occluders and effects.
import { check } from '../core/cond';
import { must } from '../core/must';
import { stageOf } from '../core/stage';
import type { GameState, Layout, RoomDef } from '../core/types';
import type { AssetBank } from './assets';
import type { StageSpec } from './renderer';

/** Particles per second when an emitter does not say (`EmitterDef.rate`). */
const RATES: Record<string, number> = { dust: 6, rain: 60, snow: 20, sparks: 15, smoke: 8, leaves: 4 };

export function stageSpecOf(
  room: RoomDef,
  layout: Layout,
  state: GameState | undefined,
  bank: Pick<AssetBank, 'img' | 'size'>,
  width: number,
  reduceMotion: boolean,
): StageSpec {
  const S = stageOf(room, layout);
  const shown = (c: Parameters<typeof check>[0]) => !state || check(c, state, room.id);
  const [back0, ...layers] = S.layers;
  const back = must(back0, 'backdrop layer'); // stageOf always puts a backdrop first
  const [bw, bh] = bank.size(back.image);
  const k = Math.max(width / bw, 400 / bh);
  const bx = (width - bw * k) / 2,
    by = (400 - bh * k) / 2;
  return {
    backdrop: { url: bank.img(back.image), x: bx, y: by, w: bw * k, h: bh * k },
    layers: layers.map((l) => {
      const [iw, ih] = bank.size(l.image);
      return {
        id: l.id,
        url: bank.img(l.image),
        role: l.role,
        x: bx + l.x,
        y: by + l.y,
        w: iw * k,
        h: ih * k,
        z: l.z,
        parallax: l.parallax,
        blend: l.blend,
        opacity: l.opacity,
        visible: shown(l.visible),
      };
    }),
    occluders: S.occluders.map((o) => ({
      id: o.id,
      z: o.z,
      ...(o.polygon ? { polygon: o.polygon } : {}),
      ...(o.mask ? { mask: bank.img(o.mask) } : {}),
      ...(o.layer ? { layer: o.layer } : {}),
      feather: o.feather,
      invert: o.invert,
    })),
    lights: S.lights.map((l) => ({
      id: l.id,
      kind: l.kind,
      color: l.color,
      intensity: l.intensity ?? 0.6,
      blend: l.blend ?? (l.kind === 'radial' ? 'screen' : 'multiply'),
      ...(l.at ? { at: l.at } : {}),
      ...(l.radius ? { radius: l.radius } : {}),
      visible: shown(l.visible),
    })),
    emitters: S.emitters.map((e) => ({
      id: e.id,
      kind: e.kind,
      ...(e.image ? { url: bank.img(e.image) } : {}),
      color: e.color ?? '#ffffff',
      rate: e.rate ?? RATES[e.kind] ?? 8,
      area: e.area ?? [0, 0, width, 400],
      visible: shown(e.visible),
    })),
    reduceMotion,
  };
}

/** What can change on a built stage (4.1.5): its conditions' answers and reduced motion, not the whole spec. */
export const stageKey = (st: StageSpec) =>
  [...st.layers, ...st.lights, ...st.emitters].map((x) => +x.visible).join('') + +st.reduceMotion;
