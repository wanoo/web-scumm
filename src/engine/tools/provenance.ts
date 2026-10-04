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

export interface Provenance {
  assets: ProvenanceEntry[];
  /**
   * The placeholders that may ship anyway, one by one, each with its reason (the engine's sample game: its
   * non-commercial music). Any other placeholder fails `validate --release`; a new one is never covered by accident.
   */
  releaseExceptions?: { match: string; reason: string }[];
}

export interface ProvenanceReport {
  keys: number;
  uncovered: string[];
  placeholders: string[];
  incomplete: string[];
  /** Assets more than one entry matches (`img:*` and `img:hero/*`): which one says the truth is not decided by order. */
  ambiguous: string[];
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
  const uncovered: string[] = [], placeholders: string[] = [], ambiguous: string[] = [];
  for (const k of keys) {
    const hits = entries.filter(({ re }) => re.test(k));
    if (!hits.length) uncovered.push(k);
    else if (hits.length > 1) ambiguous.push(`${k} (${hits.map((h) => h.e.match).join(', ')})`);
    else if (hits[0].e.status === 'placeholder') placeholders.push(k);
  }
  const incomplete = (prov.assets ?? []).filter((e) => !e.match || !e.source?.trim() || !e.licence?.trim() || (e.status !== 'final' && e.status !== 'placeholder')).map((e) => e.match || '(no match)');
  return { keys: keys.length, uncovered, placeholders, incomplete, ambiguous };
}

/** What a release does with each placeholder: an error, unless a `releaseExceptions` entry names it with a reason (then a warning). */
export function placeholderVerdict(prov: Provenance, r: ProvenanceReport): { errors: string[]; warnings: string[] } {
  const ex = (prov.releaseExceptions ?? []).filter((x) => x.match && x.reason?.trim()).map((x) => ({ x, re: glob(x.match) }));
  const errors: string[] = [], warnings: string[] = [];
  for (const k of r.placeholders) {
    const hit = ex.find(({ re }) => re.test(k));
    if (hit) warnings.push(`provenance.json › ${k}: a placeholder ships (release exception: ${hit.x.reason.trim()})`);
    else errors.push(`provenance.json › ${k}: a placeholder would ship; replace it, or add a releaseExceptions entry that names it and says why`);
  }
  return { errors, warnings };
}

