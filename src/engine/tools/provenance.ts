// Where every shipped asset comes from, under which licence, and whether it is final: `games/<id>/provenance.json`.
// Entries match asset keys with `*`: `img:<manifest image id>`, `sfx:<file>`, `music:<file>`, `voice:<file>`,
// `video:<file>`. `npm run validate` checks a game that has the file (every asset covered, every entry complete);
// `npm run validate -- --release` requires the file, a licence policy (`licences.allow`) and the lock
// (`provenance.lock.json`, `npm run provenance -- --lock`): the hash and size of every shipped file with the claims made
// about it when it was reviewed. A file that changed, a new asset, a claim edited since, or a licence the policy does
// not allow is an error, unless a `releaseExceptions` entry names that asset and says why.
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
  /** The licences this game may ship under (`CC BY 4.0`, `own work`…): any other one fails a release, unless excepted. */
  licences?: { allow: string[] };
}

/** One shipped file as reviewed: its content and the claims its entry made then. */
export interface LockEntry { sha256: string; bytes: number; match: string; licence: string; status: 'final' | 'placeholder' }
/** `provenance.lock.json`: written by `npm run provenance -- --lock` after a review, checked by `validate --release`. */
export interface ProvenanceLock { version: 1; assets: Record<string, LockEntry> }
/** What a shipped file is now: null when it is missing. */
export type FileFacts = { sha256: string; bytes: number } | null;

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

/** Where an asset key's file is, under the built assets folder (`public/assets`). */
export function assetPath(key: string): string | null {
  const i = key.indexOf(':');
  const kind = key.slice(0, i), id = key.slice(i + 1);
  switch (kind) {
    case 'img': return `img/${id}.webp`;
    case 'sfx': return `audio/sfx/${id}`;
    case 'music': return `audio/music/${id}`;
    case 'voice': return `audio/voices/${id}`;
    case 'video': return `video/${id}`;
    default: return null;
  }
}

/** The entry that covers a key (the first one: an ambiguous key is an error of its own). */
export function entryOf(prov: Provenance, key: string): ProvenanceEntry | undefined {
  return (prov.assets ?? []).find((e) => glob(e.match).test(key));
}

/** The lock of the files as they are now, with the claims of their entries. Missing files are left out. */
export function makeLock(keys: string[], prov: Provenance, files: Record<string, FileFacts>): ProvenanceLock {
  const assets: Record<string, LockEntry> = {};
  for (const k of [...keys].sort()) {
    const f = files[k], e = entryOf(prov, k);
    if (f && e) assets[k] = { sha256: f.sha256, bytes: f.bytes, match: e.match, licence: e.licence, status: e.status };
  }
  return { version: 1, assets };
}

export interface LockDiff {
  /** Shipped, but no file on disk. */
  missing: string[];
  /** Not in the lock: shipped since the last review. */
  added: string[];
  /** In the lock, no longer shipped. */
  removed: string[];
  /** A different file than the one reviewed. */
  changed: string[];
  /** The same file, but its entry now says something else (source pattern, licence, status). */
  claims: string[];
}

export function lockDiff(keys: string[], prov: Provenance, files: Record<string, FileFacts>, lock: ProvenanceLock): LockDiff {
  const d: LockDiff = { missing: [], added: [], removed: [], changed: [], claims: [] };
  const now = new Set(keys);
  for (const k of [...keys].sort()) {
    const f = files[k], l = lock.assets[k], e = entryOf(prov, k);
    if (!f) { d.missing.push(k); continue; }
    if (!l) { d.added.push(k); continue; }
    if (l.sha256 !== f.sha256 || l.bytes !== f.bytes) d.changed.push(k);
    else if (e && (l.match !== e.match || l.licence !== e.licence || l.status !== e.status)) d.claims.push(k);
  }
  for (const k of Object.keys(lock.assets).sort()) if (!now.has(k)) d.removed.push(k);
  return d;
}

/** The lock as release errors (`validate --release`) or warnings (plain `validate`). */
export function lockMessages(d: LockDiff): string[] {
  const fix = 'review it, then npm run provenance -- --lock';
  return [
    ...d.missing.map((k) => `provenance.lock.json › ${k}: the file is missing (${assetPath(k) ?? '?'})`),
    ...d.added.map((k) => `provenance.lock.json › ${k}: shipped but never reviewed (${fix})`),
    ...d.changed.map((k) => `provenance.lock.json › ${k}: the file changed since its provenance was reviewed (${fix})`),
    ...d.claims.map((k) => `provenance.lock.json › ${k}: its provenance entry changed since the review (${fix})`),
  ];
}

/** Licences in a release: one the policy does not allow is an error, unless a `releaseExceptions` entry names the asset. */
export function licenceVerdict(keys: string[], prov: Provenance): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const allow = (prov.licences?.allow ?? []).map((x) => x.trim()).filter(Boolean);
  if (!allow.length) return { errors: ['provenance.json › licences: a release says which licences may ship (`licences: { allow: [...] }`)'], warnings };
  const ex = (prov.releaseExceptions ?? []).filter((x) => x.match && x.reason?.trim()).map((x) => ({ x, re: glob(x.match) }));
  const bad = new Map<string, string[]>();
  for (const k of keys) {
    const e = entryOf(prov, k);
    if (!e || allow.includes(e.licence.trim())) continue;
    const hit = ex.find(({ re }) => re.test(k));
    if (hit) warnings.push(`provenance.json › ${k}: ships under ${e.licence}, outside the policy (release exception: ${hit.x.reason.trim()})`);
    else (bad.get(e.licence) ?? (bad.set(e.licence, []), bad.get(e.licence)!)).push(k);
  }
  for (const [lic, ks] of bad) errors.push(`provenance.json › ${lic}: not in licences.allow (${allow.join(', ')}), used by ${ks.length} asset(s): ${ks.slice(0, 5).join(', ')}${ks.length > 5 ? '…' : ''}`);
  return { errors, warnings };
}

