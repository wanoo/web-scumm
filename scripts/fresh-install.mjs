// npm run fresh-install [-- --dir=<folder>] [--keep] (3.9): the engine used the way another project uses it. Packs
// web-scumm (scripts/pack.mjs), creates a game from the packed template in an empty folder outside the repository,
// installs the tarball, then runs the game's own commands: assets, verify, build (every file of dist/ accounted for),
// and plays it to its ending in a browser (scripts/e2e.mjs on `web-scumm preview`). Nothing in the new project points
// into this repository: a path that does is an error. Exit 0 when every step passes.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('--dir='))?.slice(6) ?? mkdtempSync(join(tmpdir(), 'web-scumm-fresh-'));
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const step = (title, cmd, a, cwd) => {
  console.log(`\n▶ ${title}`);
  execFileSync(cmd, a, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, GAME: '', GAME_DIR: '', WEB_SCUMM_PROJECT: '' },
  });
};

step('pack', process.execPath, [join(ROOT, 'scripts', 'pack.mjs'), `--out=${join(base, 'pack')}`], ROOT);
const tgz = join(base, 'pack', `web-scumm-${version}.tgz`);
step('create', 'tar', ['-xzf', tgz, '-C', base], base);
step(
  'create',
  process.execPath,
  [join(base, 'package', 'cli', 'create.mjs'), 'lantern', 'The Lantern', `--engine=file:${tgz}`],
  base,
);
rmSync(join(base, 'package'), { recursive: true, force: true });
const game = join(base, 'lantern');
step('install', 'npm', ['install', '--no-audit', '--no-fund'], game);

// Nothing the project wrote points into the repository.
const leaks = [];
const scan = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (e === 'node_modules' || e === 'dist') continue;
    if (statSync(p).isDirectory()) scan(p);
    else if (/\.(ts|json|md|mjs)$/.test(e) && readFileSync(p, 'utf8').includes(ROOT)) leaks.push(p);
  }
};
scan(game);
if (leaks.length) {
  console.error(`✖ the project names the repository: ${leaks.join(', ')}`);
  process.exit(1);
}

step('assets', 'npx', ['web-scumm', 'assets'], game);
step('verify', 'npx', ['web-scumm', 'verify'], game);
step('build', 'npx', ['web-scumm', 'build'], game);
if (!existsSync(join(game, 'dist', 'licenses', 'assets-manifest.json'))) {
  console.error('✖ no licenses/ in the build');
  process.exit(1);
}

console.log('\n▶ play it to the end');
const server = spawn('npx', ['web-scumm', 'preview', '--port', '5181', '--strictPort'], {
  cwd: game,
  stdio: 'ignore',
  detached: true,
});
try {
  for (let i = 0; i < 60; i++) {
    try {
      execFileSync('curl', ['-sf', 'http://127.0.0.1:5181/'], { stdio: 'ignore' });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  execFileSync(
    process.execPath,
    [join(ROOT, 'scripts', 'e2e.mjs'), 'http://127.0.0.1:5181/', '--game', 'lantern', '--generic', '--prod'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, GAME: '', WEB_SCUMM_PROJECT: game, E2E_OUT: join(base, 'e2e') },
    },
  );
} finally {
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
}
if (!args.includes('--keep') && !args.some((a) => a.startsWith('--dir=')))
  rmSync(base, { recursive: true, force: true });
console.log(
  `\n✔  fresh install: web-scumm ${version} packed, a game created, verified, built and played outside the repository`,
);
