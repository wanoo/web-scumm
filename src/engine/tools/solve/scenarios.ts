// Signals from the world outside in a search (4.1.1, plan §6): what can arrive in a state under the search's policy,
// and the try that hands it to the engine. Closed: nothing. A scenario: its next signal (the cursor says how far it
// went). Adversarial: every declared signal, every time. The engine applies a signal at most once, so a repeated
// delivery of a once-per-game signal is a no-op the search prunes like any other.
import type { Engine } from '../../core/engine';
import type { GameDef, GameState } from '../../core/types';
import type { RealityPolicy } from './model';

/** The signals a search offers in a state (4.1.1): none when closed, the scenario's next one, or every declared one. */
function pendingSignals(game: GameDef, policy: RealityPolicy | undefined, s: GameState): string[] {
  if (!game.reality || !policy || policy === 'closed') return [];
  if (policy === 'adversarial') return game.reality.signals.map((x) => x.id);
  const next = policy.signals[s.reality?.cursor ?? 0];
  return next === undefined ? [] : [next];
}

/** The tries of the signals that can arrive in `s`: a label, the engine call, the puzzle graph id. */
export function signalTries(
  game: GameDef,
  policy: RealityPolicy | undefined,
  s: GameState,
): { label: string; run: (e: Engine) => Promise<void>; candidates: string[] }[] {
  return pendingSignals(game, policy, s).flatMap((sg) => {
    const def = game.reality?.signals.find((x) => x.id === sg);
    if (!def) return [];
    return [
      {
        label: `Signal ${sg}`,
        run: (e: Engine) => {
          const seq = (e.state.reality?.cursor ?? 0) + 1;
          return e
            .receive({ id: `solver-${seq}`, sequence: seq, signal: sg, source: def.source, receivedAt: 0 })
            .then(() => undefined);
        },
        candidates: [`signal:${sg}`],
      },
    ];
  });
}
