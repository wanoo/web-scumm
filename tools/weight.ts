// npm run weight: what a player downloads before the first room is playable, per room, and per chapter (every room a
// player can be in during it, from the proof by chapters), against `assetBudgets` (`initialKB`, `roomKB`, `chapterKB`). Sizes are the
// built files (public/assets, `ASSETS_DIR` for a fixture). Exit codes: 0 within budget, 1 over a budget or a file
// missing (`--release`: or a budget not set, the step of `verify:release`). `--json` for tools. docs/en/TOOLS.md "Weight".
import { statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetPath } from '../src/engine/tools/provenance';
import { proveChapters } from '../src/engine/tools/chapters';
import { initialAssets, roomAssets, weightReport } from '../src/engine/tools/weight';
import { loadLayouts } from '../src/engine/tools/load';
import { ASSETS_DIR, GAME, GAME_DIR, loadGameModule } from './game';

const mod = await loadGameModule();
const game = mod.game;
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const keys = new Set<string>([...initialAssets(game), ...game.rooms.flatMap((r) => roomAssets(game, r))]);
const sizes: Record<string, number | null> = {};
for (const k of keys) { const p = assetPath(k); const f = p ? resolve(ASSETS_DIR, p) : null; sizes[k] = f && existsSync(f) ? statSync(f).size : null; }

// Chapters: every room a player can be in during each chapter (the proof by chapters explores them all, from every
// boundary state), including the rooms where it ends.
const chapters: { id: string; rooms: string[] }[] = [];
if (Object.values(game.checkpoints ?? {}).some((c) => c.goals?.length)) {
  const p = await proveChapters(game, layouts, { commands: mod.commands });
  for (const c of p.chapters) chapters.push({ id: c.id, rooms: [...new Set(c.results.flatMap((r) => [...r.roomsReached, ...r.boundaries.map((b) => b.room)]))].sort() });
}

const rep = weightReport(game, sizes, chapters);
const kb = (b: number) => `${Math.round(b / 1024)} KB`;
const b = game.assetBudgets ?? {};
const missing = [...new Set([rep.initial, ...rep.rooms, ...rep.chapters].flatMap((w) => w.missing))];
if (process.argv.includes('--json')) { console.log(JSON.stringify({ ...rep, budgets: b, missing })); process.exit(rep.over.length || missing.length ? 1 : 0); }
console.log(`[${GAME}] what a player downloads (built files in ${ASSETS_DIR.replace(process.cwd() + '/', '')})`);
console.log(`  initial    ${kb(rep.initial.bytes).padStart(9)}  ${rep.initial.files} files${b.initialKB !== undefined ? `  (budget ${b.initialKB} KB)` : ''}`);
for (const r of rep.rooms) console.log(`  room       ${kb(r.bytes).padStart(9)}  ${r.id}${b.roomKB !== undefined ? `  (budget ${b.roomKB} KB)` : ''}`);
for (const c of rep.chapters) console.log(`  chapter    ${kb(c.bytes).padStart(9)}  ${c.id}: ${c.rooms.join(', ')}${b.chapterKB !== undefined ? `  (budget ${b.chapterKB} KB)` : ''}`);
for (const m of missing) console.log(`  ✖ ${m}: no built file (npm run assets)`);
for (const o of rep.over) console.log(`  ✖ ${o}`);
const release = process.argv.includes('--release');
const unset = (['initialKB', 'roomKB', 'chapterKB'] as const).filter((k) => b[k] === undefined);
if (unset.length) console.log(`  ${release ? '✖' : 'ℹ'} no ${unset.join(', ')}: set assetBudgets.${unset[0]} (and the others) in game.ts${release ? ': a release says how much it asks a phone to download' : ' to hold the game to them'}`);
const failed = rep.over.length + missing.length + (release ? unset.length : 0);
console.log(`${failed ? '✖' : '✔'}  [${GAME}] ${rep.over.length ? `${rep.over.length} budget(s) exceeded` : missing.length ? `${missing.length} file(s) missing` : release && unset.length ? 'no weight budget' : 'within budget'}`);
process.exit(failed ? 1 : 0);
