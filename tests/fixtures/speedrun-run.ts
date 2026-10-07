// Plays a speedrun attempt on the fixture game with the live recorder (tools/speedrun/recorder.ts) and returns its
// sealed envelope and the verifier's context: the tests of the envelope, the verifier and the worker start here.
import { Engine } from '@engine/core/engine';
import { fingerprintGame, type GameFingerprint } from '@engine/core/fingerprint';
import { MemoryChunkStore } from '@engine/core/journal-chunks';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { GameDef } from '@engine/core/types';
import { SpeedrunRecorder } from '@engine/tools/speedrun/recorder';
import type { VerifyContext } from '@engine/tools/speedrun/verify';
import { ROUTE, speedrunGame, speedrunLayouts } from './speedrun-game';

export const ENGINE_VERSION = 'test-engine';

export async function fixtureFingerprint(game: GameDef = speedrunGame()): Promise<GameFingerprint> {
  return fingerprintGame(game, { extensions: { trusted: 'trusted-hash' }, engine: ENGINE_VERSION });
}

export function verifyContext(fingerprint: GameFingerprint, game: GameDef = speedrunGame()): VerifyContext {
  return { game, layouts: speedrunLayouts, fingerprint, engineVersion: ENGINE_VERSION };
}

type Step = { verb: string; a: string; b?: string } | { load: 'last-save' } | { hint: true } | { pause: number };

/** Plays `steps` in `categoryId` and seals the run. A `{ load }` reloads the state saved before the previous step. */
export async function playRun(categoryId = 'any%', steps: readonly Step[] = ROUTE, game: GameDef = speedrunGame()) {
  const fingerprint = await fixtureFingerprint(game);
  const store = new MemoryChunkStore();
  const engine = new Engine(game, speedrunLayouts, new FakePresenter(), new MemoryStore());
  let now = 0;
  const rec = new SpeedrunRecorder({
    engine,
    gameId: game.id,
    manifest: game.speedrun!,
    category: game.speedrun!.categories.find((c) => c.id === categoryId)!,
    store,
    fingerprint,
    engineVersion: ENGINE_VERSION,
    now: () => now,
  });
  await rec.start();
  let saved = structuredClone(engine.state);
  for (const s of steps) {
    now += 1000;
    if ('load' in s) await engine.load(structuredClone(saved));
    else if ('hint' in s) await engine.script([{ hint: true }]);
    else if ('pause' in s) {
      rec.interval('pause', true);
      now += s.pause;
      rec.interval('pause', false);
    } else {
      saved = structuredClone(engine.state);
      await engine.act({ ...s });
    }
  }
  const envelope = await rec.seal();
  return { envelope, fingerprint, store, engine, rec };
}
