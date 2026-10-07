// The ghost (4.1.14 "Time Attack"): a reference run (the player's PB, or a logical route) played back beside the
// current attempt, on SEMANTIC targets: where the ghost is (its room), what it does (its action and the target its
// cursor points at, an id the presenter places), what it holds, and whether the player is ahead or behind at the same
// logical time. Never a pixel trail. It is off by default the first time a category is played (the ghost would show
// the puzzles' answers), and a logical route's ghost is never a human record.
import type { TapeLink } from '../../core/run-tape';
import type { Id } from '../../core/types';

/** What the ghost is doing at a moment. */
export interface GhostFrame {
  /** The link the ghost has reached. */
  index: number;
  room: Id | null;
  /** The action, as `verb a [→ b]`, or the input's kind. */
  action: string;
  /** The semantic target its cursor is on (an id of the room), when the input was an action. */
  target: Id | null;
  inventory: Id[];
  logicalTime: string;
}

/** A reference run, frame by frame (built once from its links). */
export class Ghost {
  private frames: GhostFrame[] = [];

  constructor(
    links: readonly TapeLink[],
    readonly kind: 'human' | 'logical' = 'human',
  ) {
    let room: Id | null = null;
    const inv = new Set<Id>();
    for (const l of links) {
      for (const e of l.events) {
        if (e.kind === 'roomEntered') room = e.room;
        else if (e.kind === 'itemAcquired') inv.add(e.item);
        else if (e.kind === 'itemLost') inv.delete(e.item);
      }
      const en = l.entry;
      const action =
        'act' in en
          ? `${en.act.verb} ${en.act.a}${en.act.b ? ` → ${en.act.b}` : ''}`
          : 'travel' in en
            ? `travel ${en.travel}`
            : 'switch' in en
              ? `switch ${en.switch}`
              : 'start' in en
                ? 'new game'
                : 'step' in en
                  ? `script ${en.step}`
                  : 'map' in en
                    ? 'map'
                    : 'input';
      this.frames.push({
        index: l.index,
        room,
        action,
        target: 'act' in en ? (en.act.b ?? en.act.a) : null,
        inventory: [...inv].sort(),
        logicalTime: l.logicalTime,
      });
    }
  }

  get length(): number {
    return this.frames.length;
  }

  /** The ghost's frame at a logical time: the last one it reached by then (null before its first). */
  at(logicalTime: bigint): GhostFrame | null {
    let lo = 0;
    let hi = this.frames.length - 1;
    let found: GhostFrame | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const f = this.frames[mid]!;
      if (BigInt(f.logicalTime) <= logicalTime) {
        found = f;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  /**
   * Ahead (negative) or behind (positive) the ghost: the player's logical time when they reached a split, minus the
   * ghost's at the same split (the splits are semantic: the same event, not the same place on screen).
   */
  static delta(mine: string | null, ghost: string | null): bigint | null {
    return mine === null || ghost === null ? null : BigInt(mine) - BigInt(ghost);
  }
}

/** Whether the ghost shows by default: never the first time a category is played. */
export const ghostByDefault = (attempts: number): boolean => attempts > 0;
