// npm run game: points `.cache/game` (a symbolic link, ignored by git) at games/<GAME>/, where tsconfig.json's
// `@game` and `@game/*` paths look first, and games/demo second: a fresh checkout type-checks before any link exists
// (4.1.6: 4.1.5 rewrote tsconfig.json, a tracked file, on every `dev` and `build`).
// Vite and Vitest resolve the alias themselves (vite.config.ts); only `tsc` and the editor read tsconfig.json.
// Run automatically by `npm run build`, `npm run check` and `npm run dev`; `GAME=<id> npm run game` switches game.
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { GAME, GAME_DIR, ROOT } from './game';

if (!existsSync(resolve(GAME_DIR, 'index.ts'))) {
  console.error(`✖  games/${GAME}/index.ts not found (GAME=${GAME})`);
  process.exit(1);
}
const link = resolve(ROOT, '.cache', 'game');
const target = resolve(ROOT, 'games', GAME);
mkdirSync(resolve(ROOT, '.cache'), { recursive: true });
let current: string | null = null;
try {
  if (lstatSync(link).isSymbolicLink()) current = resolve(resolve(link, '..'), readlinkSync(link));
} catch {
  /* no link yet */
}
if (current === target) process.exit(0);
if (current !== null || existsSync(link)) unlinkSync(link);
// A junction on Windows needs no privilege; elsewhere a relative link survives a moved checkout.
if (process.platform === 'win32') symlinkSync(target, link, 'junction');
else symlinkSync(relative(resolve(link, '..'), target), link);
console.log(`✔  @game → games/${GAME} (.cache/game)`);
