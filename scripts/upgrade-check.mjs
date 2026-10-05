// npm run upgrade-check -- --from=<version | path to a web-scumm tarball> (4.0): a game moved from one release of the
// engine to this one, the way a team would. The game is created with the older package (its template, its command),
// verified, and a save is made in it by that engine (the witness's first half, through `web-scumm/testing`). Then the
// project installs this repository's package (scripts/pack.mjs), runs `web-scumm migrate --check`, `verify` and
// `build`, and loads the old save with the new engine, which must reach the ending from it. --from=<version> takes
// the tarball attached to that GitHub release. Exit 0 when every step passes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const from = process.argv.find((a) => a.startsWith('--from='))?.slice(7);
if (!from) { console.error('usage: npm run upgrade-check -- --from=<version | web-scumm-x.y.z.tgz>'); process.exit(2); }
const base = mkdtempSync(join(tmpdir(), 'web-scumm-upgrade-'));
const env = { ...process.env, GAME: '', GAME_DIR: '', WEB_SCUMM_PROJECT: '' };
const run = (title, cmd, args, cwd) => { console.log(`\n▶ ${title}`); return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], env, encoding: 'utf8', maxBuffer: 1 << 26 }); };
const show = (title, cmd, args, cwd) => { console.log(`\n▶ ${title}`); execFileSync(cmd, args, { cwd, stdio: 'inherit', env }); };

let oldTgz = resolve(from);
if (!existsSync(oldTgz)) {
  show(`download web-scumm ${from}`, 'gh', ['release', 'download', `v${from}`, '-R', 'wanoo/web-scumm', '-p', `web-scumm-${from}.tgz`, '-D', base], base);
  oldTgz = join(base, `web-scumm-${from}.tgz`);
}
show('create the game with the older engine', 'tar', ['-xzf', oldTgz, '-C', base], base);
const oldVersion = JSON.parse(readFileSync(join(base, 'package', 'package.json'), 'utf8')).version;
show('create', process.execPath, [join(base, 'package', 'cli', 'create.mjs'), 'keeper', 'The Keeper', `--engine=file:${oldTgz}`], base);
rmSync(join(base, 'package'), { recursive: true, force: true });
const game = join(base, 'keeper');
show('install', 'npm', ['install', '--no-audit', '--no-fund'], game);
show(`assets on ${oldVersion}`, 'npx', ['web-scumm', 'assets'], game);
show(`verify on ${oldVersion}`, 'npx', ['web-scumm', 'verify'], game);

// A save made by the older engine: the witness's first half, then the envelope that engine writes.
writeFileSync(join(game, 'make-save.ts'), `import { Engine, FakePresenter, MemoryStore, saveEnvelope, solve } from 'web-scumm/testing';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { game } from './game/game';
const layouts = Object.fromEntries(readdirSync('game/layout').map((f) => [f.replace('.json', ''), JSON.parse(readFileSync('game/layout/' + f, 'utf8'))]));
const r = await solve(game, layouts, { mode: 'witness' });
const e = new Engine(game, layouts, new FakePresenter(), new MemoryStore());
await e.newGame();
const half = r.steps.slice(0, Math.max(1, Math.floor(r.steps.length / 2)));
for (const s of half as { act?: { verb: string; a: string; b?: string } }[]) if (s.act) await e.act(s.act);
writeFileSync('old-save.json', JSON.stringify(saveEnvelope(game, e.state)));
console.log('saved after', half.length, 'of', r.steps.length, 'steps in', e.state.room);
`);
show(`a save made by ${oldVersion}`, 'npx', ['tsx', '--tsconfig', 'tsconfig.json', 'make-save.ts'], game);

const pack = join(base, 'pack');
run('pack this engine', process.execPath, [join(ROOT, 'scripts', 'pack.mjs'), `--out=${pack}`], ROOT);
const newVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
show(`upgrade to ${newVersion}`, 'npm', ['install', '--no-audit', '--no-fund', join(pack, `web-scumm-${newVersion}.tgz`)], game);
show('migrate --check', 'npx', ['web-scumm', 'migrate', '--check'], game);
show(`assets on ${newVersion}`, 'npx', ['web-scumm', 'assets'], game);
show(`verify on ${newVersion}`, 'npx', ['web-scumm', 'verify'], game);
show(`build on ${newVersion}`, 'npx', ['web-scumm', 'build'], game);

writeFileSync(join(game, 'load-save.ts'), `import { Engine, FakePresenter, MemoryStore, parseSave, solve } from 'web-scumm/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { game } from './game/game';
const layouts = Object.fromEntries(readdirSync('game/layout').map((f) => [f.replace('.json', ''), JSON.parse(readFileSync('game/layout/' + f, 'utf8'))]));
const state = parseSave(game, JSON.parse(readFileSync('old-save.json', 'utf8')));
const e = new Engine(game, layouts, new FakePresenter(), new MemoryStore());
await e.load(state);
const r = await solve(game, layouts, { mode: 'witness', start: { state: e.state } });
if (r.status !== 'solved') { console.error('the old save no longer reaches the ending:', r.status); process.exit(1); }
console.log('the old save loads in', e.state.room, 'and reaches the ending in', r.steps.length, 'steps');
`);
show(`the ${oldVersion} save on ${newVersion}`, 'npx', ['tsx', '--tsconfig', 'tsconfig.json', 'load-save.ts'], game);
if (!process.argv.includes('--keep')) rmSync(base, { recursive: true, force: true });
console.log(`\n✔  upgrade: a game made on web-scumm ${oldVersion} moves to ${newVersion}; its save loads and reaches the ending`);
