// A game's Reality manifest (4.1.1, plan §4.5): the signals it declares, with no secret, built from the content. The
// Bridge refuses a signal absent from it, and keeps its hash in its configuration so an old configuration cannot
// publish a signal the game renamed or removed. `npm run build` writes it next to the game (dist/reality-manifest.json)
// when the game declares `reality`.
import type { GameDef } from '../core/types';

/** A game's Reality manifest: the signals it declares, with no secret, as the Bridge checks them. @public */
export interface RealityManifest {
  format: 'web-scumm-reality-manifest';
  schema: 1;
  gameId: string;
  signals: { id: string; source: string; availability: 'optional' | 'required'; replay: 'record' }[];
}

/** The manifest of a game that declares `reality`, null otherwise. @public */
export function realityManifest(game: GameDef): RealityManifest | null {
  if (!game.reality) return null;
  return {
    format: 'web-scumm-reality-manifest',
    schema: 1,
    gameId: game.id,
    signals: game.reality.signals
      .map((s) => ({ id: s.id, source: s.source, availability: s.availability, replay: s.replay }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** The manifest's hash: SHA-256 of its JSON (keys in this fixed order), hex. @public */
export async function manifestHash(m: RealityManifest): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(m));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
