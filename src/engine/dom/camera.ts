import type { Point } from '../core/types';

/** What the camera reads from the scene: the hero's feet, the zoom their zone asks for, and what the painter is told. */
export interface CameraScene {
  /** The hero's feet in logical units, when they are in the scene. */
  hero(): Point | undefined;
  /** The zoom the walk zone under a point asks for (1 outside any zone). */
  zoomAt(p: Point): number;
  /** Reduced motion (settings): instant moves. */
  reduced(): boolean;
  /** The painter's camera: left edge, room width, top edge, zoom. */
  paint(cam: number, width: number, camY: number, zoom: number): void;
}

/**
 * The camera of a room (4.1.5): its left and top edges in logical units, its zoom, whether it follows the hero, and a
 * pan in progress. It owns every number the room view kept for it, and answers where a logical point is on the screen
 * and the reverse; the view tells it the frame and the room, and it tells the painter.
 */
export class Camera {
  /** Wide rooms: logical width, and the camera (left edge, logical units). `follow`: it tracks the hero. */
  width = 640;
  cam = 0;
  follow = true;
  /** The zoom (a walk zone's `zoom`, bounded 1–2) and top edge: 1 and 0 on every room without zones that zoom. */
  zoom = 1;
  camY = 0;
  /** Pixels of the scene per logical unit (the view's `resize`). */
  u = 1;
  /** Called whenever the camera moves (the dev overlay pans with it). */
  onCamera: ((cam: number) => void) | null = null;
  private pan: { from: number; to: number; t0: number; ms: number; done: () => void } | null = null;

  constructor(private scene: CameraScene) {}

  clamp(x: number) {
    return Math.max(0, Math.min(this.width - 640 / this.zoom, x));
  }
  private clampY(y: number) {
    return Math.max(0, Math.min(400 - 400 / this.zoom, y));
  }
  apply() {
    this.scene.paint(this.cam, this.width, this.camY, this.zoom);
    this.onCamera?.(this.cam);
  }
  /** A logical point on the screen, in pixels of the scene (speech, labels, sparks). */
  toScreen(p: Point): Point {
    return [(p[0] - this.cam) * this.zoom * this.u, (p[1] - this.camY) * this.zoom * this.u];
  }
  /** A point of the scene (fractions of its width and height) in the room's logical units: what a tap touches. */
  toLogical(fx: number, fy: number): Point {
    return [this.cam + (fx * 640) / this.zoom, this.camY + (fy * 400) / this.zoom];
  }
  /** The zoom the hero's zone asks for. */
  private zoomTarget(): number {
    const h = this.scene.hero();
    return Math.max(1, Math.min(2, h ? this.scene.zoomAt(h) : 1));
  }
  /** The top edge that keeps the hero's feet in the lower part of a zoomed view. */
  private heroCamY(): number {
    return this.clampY((this.scene.hero()?.[1] ?? 360) - (400 / this.zoom) * 0.8);
  }
  /** The camera the hero would have at this instant (centred on them, clamped). */
  private heroCam(): number {
    return this.clamp((this.scene.hero()?.[0] ?? 320) - 320 / this.zoom);
  }
  followHero() {
    this.follow = true;
    this.pan = null;
  }
  /** Moves the camera to left edge `x` (follow off), animated over `ms`. */
  setCamera(x: number, ms = 0): Promise<void> {
    this.follow = false;
    const to = this.clamp(x);
    if (this.width <= 640 || ms <= 0 || this.scene.reduced() || Math.abs(to - this.cam) < 1) {
      this.pan = null;
      this.cam = to;
      this.apply();
      return Promise.resolve();
    }
    return new Promise((done) => {
      this.pan = { from: this.cam, to, t0: performance.now(), ms, done };
    });
  }
  /** A room just built: the camera as saved (a pan left it somewhere), or on the hero. */
  enter(width: number, saved: { x?: number; follow?: boolean } | undefined) {
    this.width = Math.max(640, width);
    this.pan = null;
    this.zoom = this.zoomTarget();
    this.camY = this.zoom === 1 ? 0 : this.heroCamY();
    this.follow = saved?.follow ?? true;
    this.cam = this.follow ? this.heroCam() : this.clamp(saved?.x ?? 0);
    this.apply();
  }
  /** The camera where it rests (the view's `still`). */
  rest() {
    this.pan = null;
    if (this.follow) this.cam = this.heroCam();
    this.apply();
  }
  /** One frame: the zoom toward what the hero's zone asks (smoothed), a pan in progress, or the hero followed. */
  tick(t: number, dt: number) {
    const fast = this.scene.reduced() ? 60 : 5;
    const zt = this.zoomTarget();
    if (Math.abs(zt - this.zoom) > 0.002 || this.zoom !== 1) {
      this.zoom =
        Math.abs(zt - this.zoom) < 0.002 ? zt : this.zoom + (zt - this.zoom) * Math.min(1, dt * (fast === 60 ? 60 : 3));
      const ty = this.heroCamY();
      this.camY += (ty - this.camY) * Math.min(1, dt * fast);
      if (!this.pan && this.follow) this.cam = this.cam + (this.heroCam() - this.cam) * Math.min(1, dt * fast);
      this.cam = this.clamp(this.cam);
      this.apply();
    }
    if (this.width <= 640) return;
    if (this.pan) {
      const p = this.pan;
      const k = Math.min(1, (t - p.t0) / p.ms);
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.cam = p.from + (p.to - p.from) * ease;
      if (k >= 1) {
        this.pan = null;
        p.done();
      }
      this.apply();
    } else if (this.follow) {
      const target = this.heroCam();
      if (Math.abs(target - this.cam) > 0.5) {
        this.cam += (target - this.cam) * Math.min(1, dt * fast);
        this.apply();
      }
    }
  }
}
