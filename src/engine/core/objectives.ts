// Objectives (4.1.12 "Language", ADR 0014): the engine completes each one once, the first time its `done` condition
// holds after a transition (every `Engine.save()`: the end of an action, a script's step, a room entered, an ending),
// and says so in the semantic journal (`objectiveCompleted`). What already holds when a game starts, loads or jumps to
// a checkpoint is done silently. The set lives with the session, not in the save: a loaded game counts as done what
// holds then (ADR 0014 says why). `completionGoal` is the solver's 100%: every objective that is not optional.
import { check } from './cond';
import type { Engine } from './engine';
import type { Cond, GameDef, Id } from './types';

/** The parents above an objective (0 for a top one); a cycle (refused by the validator) stops at the length. */
function depth(game: GameDef, id: Id): number {
  let n = 0;
  const all = game.objectives ?? {};
  for (let p = all[id]?.parent; p && n < Object.keys(all).length; p = all[p]?.parent) n++;
  return n;
}

/** The engine's objectives: which are completed in this session, and the check after each transition. */
export class ObjectiveTracker {
  /** Null until the session's first check, which takes what holds then as done without a word. */
  private done: Set<Id> | null = null;
  constructor(private readonly eng: Engine) {}

  /** A new session (a new game, a load, a checkpoint): the next check starts again from what holds. */
  reset(): void {
    this.done = null;
  }

  /** The objectives completed so far in this session (the pause menu's quest journal). */
  completed(): ReadonlySet<Id> {
    return this.done ?? new Set();
  }

  /** After a transition: every objective whose `done` holds for the first time, deepest steps first, then in order. */
  check(): void {
    const all = this.eng.game.objectives;
    const s = this.eng.state;
    if (!all || !s) return;
    const holds = (c: Cond) => check(c, s);
    if (!this.done) {
      this.done = new Set(Object.keys(all).filter((id) => holds(all[id]!.done)));
      return;
    }
    const fresh = Object.keys(all).filter((id) => !this.done!.has(id) && holds(all[id]!.done));
    const order = new Map(fresh.map((id, i) => [id, i]));
    fresh.sort((a, b) => depth(this.eng.game, b) - depth(this.eng.game, a) || order.get(a)! - order.get(b)!);
    for (const id of fresh) {
      this.done.add(id);
      this.eng.journal.emit({ kind: 'objectiveCompleted', objective: id });
    }
  }
}

/** The solver's 100% goal (`npm run solve -- --goal=100%`): the `done` of every objective that is not optional. @public */
export function completionGoal(game: GameDef): Cond[] {
  return Object.values(game.objectives ?? {})
    .filter((o) => !o.optional)
    .map((o) => o.done);
}
