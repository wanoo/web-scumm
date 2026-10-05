// What a built game ships, file by file (3.7.1): every file under dist/ is either the engine's code, a locked asset of
// this game, a data file the game names, a font with its notice, an icon, or a licence notice. Anything else is an
// intruder (another game's asset, a file dropped into public/): `npm run verify:dist` refuses it, so what the
// provenance lock declares and what the archive holds are the same set. Pure: tools/dist.ts reads the disk.
import { assetPath, type ProvenanceLock } from './provenance';

export type FileKind = 'code' | 'asset' | 'data' | 'font' | 'shell' | 'licence';

/** The notices every build carries under licenses/ (tools/dist.ts writes them). */
export const NOTICES = [
  'licenses/LICENSE',
  'licenses/LICENSE-ASSETS',
  'licenses/CREDITS.md',
  'licenses/THIRD_PARTY_NOTICES.txt',
  'licenses/assets-manifest.json',
] as const;

/** The built folder of a game's assets (dist/assets/…): `assetPath` of a key, under `assets/`. */
export const distPath = (key: string): string | null => {
  const p = assetPath(key);
  return p ? `assets/${p}` : null;
};

// A Vite output name: its name, a dash, eight characters of hash.
const HASHED = /^assets\/(tools\/)?[\w.-]+-[\w-]{8}\.(js|css)$/;
const FONT = /^(assets\/[\w.-]+-[\w-]{8}|fonts\/[\w.-]+)\.(ttf|woff2?|otf)$/;
const SHELL = new Set([
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'og.png',
]);

export interface InventoryInput {
  /** Every file of dist/, by its path inside it (`/`), with its SHA-256. */
  files: Record<string, { sha256: string }>;
  /** The game's provenance lock: the assets it ships, as reviewed (an empty `sha256`: not reviewed yet, not compared). */
  lock: ProvenanceLock;
  /** The data files the game names (`ending.file`): `data/dossier.bin`. */
  data: string[];
  /** A Studio build (STUDIO=1): its page and snapshot are code too. */
  studio?: boolean;
}

export interface InventoryReport {
  kinds: Record<FileKind, number>;
  /** Files no rule accounts for. */
  extra: string[];
  /** Locked assets, named data files or notices that are not there. */
  missing: string[];
  /** Locked assets whose bytes are not the ones reviewed. */
  changed: string[];
}

export function classify(
  path: string,
  assets: Map<string, string>,
  data: Set<string>,
  studio = false,
): FileKind | null {
  if (path.startsWith('licenses/')) return 'licence';
  if (assets.has(path)) return 'asset';
  if (data.has(path)) return 'data';
  if (FONT.test(path)) return 'font';
  if (SHELL.has(path))
    return path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.webmanifest') ? 'code' : 'shell';
  if (HASHED.test(path) || /^workbox-[\w-]+\.js$/.test(path)) return 'code';
  if (studio && (path === 'studio.html' || path.startsWith('studio-demo/'))) return 'code';
  return null;
}

/** Each file of dist/ against the lock: the files that should not be there, those missing, those changed. */
export function inventory(input: InventoryInput): InventoryReport {
  const assets = new Map<string, string>();
  for (const key of Object.keys(input.lock.assets)) {
    const p = distPath(key);
    if (p) assets.set(p, key);
  }
  const data = new Set(input.data);
  const kinds: Record<FileKind, number> = { code: 0, asset: 0, data: 0, font: 0, shell: 0, licence: 0 };
  const extra: string[] = [],
    changed: string[] = [];
  for (const [path, f] of Object.entries(input.files)) {
    const kind = classify(path, assets, data, input.studio);
    if (!kind) {
      extra.push(path);
      continue;
    }
    kinds[kind]++;
    const want = kind === 'asset' ? input.lock.assets[assets.get(path)!].sha256 : '';
    if (want && want !== f.sha256) changed.push(path);
  }
  const want = [...assets.keys(), ...data, ...NOTICES];
  const missing = want.filter((p) => !input.files[p]);
  return { kinds, extra: extra.sort(), missing: missing.sort(), changed: changed.sort() };
}

/**
 * The assets of `dist/assets` that are not this game's (another game's, an orphan): what a build removes. `keys`: the
 * game's asset keys (its graph, lock or not: a game without a lock yet still builds with its files).
 */
export function strayAssets(paths: string[], keys: string[]): string[] {
  const mine = new Set(keys.map(distPath).filter((p): p is string => !!p));
  return paths.filter((p) => /^assets\/(img|audio|video)\//.test(p) && !mine.has(p));
}

/** One line per shipped asset, for licenses/assets-manifest.json: its file, who made it, from what, under which licence. */
export interface ManifestEntry {
  key: string;
  path: string;
  sha256: string;
  bytes: number;
  licence: string;
  status: string;
  author?: string;
  source?: string;
  url?: string;
}

export function assetsManifest(
  lock: ProvenanceLock,
  entries: { match: string; author?: string; source?: string; url?: string }[],
): ManifestEntry[] {
  return Object.entries(lock.assets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, l]) => {
      const e = entries.find((x) => x.match === l.match);
      return {
        key,
        path: distPath(key) ?? '',
        sha256: l.sha256,
        bytes: l.bytes,
        licence: l.licence,
        status: l.status,
        ...(e?.author ? { author: e.author } : {}),
        ...(e?.source ? { source: e.source } : {}),
        ...(e?.url ? { url: e.url } : {}),
      };
    });
}

/** The manifest in the build says what the lock says (same files, same hashes). */
export function manifestMatches(manifest: ManifestEntry[], lock: ProvenanceLock): boolean {
  const keys = Object.keys(lock.assets);
  return manifest.length === keys.length && manifest.every((m) => lock.assets[m.key]?.sha256 === m.sha256);
}

/** The scripts a first visit runs before anything is asked for (3.9): the page's module entry and preloads. */
export function entryScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) out.push(m[1]);
  for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) out.push(m[1]);
  return out;
}

/** The chunks a built module imports statically (`import … from "./x.js"`, `import "./x.js"`), never `import()`. */
export function staticImports(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(
    /(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g,
  ))
    out.add(m[1].slice(2));
  return [...out];
}

/** Every chunk of `assets/` a first visit loads: the entries, then what they import statically, transitively. */
export function initialChunks(html: string, read: (path: string) => string | null): string[] {
  const seen = new Set<string>();
  const queue = entryScripts(html).map((s) => s.replace(/^.*?assets\//, 'assets/'));
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    const code = read(p);
    if (code === null) continue;
    seen.add(p);
    for (const i of staticImports(code)) queue.push(p.replace(/[^/]+$/, '') + i);
  }
  return [...seen];
}
