// npm run verify:dist [-- --dir=dist] [--json]: every file of the built game, accounted for (3.7.1). The engine's
// code, this game's locked assets (the bytes reviewed), the data files it names, the fonts, the icons and the notices
// under licenses/; anything else (another game's asset, a stray file) fails, and so does a locked file missing.
// `seal <dir>` (vite.config.ts runs it after every build): removes from <dir>/assets the files that are not this
// game's, then writes <dir>/licenses/ (engine and asset licences, credits, third-party notices, assets manifest).
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { assetsManifest, initialChunks, inventory, manifestMatches, strayAssets, type ManifestEntry } from '../src/engine/tools/inventory';
import { GAME, GAME_DIR, ROOT, loadGameModule } from './game';
import { LOCK, PROVENANCE, readJson, shippedKeys, type Provenance, type ProvenanceLock } from './provenance-files';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const seal = args[0] === 'seal';
const dir = resolve(seal ? (args[1] ?? 'dist') : (arg('dir') ?? 'dist'));

function walk(d: string, out: string[] = []): string[] {
  for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
const rel = (p: string) => relative(dir, p).split('\\').join('/');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

if (!existsSync(dir)) { console.error(`✖  [${GAME}] ${relative(ROOT, dir)}: no build (npm run build first)`); process.exit(1); }
const prov = readJson<Provenance>(PROVENANCE) ?? { assets: [] };
const { game } = await loadGameModule();
// A game not locked yet (a new one): its asset graph says what ships, without hashes to compare.
const locked = readJson<ProvenanceLock>(LOCK);
const lock: ProvenanceLock = locked ?? { version: 1, assets: Object.fromEntries(shippedKeys(game).map((k) => [k, { sha256: '', bytes: 0, match: '', licence: '', status: 'placeholder' as const }])) };
const data = game.ending?.file ? [game.ending.file.replace(/^\//, '')] : [];

/** The packages the bundle took code from (vite.config.ts writes the list during the build), plus the service worker's. */
function bundlePackages(): string[] {
  const listed = readJson<string[]>(resolve(ROOT, '.cache', `bundle-packages-${GAME}.json`)) ?? [];
  // The service worker is generated after the bundle (vite-plugin-pwa): its runtime is Workbox's packages.
  const workbox = readdirSync(resolve(ROOT, 'node_modules')).filter((n) => n.startsWith('workbox-') && !/build|cli|webpack|recipes|streams|google-analytics|broadcast|background-sync|navigation-preload/.test(n));
  // And what they depend on: a package's own build may hold its dependencies' code (navmesh holds javascript-astar).
  const all = new Set<string>();
  const add = (p: string) => {
    if (all.has(p) || !existsSync(resolve(ROOT, 'node_modules', p, 'package.json'))) return;
    all.add(p);
    for (const d of Object.keys(readJson<{ dependencies?: Record<string, string> }>(resolve(ROOT, 'node_modules', p, 'package.json'))?.dependencies ?? {})) add(d);
  };
  for (const p of [...listed, ...workbox]) add(p);
  return [...all].sort();
}

function licenceText(pkg: string): { version: string; licence: string; text: string } {
  const base = resolve(ROOT, 'node_modules', pkg);
  const meta = readJson<{ version?: string; license?: string }>(join(base, 'package.json')) ?? {};
  const file = existsSync(base) ? readdirSync(base).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f)) : undefined;
  return { version: meta.version ?? '?', licence: meta.license ?? '?', text: file ? readFileSync(join(base, file), 'utf8').trim() : `(${meta.license ?? 'licence'}: no licence file in the package)` };
}

function credits(): string {
  const lines = [`# Credits: ${game.title ?? GAME}`, '', 'Built with web-scumm (MIT, see LICENSE). Assets of this game, by entry of its provenance (assets-manifest.json lists every file):', ''];
  for (const e of prov.assets ?? []) {
    const n = Object.values(lock.assets).filter((l) => l.match === e.match).length;
    if (!n) continue;
    lines.push(`- \`${e.match}\` (${n} file${n > 1 ? 's' : ''}): ${e.author ? `${e.author}, ` : ''}${e.licence}. ${e.source}${e.url ? ` <${e.url}>` : ''}`);
  }
  lines.push('', 'Fonts: DotGothic16 (Fontworks) and Press Start 2P (CodeMan38), SIL Open Font License 1.1: THIRD_PARTY_NOTICES.txt.', '');
  return lines.join('\n');
}

if (seal) {
  const stray = strayAssets(walk(resolve(dir, 'assets')).map(rel), shippedKeys(game));
  for (const p of stray) rmSync(resolve(dir, p));
  // Data files another game names (public/data is shared by the games of the repository).
  if (existsSync(resolve(dir, 'data'))) for (const p of walk(resolve(dir, 'data')).map(rel)) if (!data.includes(p)) rmSync(resolve(dir, p));
  // Folders left empty (another game's images, data) go too.
  const prune = (d: string): boolean => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory() && prune(p)) rmSync(p, { recursive: true }); } return readdirSync(d).length === 0; };
  prune(dir);
  const out = resolve(dir, 'licenses');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'LICENSE'), readFileSync(resolve(ROOT, 'LICENSE')));
  const assetsLicence = [resolve(GAME_DIR, 'LICENSE-ASSETS'), resolve(ROOT, 'LICENSE-ASSETS')].find(existsSync)!;
  writeFileSync(join(out, 'LICENSE-ASSETS'), readFileSync(assetsLicence));
  writeFileSync(join(out, 'CREDITS.md'), credits());
  const pkgs = bundlePackages();
  const notices = [
    `Third-party software and fonts in this build of ${game.title ?? GAME}.`, '',
    ...pkgs.flatMap((p) => { const l = licenceText(p); return ['='.repeat(72), `${p} ${l.version} (${l.licence})`, '='.repeat(72), l.text, '']; }),
    '='.repeat(72), 'Fonts', '='.repeat(72), readFileSync(resolve(ROOT, 'src/engine/dom/fonts/OFL.txt'), 'utf8'),
  ];
  writeFileSync(join(out, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
  writeFileSync(join(out, 'assets-manifest.json'), JSON.stringify({ game: game.id, assets: assetsManifest(lock, prov.assets ?? []) }, null, 1) + '\n');
  console.log(`[${GAME}] sealed ${relative(ROOT, dir)}: ${stray.length} file(s) of other games removed, licenses/ written (${pkgs.length} packages)`);
  process.exit(0);
}

const files: Record<string, { sha256: string }> = {};
for (const p of walk(dir)) files[rel(p)] = { sha256: sha(p) };
const r = inventory({ files, lock, data, studio: existsSync(resolve(dir, 'studio.html')) });
const manifest = readJson<{ assets: ManifestEntry[] }>(resolve(dir, 'licenses/assets-manifest.json'));
// The JavaScript of a first visit, gzipped (3.9): held to `assetBudgets.initialJsKB` when the game sets it.
const html = existsSync(resolve(dir, 'index.html')) ? readFileSync(resolve(dir, 'index.html'), 'utf8') : '';
const initial = initialChunks(html, (p) => (existsSync(resolve(dir, p)) ? readFileSync(resolve(dir, p), 'utf8') : null));
const initialJsKB = Math.round(initial.reduce((n, p) => n + gzipSync(readFileSync(resolve(dir, p)), { level: 9 }).length, 0) / 1024);
const jsBudget = game.assetBudgets?.initialJsKB;
const problems = [
  ...(jsBudget !== undefined && initialJsKB > jsBudget ? [`first visit's JavaScript: ${initialJsKB} KB gzipped, over initialJsKB ${jsBudget} (${initial.join(', ')})`] : []),
  ...r.extra.map((p) => `${p}: not this game's (no lock entry, not code, not a notice)`),
  ...r.missing.map((p) => `${p}: missing`),
  ...r.changed.map((p) => `${p}: not the file reviewed (its hash differs from provenance.lock.json)`),
  ...(manifest && !manifestMatches(manifest.assets, lock) ? ['licenses/assets-manifest.json: does not match provenance.lock.json'] : []),
];
if (args.includes('--json')) console.log(JSON.stringify({ ...r, initialJsKB, problems }));
else {
  console.log(`[${GAME}] ${relative(ROOT, dir)}: ${Object.keys(files).length} files · ${Object.entries(r.kinds).map(([k, n]) => `${n} ${k}`).join(', ')} · first visit's JavaScript ${initialJsKB} KB gzipped${jsBudget !== undefined ? ` (initialJsKB ${jsBudget})` : ''}`);
  for (const p of problems.slice(0, 40)) console.log('  ✖ ' + p);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
  if (!locked) console.log(`  ℹ no provenance.lock.json: the files are not compared to a review (npm run provenance -- --lock)`);
  console.log(problems.length ? `✖  [${GAME}] the build ships ${problems.length} thing(s) the provenance does not account for` : `✔  [${GAME}] every file of the build is accounted for`);
}
process.exit(problems.length ? 1 : 0);
