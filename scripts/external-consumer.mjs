#!/usr/bin/env node
// npm run external-consumer -- [--tarballs=<dir>] [--from=<version|tgz>] [--dir=<folder>] [--keep] (4.1.18 "Dress
// Rehearsal", plan §7): the four archives used the way a third party uses them, on Linux, macOS and Windows. The
// tarballs are the candidate run's (`--tarballs=`: never packed again in the line that judges them; without it, this
// checkout is packed, for a local try). Nothing runs from the checkout: a module of this repository is never imported,
// and every file the consumer wrote is searched for the checkout's path.
//
//   1. the archives read: name, version, licence, binaries, exports, no `file:`/`link:` dependency, no checkout path;
//   2. a game created on the older release (`--from`, 4.1.17 by default), its assets, verify, and a save made by that
//      engine; then the candidate installed over it: migrate, migrate --check, assets, verify, build, the old save
//      loaded and played to the ending through `web-scumm/testing`, a new game played to the ending the same way;
//   3. `npx create-web-scumm` from its archive;
//   4. the Bridge from its archive: init, doctor, serve on SQLite (and on Postgres when CONSUMER_PG_URL is set), its
//      keys answered;
//   5. the connectors from their archive (`--omit=optional --ignore-scripts`): every connector's `--help`, then a
//      recorded scenario through the Bridge just installed: a signed email webhook accepted, the same message a
//      duplicate, a bad signature refused.
// Exit 0 when every step passes. Portable: Node's own APIs (no `mv`, `curl` or process groups), npm and npx through the
// shell on Windows.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { upgradeSource } from './upgrade-source.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
const args = process.argv.slice(2);
const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const base = resolve(flag('dir') ?? mkdtempSync(join(tmpdir(), 'web-scumm-consumer-')));
mkdirSync(base, { recursive: true });
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
// The consumer's environment: nothing that points a tool at this repository's game.
const ENV = { ...process.env, GAME: '', GAME_DIR: '', WEB_SCUMM_PROJECT: '', npm_config_audit: 'false', npm_config_fund: 'false' };
let failed = 0;
const fail = (what) => {
  console.error(`✖  ${what}`);
  failed++;
};

/** One command in `cwd`, its output shown; throws on a non-zero exit. npm and npx are .cmd files on Windows. */
function run(title, cmd, a, cwd, o = {}) {
  console.log(`\n▶ ${title}`);
  const shell = WIN && (cmd === 'npm' || cmd === 'npx');
  const r = spawnSync(shell ? `${cmd}.cmd` : cmd, a, {
    cwd,
    stdio: o.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    env: { ...ENV, ...(o.env ?? {}) },
    shell,
  });
  if (r.status !== 0) throw new Error(`${title}: exit ${r.status}${r.error ? ` (${r.error.message})` : ''}`);
  return r.stdout ?? '';
}
const node = (title, a, cwd, o) => run(title, process.execPath, a, cwd, o);
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
/** A tarball unpacked into `into` (its `package/` folder renamed): `tar` is on Linux, macOS and Windows 10+. */
function unpack(tgz, into) {
  const tmp = mkdtempSync(join(base, 'unpack-'));
  run(`unpack ${tgz.split(/[\\/]/).pop()}`, 'tar', ['-xzf', tgz, '-C', tmp], base);
  renameSync(join(tmp, 'package'), into);
  rmSync(tmp, { recursive: true, force: true });
  return into;
}
/** A process left running (a server); stopped by its PID, the whole tree on Windows. */
function serve(cmd, a, cwd) {
  const shell = WIN && (cmd === 'npm' || cmd === 'npx');
  const p = spawn(shell ? `${cmd}.cmd` : cmd, a, { cwd, env: ENV, stdio: 'ignore', shell });
  return {
    stop() {
      if (!p.pid) return;
      if (WIN) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else p.kill('SIGTERM');
    },
  };
}
async function waitFor(url, test = (r) => r.ok, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (await test(r)) return r;
    } catch {
      /* not up yet */
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`${url} never answered`);
}
/** Every text file under `dir` (node_modules and builds left out) that names the checkout or a private engine path. */
function leaksIn(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (['node_modules', 'dist', '.git'].includes(e)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|cjs|json|md)$/.test(e)) {
        const s = readFileSync(p, 'utf8');
        if (s.includes(ROOT) || s.includes(ROOT.replaceAll('\\', '/'))) out.push(`${p}: names the checkout`);
        if (/from\s+['"]@engine\//.test(s)) out.push(`${p}: imports @engine/* (the engine's private alias)`);
      }
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------- the archives
const NAMES = ['web-scumm', 'create-web-scumm', 'web-scumm-bridge', 'web-scumm-connectors'];
let tarballs = flag('tarballs');
if (!tarballs) {
  tarballs = join(base, 'pack');
  node('pack this checkout (no --tarballs: a local try, not a candidate)', [join(ROOT, 'scripts', 'pack.mjs'), `--out=${tarballs}`], ROOT);
}
tarballs = resolve(tarballs);
const tgz = Object.fromEntries(NAMES.map((n) => [n, join(tarballs, `${n}-${version}.tgz`)]));
for (const [n, f] of Object.entries(tgz)) if (!existsSync(f)) throw new Error(`${f}: no ${n} archive of ${version}`);

console.log('\n▶ the archives, read');
for (const [n, f] of Object.entries(tgz)) {
  const dir = unpack(f, join(base, `inspect-${n}`));
  const pkg = json(join(dir, 'package.json'));
  if (pkg.name !== n) fail(`${n}: its package.json says ${pkg.name}`);
  if (pkg.version !== version) fail(`${n}: version ${pkg.version}, not ${version}`);
  if (!pkg.license) fail(`${n}: no licence`);
  for (const [bin, target] of Object.entries(typeof pkg.bin === 'string' ? { [n]: pkg.bin } : (pkg.bin ?? {})))
    if (!existsSync(join(dir, target))) fail(`${n}: its binary ${bin} (${target}) is not in the archive`);
  for (const [k, target] of Object.entries(pkg.exports ?? {}))
    if (typeof target === 'string' && !target.includes('*') && !existsSync(join(dir, target))) fail(`${n}: its export ${k} (${target}) is not in the archive`);
  for (const [d, spec] of Object.entries({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }))
    if (/^(file|link|portal|workspace):/.test(String(spec))) fail(`${n}: depends on ${d} through ${spec}`);
  for (const leak of leaksIn(dir)) if (leak.includes('names the checkout')) fail(`${n}: ${leak}`);
}
if (!failed) console.log(`✔  ${NAMES.length} archives of ${version}: names, version, licence, binaries, exports, dependencies`);

// ---------------------------------------------------------------- a game of the older release, moved to this one
const src = upgradeSource(flag('from') ?? '4.1.17', existsSync);
let oldTgz;
if (src.kind === 'tgz') oldTgz = resolve(src.path);
else {
  if (src.kind === 'previous') throw new Error('--from=previous is upgrade-check\'s; name a version here');
  oldTgz = join(base, src.asset);
  const url = `https://github.com/wanoo/web-scumm/releases/download/${src.tag}/${src.asset}`;
  console.log(`\n▶ the older engine: ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(oldTgz, Buffer.from(await r.arrayBuffer()));
}
const oldPkg = unpack(oldTgz, join(base, 'old-engine'));
const oldVersion = json(join(oldPkg, 'package.json')).version;
node(`create on ${oldVersion}`, [join(oldPkg, 'cli', 'create.mjs'), 'keeper', 'The Keeper', `--engine=file:${oldTgz}`], base);
const game = join(base, 'keeper');
run('install', 'npm', ['install'], game);
run(`assets on ${oldVersion}`, 'npx', ['web-scumm', 'assets'], game);
run(`verify on ${oldVersion}`, 'npx', ['web-scumm', 'verify'], game);
const LAYOUTS =
  "const layouts = Object.fromEntries(readdirSync('game/layout').map((f) => [f.replace('.json', ''), JSON.parse(readFileSync('game/layout/' + f, 'utf8'))]));";
writeFileSync(
  join(game, 'make-save.ts'),
  `import { Engine, FakePresenter, MemoryStore, saveEnvelope, solve } from 'web-scumm/testing';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { game } from './game/game';
${LAYOUTS}
const r = await solve(game, layouts, { mode: 'witness' });
const e = new Engine(game, layouts, new FakePresenter(), new MemoryStore());
await e.newGame();
const half = r.steps.slice(0, Math.max(1, Math.floor(r.steps.length / 2)));
for (const s of half as { act?: { verb: string; a: string; b?: string } }[]) if (s.act) await e.act(s.act);
writeFileSync('old-save.json', JSON.stringify(saveEnvelope(game, e.state)));
console.log('saved after', half.length, 'of', r.steps.length, 'steps in', e.state.room);
`,
);
run(`a save made by ${oldVersion}`, 'npx', ['tsx', '--tsconfig', 'tsconfig.json', 'make-save.ts'], game);

run(`the candidate over it (${version})`, 'npm', ['install', tgz['web-scumm']], game);
const dep = json(join(game, 'package.json')).dependencies?.['web-scumm'] ?? '';
if (!dep.includes(`web-scumm-${version}.tgz`)) fail(`the project depends on web-scumm through ${dep}, not the candidate's archive`);
run('migrate', 'npx', ['web-scumm', 'migrate'], game);
run('migrate --check', 'npx', ['web-scumm', 'migrate', '--check'], game);
run(`assets on ${version}`, 'npx', ['web-scumm', 'assets'], game);
run(`verify on ${version}`, 'npx', ['web-scumm', 'verify'], game);
run(`build on ${version}`, 'npx', ['web-scumm', 'build'], game);
if (!existsSync(join(game, 'dist', 'index.html'))) fail('the build has no index.html');
writeFileSync(
  join(game, 'play.ts'),
  `import { Engine, FakePresenter, MemoryStore, parseSave, solve } from 'web-scumm/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { game } from './game/game';
${LAYOUTS}
// The old save, loaded by this engine, still reaches the ending; and a new game is played to it, step by step.
const old = new Engine(game, layouts, new FakePresenter(), new MemoryStore());
await old.load(parseSave(game, JSON.parse(readFileSync('old-save.json', 'utf8'))));
const fromOld = await solve(game, layouts, { mode: 'witness', start: { state: old.state } });
if (fromOld.status !== 'solved') { console.error('the old save no longer reaches the ending:', fromOld.status); process.exit(1); }
const route = await solve(game, layouts, { mode: 'witness' });
if (route.status !== 'solved') { console.error('a new game has no way to the ending:', route.status); process.exit(1); }
const e = new Engine(game, layouts, new FakePresenter(), new MemoryStore());
await e.newGame();
for (const s of route.steps as { act?: { verb: string; a: string; b?: string } }[]) if (s.act) await e.act(s.act);
const end = await solve(game, layouts, { mode: 'witness', start: { state: e.state } });
if (end.status !== 'solved' || end.steps.length !== 0) { console.error('the route played did not end the game:', end.status, end.steps.length); process.exit(1); }
console.log('the old save reaches the ending in', fromOld.steps.length, 'steps; a new game played to its end in', route.steps.length);
`,
);
run(`the ${oldVersion} save and a new game, played to the end on ${version}`, 'npx', ['tsx', '--tsconfig', 'tsconfig.json', 'play.ts'], game);
for (const leak of leaksIn(game)) fail(leak);

// ---------------------------------------------------------------- create-web-scumm
const creator = join(base, 'creator');
mkdirSync(creator, { recursive: true });
writeFileSync(join(creator, 'package.json'), '{ "name": "creator", "private": true }\n');
run('create-web-scumm: install', 'npm', ['install', tgz['create-web-scumm'], tgz['web-scumm']], creator);
run('create-web-scumm: run', 'npx', ['create-web-scumm', 'beacon', 'The Beacon', `--engine=file:${tgz['web-scumm']}`], creator);
if (!existsSync(join(creator, 'beacon', 'game', 'game.ts'))) fail('create-web-scumm made no game');
for (const leak of leaksIn(join(creator, 'beacon'))) fail(leak);

// ---------------------------------------------------------------- the Bridge
const bridgeDir = unpack(tgz['web-scumm-bridge'], join(base, 'bridge'));
run('bridge: install', 'npm', ['install', '--omit=dev'], bridgeDir);
const BIN = join(bridgeDir, 'bin.mjs');
// The manifest of the game the Bridge serves: the keeper's, with a letter it may answer (an author's data, written here).
const manifest = {
  format: 'web-scumm-reality-manifest',
  schema: 1,
  gameId: 'keeper',
  signals: [
    { id: 'letter.door', source: 'email', availability: 'optional', replay: 'record', once: true },
    { id: 'letter.unclear', source: 'email', availability: 'optional', replay: 'record', once: false },
  ],
  connectors: { email: { answers: [{ words: ['open', 'door'], signal: 'letter.door' }], otherwise: 'letter.unclear' } },
};
const manifestFile = join(base, 'reality-manifest.json');
writeFileSync(manifestFile, JSON.stringify(manifest));
const data = join(base, 'bridge-data');
node('bridge: init', [BIN, 'init', `--dir=${data}`, `--manifest=${manifestFile}`, '--no-demo-webhooks'], bridgeDir);
node('bridge: doctor', [BIN, 'doctor', `--dir=${data}`], bridgeDir);
const PORT = 5280 + Math.floor(Math.random() * 400);
async function bridgeUp(store, extra) {
  const s = serve(process.execPath, [BIN, 'serve', `--dir=${data}`, `--port=${PORT}`, ...extra], bridgeDir);
  try {
    await waitFor(`http://127.0.0.1:${PORT}/v1/keys`, async (r) => r.ok && (await r.text()).includes('"keys"'));
    console.log(`✔  the Bridge serves its keys on ${store} from the installed package`);
  } catch (e) {
    s.stop();
    throw e;
  }
  return s;
}
if (process.env.CONSUMER_PG_URL) {
  run('bridge: the Postgres peer', 'npm', ['install', 'pg'], bridgeDir);
  const pg = await bridgeUp('Postgres', [`--store=${process.env.CONSUMER_PG_URL}`]);
  pg.stop();
  await new Promise((ok) => setTimeout(ok, 1500));
}
const sqlite = await bridgeUp('SQLite', [`--store=sqlite:${join(data, 'bridge.sqlite')}`]);

// ---------------------------------------------------------------- the connectors, and a recorded scenario
try {
  const operator = join(base, 'operator');
  mkdirSync(operator, { recursive: true });
  writeFileSync(join(operator, 'package.json'), '{ "name": "operator", "private": true }\n');
  run('connectors: install', 'npm', ['install', '--omit=optional', '--ignore-scripts', tgz['web-scumm-connectors']], operator);
  const help = run('web-scumm-connector --help', 'npx', ['web-scumm-connector', '--help'], operator, { capture: true });
  if (!help.includes('usage: web-scumm-connector')) fail('web-scumm-connector --help says no usage');
  for (const id of ['email', 'telnet', 'ssh', 'open-badge']) {
    const r = spawnSync(WIN ? 'npx.cmd' : 'npx', ['web-scumm-connector', id], { cwd: operator, env: ENV, shell: WIN, encoding: 'utf8' });
    if (r.status !== 2 || !`${r.stdout}${r.stderr}`.includes('--config')) fail(`web-scumm-connector ${id} without --config: exit ${r.status}`);
  }
  const token = node(
    'bridge: grant the email connector',
    [BIN, 'grant', `--dir=${data}`, '--connector=keeper-mail', '--source=email', '--signals=letter.door,letter.unclear', '--pair'],
    bridgeDir,
    { capture: true },
  ).trim();
  writeFileSync(join(operator, 'email.token'), token, { mode: 0o600 });
  const secret = randomBytes(24).toString('hex');
  writeFileSync(join(operator, 'webhook.secret'), secret, { mode: 0o600 });
  const HOOK = PORT + 1;
  writeFileSync(
    join(operator, 'email.json'),
    JSON.stringify({
      bridge: { url: `http://127.0.0.1:${PORT}/`, tokenFile: 'email.token' },
      gameId: 'keeper',
      manifestFile: manifestFile,
      email: { mode: 'webhook', webhook: { port: HOOK, secretFile: 'webhook.secret' } },
    }),
  );
  const connector = serve('npx', ['web-scumm-connector', 'email', '--config', 'email.json'], operator);
  try {
    // What a player does: the game asks the Bridge for a pairing code, the player mails it, then answers the letter.
    const pairing = await (
      await fetch(`http://127.0.0.1:${PORT}/v1/pairings`, { method: 'POST', body: JSON.stringify({ gameId: 'keeper' }) })
    ).json();
    const mail = (subject, text) =>
      Buffer.from(
        [
          'From: player@keeper.example',
          'To: gate@keeper.example',
          `Message-ID: <${randomBytes(8).toString('hex')}@keeper.example>`,
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          text,
          '',
        ].join('\r\n'),
      );
    const post = (eml, sig = true) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const mac = createHmac('sha256', sig ? secret : 'not-the-secret').update(`${ts}.`).update(eml).digest('hex');
      return fetch(`http://127.0.0.1:${HOOK}/v1/inbound`, {
        method: 'POST',
        headers: { 'x-web-scumm-timestamp': ts, 'x-web-scumm-signature': `sha256=${mac}` },
        body: eml,
      });
    };
    const said = async (r) => `${r.status} ${JSON.stringify(await r.json().catch(() => null))}`;
    await waitFor(`http://127.0.0.1:${HOOK}/v1/inbound`, (r) => r.status === 404 || r.status === 405 || r.status === 401);
    const letter = mail('the gate', 'Please open the door.');
    const steps = [
      ['the pairing code mailed', await said(await post(mail(pairing.code ?? 'none', 'my code'))), /^202 .*paired/],
      ['the letter answered', await said(await post(letter)), /^202 .*accepted/],
      ['the same letter again', await said(await post(letter)), /^200 .*duplicate/],
      ['a forged signature', await said(await post(letter, false)), /^401 /],
    ];
    for (const [what, got, want] of steps) if (!want.test(got)) fail(`${what}: ${got}`);
    if (steps.every(([, got, want]) => want.test(got)))
      console.log('✔  paired by a code from the Bridge, a letter accepted, the same one a duplicate, a forged one refused');
  } finally {
    connector.stop();
  }
} finally {
  sqlite.stop();
}

if (failed) {
  console.error(`\n✖  external consumer: ${failed} problem(s) (folder kept: ${base})`);
  process.exit(1);
}
if (!args.includes('--keep') && !flag('dir')) rmSync(base, { recursive: true, force: true });
console.log(
  `\n✔  external consumer (${process.platform}, Node ${process.versions.node}): the four ${version} archives installed outside the repository; a ${oldVersion} game moved to ${version}, its save and a new game played to the end; the Bridge and a connector scenario from their archives`,
);
