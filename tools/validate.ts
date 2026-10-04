// npm run validate: checks the game content (references, text, geometry). --report: the content profiler (Markdown).
// --release: a line without a stable id is reported (an error when the game has voices, else a warning), and the
//   asset provenance (games/<id>/provenance.json) is required: every asset covered by exactly one entry, and a
//   placeholder is an error unless a releaseExceptions entry names it. A game that ships a language other than its own
//   (`game.lang`, default en) or voices needs a stable id on every line.
// Without --release, a game that has provenance.json gets the same coverage check.
// The game: GAME, otherwise package.json → config.game (see tools/game.ts).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { placeholderVerdict, provenanceReport, type Provenance } from '../src/engine/tools/provenance';
import { validate } from '../src/engine/tools/validate';
import { report, reportMarkdown } from '../src/engine/tools/report';
import { loadAssets, loadLayouts, loadLocales } from '../src/engine/tools/load';
import { GAME, GAME_DIR, loadGameModule } from './game';

const mod = await loadGameModule();
const game = mod.game;
const release = process.argv.includes('--release');
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const assets = loadAssets(resolve(GAME_DIR, 'assets.gen.json'));
let minigames: Record<string, { required?: string[] }> | undefined;
try { minigames = { ...(await import('../src/engine/minigames/index')).minigames, ...(mod.minigames ?? {}) }; } catch { minigames = undefined; }
const minigameIds = minigames ? Object.keys(minigames) : undefined;
const minigameParams = minigames ? Object.fromEntries(Object.entries(minigames).map(([k, m]) => [k, m.required ?? []])) : undefined;
const minigameBindings = minigames ? Object.fromEntries(Object.entries(minigames).map(([k, m]) => [k, (m as { bindings?: { images?: string[]; sfx?: string[] } }).bindings ?? {}])) : undefined;

if (process.argv.includes('--report')) { process.stdout.write(reportMarkdown(report(game, layouts, { locales: loadLocales(resolve(GAME_DIR, 'locales')) }))); process.exit(0); }
const { errors, warnings } = validate(game, layouts, { assets, minigameIds, minigameParams, minigameBindings, commands: mod.commands, release, translated: Object.keys(loadLocales(resolve(GAME_DIR, 'locales'))).some((l) => l !== (game.lang ?? 'en')) });
// Asset provenance: where every shipped image and sound comes from, and under which licence.
const provFile = resolve(GAME_DIR, 'provenance.json');
if (existsSync(provFile) && assets) {
  const r = provenanceReport(game, { images: assets.images, videos: (JSON.parse(readFileSync(resolve(GAME_DIR, 'assets.gen.json'), 'utf8')) as { videos?: Record<string, unknown> }).videos }, JSON.parse(readFileSync(provFile, 'utf8')) as Provenance);
  for (const k of r.uncovered) errors.push(`provenance.json › ${k}: no entry says where this asset comes from`);
  for (const m of r.incomplete) errors.push(`provenance.json › ${m}: an entry needs match, source, licence and status (final | placeholder)`);
  for (const a of r.ambiguous) errors.push(`provenance.json › ${a}: more than one entry matches this asset; make the patterns disjoint`);
  const prov = JSON.parse(readFileSync(provFile, 'utf8')) as Provenance;
  if (release) { const v = placeholderVerdict(prov, r); errors.push(...v.errors); warnings.push(...v.warnings); }
} else if (release) errors.push('provenance.json › missing: a release says where every asset comes from (docs/en/TOOLS.md "Asset provenance")');
const quiet = process.argv.includes('--errors');
if (!quiet && warnings.length) {
  console.log(`\n⚠  ${warnings.length} warning(s)`);
  for (const w of warnings) console.log('   ' + w);
}
if (errors.length) {
  console.log(`\n✖  ${errors.length} error(s)`);
  for (const e of errors) console.log('   ' + e);
}
console.log(`\n${errors.length ? '✖' : '✔'}  [${GAME}] ${game.rooms.length} room(s), ${Object.keys(game.items).length} items, ${Object.keys(game.characters).length} characters` +
  `${assets ? '' : ' (images not checked: run npm run assets)'}${minigameIds ? '' : ' (minigames not checked)'}`);
process.exit(errors.length ? 1 : 0);
