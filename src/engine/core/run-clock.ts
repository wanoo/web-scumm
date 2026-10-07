// The run clock (4.1.14 "Time Attack", ADR 0016, D24): what a speedrun is timed with. It OBSERVES the core: the session
// tells it an entry began, a command stepped, an approach walk ended, a cutscene was entered or left, a room entered;
// it adds up the logical durations core/timing.ts declares, in its own counters. It never writes `GameState`, never
// awaits, never schedules anything: nothing the content does depends on it (charter rule 10).
import type { Cmd, Id, Layout, Point } from './types';
import { cmdKey } from './cmds';
import { ANIM_MS, CAMERA_MS, MICROTICKS_PER_MS, MOTION_MS, SAY_LOGICAL_MS, walkLogicalMs } from './timing';

/**
 * A run's three clocks: `monotonicNow` the host's monotonic milliseconds (RTA: never reproducible, never an
 * authority), `logicalSteps` one per session entry (a transition of the core), `logicalTime` the declared durations of
 * what the core ran, in microticks (1 ms = 1,000).
 * @public
 */
export interface RunClock {
  monotonicNow(): number;
  logicalSteps(): bigint;
  logicalTime(): bigint;
}

/** What the clock reads of its engine: where things stand in a room (the layouts), who the hero is, a target's point. */
export interface ClockHost {
  layout(room: Id): Layout;
  heroId(): Id;
  /** A target's approach point (throws when the layout lacks it). */
  point(t: Id | Point, room: { id: Id }): Point;
}

/** The clock's counters and anchors, as a resumed run restores them (plain data: bigints as decimal strings). */
export interface ClockSnapshot {
  steps: string;
  time: string;
  cutscene: string;
  anchors: [string, Point][];
}

const DEFAULT_ENTRY: Point = [320, 360];
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The engine's run clock: logical steps, logical time, the cutscenes' share, the walk anchors. */
export class EngineRunClock implements RunClock {
  private steps = 0n;
  private time = 0n;
  private cutsceneTime = 0n;
  private depth = 0;
  /** Where the core last put each character, per room (`room/who`): the start of its next walk's logical length. */
  private anchors = new Map<string, Point>();
  /** The monotonic source (`performance.now` in the browser); the host sets it. */
  now: () => number = () => globalThis.performance?.now() ?? 0;

  constructor(private host: ClockHost) {}

  monotonicNow(): number {
    return this.now();
  }
  logicalSteps(): bigint {
    return this.steps;
  }
  logicalTime(): bigint {
    return this.time;
  }
  /** The logical time minus what ran inside a cutscene (Active IGT). */
  activeTime(): bigint {
    return this.time - this.cutsceneTime;
  }

  /** A new run (a new game, a checkpoint): everything back to zero. */
  reset(): void {
    this.steps = 0n;
    this.time = 0n;
    this.cutsceneTime = 0n;
    this.depth = 0;
    this.anchors.clear();
  }

  snapshot(): ClockSnapshot {
    return {
      steps: this.steps.toString(),
      time: this.time.toString(),
      cutscene: this.cutsceneTime.toString(),
      anchors: [...this.anchors.entries()].map(([k, p]) => [k, [p[0], p[1]]]),
    };
  }
  restore(s: ClockSnapshot): void {
    this.steps = BigInt(s.steps);
    this.time = BigInt(s.time);
    this.cutsceneTime = BigInt(s.cutscene);
    this.depth = 0;
    this.anchors = new Map(s.anchors.map(([k, p]) => [k, [p[0], p[1]] as Point]));
  }

  /** A session entry began: one logical step. */
  entry(): void {
    this.steps++;
  }

  private add(ms: number): void {
    if (!(ms > 0)) return;
    const t = BigInt(Math.round(ms)) * MICROTICKS_PER_MS;
    this.time += t;
    if (this.depth > 0) this.cutsceneTime += t;
  }

  /** A cutscene entered (`true`) or left: what runs inside is not Active IGT. */
  cutscene(on: boolean): void {
    this.depth = Math.max(0, this.depth + (on ? 1 : -1));
  }

  /** A line said (any line: a `say`, a plain string, a look, a fallback, a hint): a fixed logical cost. */
  line(fast: boolean): void {
    if (!fast) this.add(SAY_LOGICAL_MS);
  }

  private anchor(room: Id, who: Id): Point {
    const k = `${room}/${who}`;
    const a = this.anchors.get(k);
    if (a) return a;
    const L = this.host.layout(room);
    const p: Point =
      who === this.host.heroId()
        ? (L.entries?.default ?? DEFAULT_ENTRY)
        : L.actors?.[who]
          ? [L.actors[who].x, L.actors[who].y]
          : (L.entries?.default ?? DEFAULT_ENTRY);
    return p;
  }

  /** A character walked to `to` (an approach walk that arrived, a `walk` command): its distance over the walk speed. */
  walk(room: Id, who: Id, to: Point, fast = false): void {
    const from = this.anchor(room, who);
    if (!fast) this.add(walkLogicalMs(dist(from, to)));
    this.anchors.set(`${room}/${who}`, [to[0], to[1]]);
  }

  /** The hero entered a room (at an entry, a point, or where it last stood). */
  enter(room: Id, at: Id | Point | undefined): void {
    const hero = this.host.heroId();
    if (at === undefined) return;
    const L = this.host.layout(room);
    const p = Array.isArray(at) ? at : (L.entries?.[at] ?? L.entries?.default ?? DEFAULT_ENTRY);
    this.anchors.set(`${room}/${hero}`, [p[0], p[1]]);
  }

  /** A command about to run (lines are counted by `line`, walks and places here, the rest by their declared `ms`). */
  command(c: Cmd, ctx: { room: { id: Id }; fast: boolean }, who: (w: Id) => Id): void {
    if (typeof c === 'string') return;
    const k = cmdKey(c);
    const room = ctx.room.id;
    if (k === 'walk' && 'walk' in c) {
      let to: Point;
      try {
        to = this.host.point(c.walk, ctx.room);
      } catch {
        return; // the handler throws the same error
      }
      this.walk(room, who(c.who ?? 'hero'), to, ctx.fast);
      return;
    }
    if (k === 'place' && 'place' in c) {
      this.anchors.set(`${room}/${who(c.place[0])}`, [c.place[1][0], c.place[1][1]]);
      return;
    }
    if (ctx.fast) return;
    switch (k) {
      case 'wait':
        if ('wait' in c) this.add(c.wait);
        return;
      case 'anim':
        if ('anim' in c) this.add(c.ms ?? ANIM_MS);
        return;
      case 'camera':
        if ('camera' in c && typeof c.camera === 'object') this.add(c.camera.ms ?? CAMERA_MS);
        return;
      case 'launch':
        if ('launch' in c) this.add(c.launch.ms ?? MOTION_MS.launch);
        return;
      case 'spring':
        if ('spring' in c) this.add(c.spring.ms ?? MOTION_MS.spring);
        return;
      case 'path':
        if ('path' in c) this.add(c.path.ms ?? MOTION_MS.path);
        return;
      case 'follow':
        if ('follow' in c) this.add(c.follow.ms ?? 0);
        return;
      default:
        return;
    }
  }
}
