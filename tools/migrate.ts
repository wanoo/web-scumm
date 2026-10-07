// web-scumm migrate (3.9): brings the game's sources to the authoring schema of the installed engine. The schema is
// `schemaVersion` in defineGame (docs/en/UPGRADING.md, docs/en/SUPPORT.md): 3 is the current one. A game on 3 has
// nothing to do; an older game gets its stable ids written (`npm run ids -- --write --map`) and the steps left to do
// by hand are printed. `--check`: exit 1 when a migration is due, write nothing.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME, loadGameModule } from './game';
import { tsconfigWithoutBaseUrl } from './migrate-tsconfig';

export const CURRENT_SCHEMA = 3;

// The project's own tsconfig (project mode, 3.9): brought to what TypeScript 7 accepts, whatever the schema says.
const tsconfig = resolve(process.cwd(), 'tsconfig.json');
if (process.env.WEB_SCUMM_PROJECT && existsSync(tsconfig)) {
  const next = tsconfigWithoutBaseUrl(readFileSync(tsconfig, 'utf8'));
  if (next && process.argv.includes('--check')) {
    console.error(
      `✖  tsconfig.json has \`baseUrl\`, which TypeScript 7 refuses: a migration is due (web-scumm migrate)`,
    );
    process.exit(1);
  }
  if (next) {
    writeFileSync(tsconfig, next);
    console.log('✔  tsconfig.json: `baseUrl` removed, its `paths` made relative (TypeScript 7, 4.1.8)');
  }
}
const { game } = await loadGameModule();
const at = game.schemaVersion ?? 2;
if (at === CURRENT_SCHEMA) {
  console.log(`✔  [${GAME}] authoring schema ${at}: up to date with this engine`);
  process.exit(0);
}
if (at > CURRENT_SCHEMA) {
  console.error(
    `✖  [${GAME}] authoring schema ${at} is newer than this engine's (${CURRENT_SCHEMA}): install a newer web-scumm`,
  );
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.error(`✖  [${GAME}] authoring schema ${at}: a migration to ${CURRENT_SCHEMA} is due (web-scumm migrate)`);
  process.exit(1);
}
console.log(`[${GAME}] authoring schema ${at} → ${CURRENT_SCHEMA}: writing stable ids (docs/en/UPGRADING.md)`);
const r = spawnSync(
  process.execPath,
  [...process.execArgv, resolve(import.meta.dirname, 'ids.ts'), '--write', '--map'],
  { stdio: 'inherit', env: process.env },
);
process.exit(r.status ?? 1);
