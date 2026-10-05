// npm run ids [-- --write] [--map] [--lines | --lines=all]
// Gives the current game's rules, topics, listeners, choices, once/nth/cycle/random blocks and script steps their
// stable ids (schema v3). Without flags: a dry run that prints what would be written and what must be done by hand.
// --write: edits games/<id>/rooms/*.ts, rules.ts and game.ts in place (quotes and indentation kept), and renames the
//          keys of games/<id>/locales/*.json to the id-based paths.
// --map:   writes games/<id>/ids.migration.json (the `renameSeen` / `renameCounter` step for `migrations`) and
//          games/<id>/ids.paths.json (old translation path → new), and prints the three manual steps.
// --lines: also give every `say` / `toast` / `guide` object, every `{ id, text }` line of a list (looks, hints,
//          fallback answers), every hint and every reaction by kind a stable id (translations and voice clips follow
//          it); --lines=all first turns every plain string line into `{ say: ['hero', text], id }` and every plain
//          string of a list into `{ id, text }` (verbose, for a game that voices or translates every line). Without
//          it, lines stay keyed by their position inside their owner.
// The game: GAME, else package.json → config.game (tools/game.ts). Safe to run again: nothing is renamed twice.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assignIds, renamePaths } from '../src/engine/core/content-ids';
import { GAME, GAME_DIR, ROOT, WORK, loadGameModule } from './game';
import {
  addIdsToGameSource,
  addIdsToItemsSource,
  addIdsToRoomSource,
  addIdsToRulesSource,
  roomIdOf,
  type CodemodResult,
} from './ids/codemod';

const write = process.argv.includes('--write');
const wantMap = process.argv.includes('--map');
const linesArg = process.argv.find((a) => a === '--lines' || a.startsWith('--lines='));
const lines = linesArg === '--lines=all' ? ('all' as const) : linesArg ? true : false;
const { game } = await loadGameModule();
const { game: assigned, map, added } = assignIds(game, { lines });

const rel = (f: string) => relative(WORK, f);
const results: { file: string; r: CodemodResult }[] = [];
const roomsDir = join(GAME_DIR, 'rooms');
for (const f of existsSync(roomsDir)
  ? readdirSync(roomsDir)
      .filter((x) => x.endsWith('.ts'))
      .sort()
  : []) {
  const file = join(roomsDir, f);
  const code = readFileSync(file, 'utf8');
  const id = roomIdOf(code, f);
  const room = assigned.rooms.find((r) => r.id === id);
  if (!room) {
    console.log(`  ${rel(file)}: no room of the game has id "${id}" (skipped)`);
    continue;
  }
  results.push({ file, r: addIdsToRoomSource(code, room, f) });
}
const rulesFile = join(GAME_DIR, 'rules.ts');
if (existsSync(rulesFile))
  results.push({
    file: rulesFile,
    r: addIdsToRulesSource(readFileSync(rulesFile, 'utf8'), assigned.rules, 'rules.ts'),
  });
const itemsFile = join(GAME_DIR, 'items.ts');
if (existsSync(itemsFile))
  results.push({
    file: itemsFile,
    r: addIdsToItemsSource(readFileSync(itemsFile, 'utf8'), assigned.items, 'items.ts'),
  });
const gameFile = join(GAME_DIR, 'game.ts');
if (existsSync(gameFile))
  results.push({ file: gameFile, r: addIdsToGameSource(readFileSync(gameFile, 'utf8'), assigned, 'game.ts') });

let inserted = 0,
  skipped = 0;
for (const { file, r } of results) {
  if (!r.inserted.length && !r.skipped.length) continue;
  console.log(
    `${rel(file)}: ${r.inserted.length} id(s)${r.skipped.length ? `, ${r.skipped.length} to do by hand` : ''}`,
  );
  for (const s of r.skipped)
    console.log(`  ✖ line ${s.line} ${s.path}: ${s.reason}${s.expected ? ` → write id: '${s.expected}'` : ''}`);
  inserted += r.inserted.length;
  skipped += r.skipped.length;
}
console.log(
  `\n[${GAME}] ${added} id(s) assigned in memory, ${inserted} written to the sources${write ? '' : ' (dry run: add --write)'}, ${skipped} skipped${game.schemaVersion === 3 ? '' : '; the game is still schema 2'}`,
);

if (write) {
  for (const { file, r } of results) if (r.inserted.length) writeFileSync(file, r.code);
  const dir = join(GAME_DIR, 'locales');
  if (existsSync(dir))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const file = join(dir, f);
      const table = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      const { _: header, ...rest } = table;
      const renamed = renamePaths(rest, map.paths);
      const moved = Object.keys(rest).filter((k) => !(k in renamed)).length;
      writeFileSync(file, JSON.stringify({ _: header, ...renamed }, null, 1) + '\n');
      console.log(`${rel(file)}: ${moved} path(s) renamed to ids`);
    }
}

if (wantMap) {
  // A second pass (line ids on a schema-3 game) adds to the files of the first: nothing already recorded is lost.
  const readJson = (f: string) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  const prev = readJson(join(GAME_DIR, 'ids.migration.json'));
  const moved = Object.keys(map.seen).length + Object.keys(map.counters).length;
  const migration =
    moved || !prev
      ? {
          from: (prev?.from as number | undefined) ?? game.saveVersion,
          renameSeen: { ...((prev?.renameSeen as Record<string, string>) ?? {}), ...map.seen },
          renameCounter: { ...((prev?.renameCounter as Record<string, string>) ?? {}), ...map.counters },
        }
      : prev;
  writeFileSync(join(GAME_DIR, 'ids.migration.json'), JSON.stringify(migration, null, 2) + '\n');
  const prevPaths = (readJson(join(GAME_DIR, 'ids.paths.json')) as Record<string, string> | undefined) ?? {};
  writeFileSync(join(GAME_DIR, 'ids.paths.json'), JSON.stringify({ ...prevPaths, ...map.paths }, null, 2) + '\n');
  console.log(
    `\nWritten: ${rel(join(GAME_DIR, 'ids.migration.json'))} (${Object.keys(map.seen).length} seen, ${Object.keys(map.counters).length} counter keys), ${rel(join(GAME_DIR, 'ids.paths.json'))} (${Object.keys(map.paths).length} paths)`,
  );
}

const keysMoved = Object.keys(map.seen).length + Object.keys(map.counters).length > 0;
if (!write || (wantMap && keysMoved) || game.schemaVersion !== 3) {
  console.log(`\nTo finish by hand in ${rel(gameFile)}:`);
  console.log(`  1. schemaVersion: 3`);
  console.log(`  2. saveVersion: ${game.saveVersion + 1}`);
  console.log(
    `  3. migrations: [...(migrations ?? []), idsMigration]   // import idsMigration from './ids.migration.json' (npm run ids -- --map)`,
  );
  console.log(`Then: npm run validate && npm run i18n -- extract && npm run solve`);
}
