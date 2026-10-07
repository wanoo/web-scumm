// What an intention does to the engine (4.1.11, ADR 0011, D21): the only way a renderer's input reaches the game.
// `act`, `walk` and `skip` are the engine's; `pick` (a choice on screen) and `open` (the map, the bag, the menu) are the
// presenter's, which answers them itself and calls this for the rest.
import type { Engine } from '../core/engine';
import type { Intent } from './frame';

/** Applies an intention the engine answers; false when it is the presenter's (`pick`, `open`). */
export async function applyIntent(engine: Engine, i: Intent): Promise<boolean> {
  switch (i.kind) {
    case 'act':
      await engine.act(i.item ? { verb: i.verb, a: i.item, b: i.target } : { verb: i.verb, a: i.target });
      return true;
    case 'walk':
      await engine.walkTo(i.to);
      return true;
    case 'skip':
      engine.skip();
      return true;
    default:
      return false;
  }
}
