import { motionAt, type MotionSpec } from '../core/motion';
import type { NormalLink } from '../core/stage';
import { WALK_SPEED } from '../core/timing';
import type { Id, Layout, Point, RoomDef } from '../core/types';
import type { Ent } from './scene-entity';
import { WalkTopology, type WalkStep } from './walk';

/** What a walk reads from and does to the scene: the entity, its sprites, a redraw, and what blocks a link. */
export interface WalkScene {
  ent(id: Id): Ent | undefined;
  draw(e: Ent): void;
  /** The poses of the entity's character (`walk`, `walk_back`, `climb`…), none for a prop. */
  sprites(e: Ent): Record<string, Id[]> | undefined;
  /** Reduced motion (settings): a teleport for every crossing. */
  reduced(): boolean;
  /** Whether a link can be taken now (its `if` on the state). */
  passable(l: NormalLink): boolean;
  /** A walk stopped before a closed link (`stage.links[id].locked` is what the App says then). */
  blocked(l: NormalLink): void;
}

/**
 * The walking of a room (4.1.5): the topology of its floor (zones, links, depth), a walk along a route with the
 * pose of each direction, a crossing of a link (stairs, ladder, jump, teleport), a computed motion. One token per
 * entity: a new walk ends the one in progress.
 */
export class Walker {
  private topology!: WalkTopology;
  private tokens = new Map<Id, number>();

  constructor(private scene: WalkScene) {}

  /** A room just built: its floor. */
  enter(layout: Layout, room: RoomDef) {
    this.topology = new WalkTopology(layout, room);
  }
  zoneAt(p: Point) {
    return this.topology?.zoneAt(p) ?? null;
  }
  scaleAt(p: Point) {
    return this.topology.scaleAt(p);
  }
  clamp(p: Point): Point {
    return this.topology.clamp(p);
  }

  /** Walks along the path. Returns the arrival point, or null if interrupted by another walk. */
  async walkTo(id: Id, to: Point, fast: boolean): Promise<Point | null> {
    const e = this.scene.ent(id);
    if (!e) return to;
    const tok = (this.tokens.get(id) ?? 0) + 1;
    this.tokens.set(id, tok);
    const { steps, blocked } = this.topology.route([e.x, e.y], to, (l) => this.scene.passable(l));
    // A closed link stops the walk, never the action: the engine goes on from where the walk ended, and the rule of
    // the target (gated by the same condition, lint `walk-link-gate`) answers. A link is never game logic by itself.
    if (fast) {
      const end = steps[steps.length - 1]?.to ?? to;
      [e.x, e.y] = end;
      this.scene.draw(e);
      if (blocked) this.scene.blocked(blocked);
      return end;
    }
    // Actors and the hero already follow depth (as in the placement page): nothing to convert.
    const wasDepth = e.scaleWithDepth;
    if (e.kind === 'actor' && !wasDepth) {
      e.h = e.h / this.topology.scaleAt([e.x, e.y]);
      e.scaleWithDepth = true;
    }
    for (const step of steps) {
      const ok =
        step.via && step.via.mode !== 'walk' ? await this.cross(e, step, tok) : await this.stride(e, step.to, tok);
      if (!ok) return null;
    }
    e.over = undefined;
    if (e.kind === 'actor' && !wasDepth) {
      e.h = e.h * this.topology.scaleAt([e.x, e.y]);
      e.scaleWithDepth = false;
    }
    this.scene.draw(e);
    if (blocked) this.scene.blocked(blocked);
    return [e.x, e.y];
  }

  /** Walks one straight segment at the walking speed, with the walk pose of its direction. */
  private stride(e: Ent, p: Point, tok: number): Promise<boolean> {
    const sp = this.scene.sprites(e) ?? {};
    return new Promise<boolean>((res) => {
      let last = performance.now();
      const step = (now: number) => {
        if (this.tokens.get(e.id) !== tok) return res(false);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const dx = p[0] - e.x,
          dy = p[1] - e.y,
          d = Math.hypot(dx, dy);
        if (d < 1.5) {
          e.x = p[0];
          e.y = p[1];
          this.scene.draw(e);
          return res(true);
        }
        const k = Math.min(1, (WALK_SPEED * dt) / d);
        e.x += dx * k;
        e.y += dy * k;
        if (Math.abs(dx) > 1) e.flip = dx < 0;
        const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
        e.over = vertical
          ? dy < 0
            ? sp.walk_back
              ? 'walk_back'
              : 'walk'
            : sp.walk_front
              ? 'walk_front'
              : 'walk'
          : sp.walk
            ? 'walk'
            : undefined;
        this.scene.draw(e);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /**
   * Crosses a walk link: stairs and ladders at a steady pace over the link's duration (its animation, else `climb` or
   * the walk pose), a jump along an arc, a teleport out and back in. Reduced motion: a teleport for every mode.
   */
  private cross(e: Ent, step: WalkStep, tok: number): Promise<boolean> {
    const l = step.via!;
    const from: Point = [e.x, e.y],
      to = step.to,
      sp = this.scene.sprites(e) ?? {};
    if (l.facing) e.flip = l.facing === 'left';
    else if (Math.abs(to[0] - from[0]) > 1) e.flip = to[0] < from[0];
    const pose = l.anim ?? (l.mode === 'ladder' ? (sp.climb ? 'climb' : undefined) : sp.walk ? 'walk' : undefined);
    if (l.mode === 'teleport' || this.scene.reduced() || l.ms <= 0) {
      [e.x, e.y] = to;
      this.scene.draw(e);
      return Promise.resolve(this.tokens.get(e.id) === tok);
    }
    return new Promise<boolean>((res) => {
      const t0 = performance.now();
      const step2 = (now: number) => {
        if (this.tokens.get(e.id) !== tok) return res(false);
        const k = Math.min(1, (now - t0) / l.ms);
        e.x = from[0] + (to[0] - from[0]) * k;
        e.y = from[1] + (to[1] - from[1]) * k - (l.mode === 'jump' ? Math.sin(Math.PI * k) * 30 : 0);
        e.over = pose;
        this.scene.draw(e);
        if (k < 1) requestAnimationFrame(step2);
        else res(true);
      };
      requestAnimationFrame(step2);
    });
  }

  /**
   * A computed motion (core/motion.ts) of a character or a prop: its position (and turn) follow the motion's closed
   * form for its duration; at the end a flight leaves it where it lands, a spring at rest, a follower where its
   * leader's offset puts it. `fast` (skipping, reduced motion): the end at once.
   */
  async motion(id: Id, m: MotionSpec, fast: boolean, leader?: Id): Promise<void> {
    const e = this.scene.ent(id);
    if (!e) return;
    const base = { x: e.x, y: e.y, rot: e.rot ?? 0 };
    const spec: MotionSpec = m.kind === 'launch' && !m.from ? { ...m, from: [e.x, e.y] } : m;
    const lead = leader ? this.scene.ent(leader) : undefined;
    const apply = (k: number) => {
      const f = motionAt(spec, k);
      if (spec.kind === 'follow' && lead) {
        e.x = lead.x + (f.dx ?? 0);
        e.y = lead.y + (f.dy ?? 0);
      } else if (f.at) [e.x, e.y] = f.at;
      else {
        e.x = base.x + (f.dx ?? 0);
        e.y = base.y + (f.dy ?? 0);
      }
      e.rot = base.rot + f.rot;
      this.scene.draw(e);
    };
    if (fast || m.ms <= 0) {
      apply(1);
      return;
    }
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / m.ms);
        apply(k);
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
  }
}
