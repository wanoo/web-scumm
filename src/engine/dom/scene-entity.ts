import type { Id } from '../core/types';

/** Something drawn in the scene: prop, actor or hero. */
export interface Ent {
  id: Id;
  kind: 'prop' | 'actor' | 'hero';
  /** Drawn at least once with an image (its `bbox` is then up to date). */
  drawn: boolean;
  /** 0–1 during a fade (`show`), 1 otherwise. */
  opacity: number;
  x: number;
  y: number;
  /** Reference height (idle pose), in logical units. */
  h: number;
  z?: number;
  flip: boolean;
  /** Vertical mirror and rotation (degrees, clockwise, around the feet): props only, from the layout. */
  flipV?: boolean;
  rot?: number;
  /** Displayed box (logical units), rotation included: used for touch. */
  bbox?: [number, number, number, number];
  /** Character id (the sheet is re-read on every draw: its variants depend on the state). */
  charId?: Id;
  /** Speech: current mouth image, next change, next blink, slight bob. */
  mouth?: Id;
  mouthAt: number;
  blinkAt: number;
  bob: number;
  pose: string;
  /** Temporary (anim) or walk pose, takes priority over `pose`. */
  over?: string;
  frame: number;
  img?: Id;
  /** Props: a frame of an animation shown instead of the state image, and a running loop. */
  frameImg?: Id;
  loop?: { frames: Id[]; fps: number; i: number; acc: number; onFrame?: (i: number) => void };
  visible: boolean;
  /** Characters stand on a shadow; props do not. */
  hasShadow: boolean;
  /** Character that keeps its size (placed) or follows depth (hero, walking actor). */
  scaleWithDepth: boolean;
}
