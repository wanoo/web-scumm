// The approved game a speedrun is checked against, in Node (4.1.14 "Time Attack"): the current game's module, its
// layouts from disk, its fingerprint computed the way the player computes it (the sources as written, the asset
// manifest, the trusted extensions' hash, the engine's version). `npm run speedrun:verify`, the MCP tool and the
// Bridge's worker start here.
import { resolve } from 'node:path';
import { fingerprintGame } from '../../src/engine/core/fingerprint';
import { loadLayouts } from '../../src/engine/tools/load';
import type { VerifyContext } from '../../src/engine/tools/speedrun/verify';
import { verifySignal } from '../../src/engine/reality/protocol';
import { engineVersion, trustedExtensionsHash } from '../extensions';
import { GAME_DIR, loadGameModule } from '../game';

/** The current game as a verifier's context (`GAME`, `GAME_DIR`, or package.json's game). */
export async function approvedContext(dir = GAME_DIR): Promise<VerifyContext> {
  const mod = await loadGameModule();
  const engine = engineVersion();
  const fingerprint = await fingerprintGame(mod.game, {
    manifest: mod.manifest,
    extensions: {
      trusted: trustedExtensionsHash(dir),
      commands: mod.commands,
      minigames: Object.keys(mod.minigames ?? {}),
    },
    engine,
  });
  return {
    game: mod.game,
    layouts: loadLayouts(resolve(dir, 'layout')),
    commands: mod.commands,
    fingerprint,
    engineVersion: engine,
    verifySignal: async (jws, keyring, expect) => {
      const v = await verifySignal(jws, keyring, expect);
      return v.ok ? { ok: true } : { ok: false, code: v.code };
    },
  };
}
