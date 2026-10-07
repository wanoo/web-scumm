// The busy owner (4.1.11; what 4.1.5 left on the Engine as three fields): whether the engine is running something (an
// action, a cutscene, a conversation, a script's step), the tutorial step it waits for, and a skip in progress. The
// engine and its modules read and write it; the player only reads `Engine.busy` and `Engine.guiding`.
import type { Action, Id, VerbId } from './types';

/** A tutorial step (`{ guide }`): the action awaited, the line said when another is tried, and what resumes the run. */
export interface GuideWait {
  verb: VerbId;
  target: Id;
  say: string;
  resolve: () => void;
}

export class Busy {
  /** Runs in progress (`Engine.run` nests). */
  count = 0;
  /** The tutorial step waited for: the run that asked it is paused, the player is free to act. */
  guide: GuideWait | null = null;
  /** The current cutscene is being skipped: its commands finish at once. */
  skipping = false;

  /** Running something the player must wait for (a tutorial step waiting leaves the player free). */
  get busy() {
    return this.count > 0 && !this.guide;
  }
  get guiding(): { verb: VerbId; target: Id } | null {
    return this.guide ? { verb: this.guide.verb, target: this.guide.target } : null;
  }
  enter() {
    this.count++;
  }
  /** One run ended; true when none is left (the engine then saves). */
  leave(): boolean {
    this.count--;
    return this.count === 0;
  }
  /** Whether an action is the one the tutorial step waits for (as its object or its target). */
  accepts(act: Pick<Action, 'verb' | 'a' | 'b'>): boolean {
    const g = this.guide;
    return !!g && g.verb === act.verb && (act.a === g.target || act.b === g.target);
  }
  /** A new session: no step, no run, no skip. */
  reset() {
    this.guide = null;
    this.count = 0;
    this.skipping = false;
  }
}
