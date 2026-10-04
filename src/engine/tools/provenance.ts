// Where every shipped asset comes from, under which licence, and whether it is final: `games/<id>/provenance.json`.
// Entries match asset keys with `*`: `img:<manifest image id>`, `sfx:<file>`, `music:<file>`, `voice:<file>`,
// `video:<file>`. `npm run validate` checks a game that has the file (every asset covered, every entry complete);
// `npm run validate -- --release` requires the file and warns about every placeholder that would ship.
import type { GameDef } from '../core/types';

export interface ProvenanceEntry {
  /** Asset keys this entry covers, `*` matching anything (`img:hero/*`, `music:swan_lake.mp3`). */
  match: string;
  /** Where it comes from: drawn, generated (with what), recorded, bought, a URL. */
  source: string;
  /** The licence it ships under (`CC BY 4.0`, `proprietary`, `own work`…). */
  licence: string;
  author?: string;
  /** The prompt or recipe that made it, when generated. */
  prompt?: string;
  /** `placeholder`: must be replaced before a release (a warning in `validate --release`). */
  status: 'final' | 'placeholder';
  note?: string;
}

export interface Provenance { assets: ProvenanceEntry[] }

export interface ProvenanceReport {
  keys: number;
  uncovered: string[];
  placeholders: string[];
  incomplete: string[];
}

const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** Every asset key a game ships: the manifest's images, the files its audio and videos name. */
export function assetKeys(game: GameDef, manifest: { images: Record<string, unknown>; videos?: Record<string, unknown> }): string[] {
  const a = game.audio ?? {};
  return [
    ...Object.keys(manifest.images).map((id) => `img:${id}`),
    ...Object.values(a.sfx ?? {}).map((f) => `sfx:${f}`),
    ...Object.values(a.music ?? {}).map((f) => `music:${f}`),
    ...Object.values(a.voices ?? {}).map((f) => `voice:${f}`),
    ...Object.keys(manifest.videos ?? {}).map((f) => `video:${f}`),
  ].filter((k, i, all) => all.indexOf(k) === i).sort();
}

export function provenanceReport(game: GameDef, manifest: { images: Record<string, unknown>; videos?: Record<string, unknown> }, prov: Provenance): ProvenanceReport {
  const entries = (prov.assets ?? []).map((e) => ({ e, re: glob(e.match) }));
  const keys = assetKeys(game, manifest);
  const uncovered: string[] = [], placeholders: string[] = [];
  for (const k of keys) {
    const hit = entries.find(({ re }) => re.test(k));
    if (!hit) uncovered.push(k);
    else if (hit.e.status === 'placeholder') placeholders.push(k);
  }
  const incomplete = (prov.assets ?? []).filter((e) => !e.match || !e.source?.trim() || !e.licence?.trim() || (e.status !== 'final' && e.status !== 'placeholder')).map((e) => e.match || '(no match)');
  return { keys: keys.length, uncovered, placeholders, incomplete };
}
