// npm run game: points the TypeScript alias `@game` (tsconfig.json → paths) at games/<GAME>/.
// Vite and Vitest resolve the alias themselves (vite.config.ts); only `tsc` and the editor read tsconfig.json.
// Run automatically by `npm run build` and `npm run dev`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAME, GAME_DIR, ROOT } from './game';

if (!existsSync(resolve(GAME_DIR, 'index.ts'))) {
  console.error(`✖  games/${GAME}/index.ts not found (GAME=${GAME})`);
  process.exit(1);
}
const file = resolve(ROOT, 'tsconfig.json');
const src = readFileSync(file, 'utf8');
const ts = JSON.parse(src);
const want = { '@game': [`games/${GAME}/index.ts`], '@game/*': [`games/${GAME}/*`] };
const paths = ts.compilerOptions.paths ?? {};
if (JSON.stringify(paths['@game']) === JSON.stringify(want['@game']) && JSON.stringify(paths['@game/*']) === JSON.stringify(want['@game/*'])) process.exit(0);
ts.compilerOptions.paths = { ...paths, ...want };
writeFileSync(file, JSON.stringify(ts, null, 2) + '\n');
console.log(`✔  @game → games/${GAME}`);
