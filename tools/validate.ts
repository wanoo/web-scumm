// npm run validate: checks the game content (references, text, geometry). --report: the content profiler (Markdown).
// The game: GAME, otherwise package.json → config.game (see tools/game.ts).
import { resolve } from 'node:path';
import { validate } from '../src/engine/tools/validate';
import { report, reportMarkdown } from '../src/engine/tools/report';
import { loadAssets, loadLayouts } from '../src/engine/tools/load';
import { GAME, GAME_DIR, loadGameModule } from './game';

const mod = await loadGameModule();
const game = mod.game;
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const assets = loadAssets(resolve(GAME_DIR, 'assets.gen.json'));
let minigames: Record<string, { required?: string[] }> | undefined;
try { minigames = { ...(await import('../src/engine/minigames/index')).minigames, ...(mod.minigames ?? {}) }; } catch { minigames = undefined; }
const minigameIds = minigames ? Object.keys(minigames) : undefined;
const minigameParams = minigames ? Object.fromEntries(Object.entries(minigames).map(([k, m]) => [k, m.required ?? []])) : undefined;

if (process.argv.includes('--report')) { process.stdout.write(reportMarkdown(report(game, layouts))); process.exit(0); }
const { errors, warnings } = validate(game, layouts, { assets, minigameIds, minigameParams });
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
