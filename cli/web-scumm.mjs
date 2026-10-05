#!/usr/bin/env node
// web-scumm <command> (3.9): the engine's tools for a game project that installed the package. The project's folder
// (where this runs) holds game/ (the game's sources), public/ (the built assets), dist/ (the build) and .cache/; the
// engine, its pages and its tools stay in the package, never written. `web-scumm help` lists the commands.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.cwd();
const [cmd = 'help', ...rest] = process.argv.slice(2);

const env = { ...process.env, WEB_SCUMM_PROJECT: project };
const tsconfig = existsSync(resolve(project, 'tsconfig.json')) ? resolve(project, 'tsconfig.json') : resolve(PKG, 'tsconfig.json');
/** A dependency's file: the project's node_modules, the package's own, or any folder above (npm hoists them). */
function bin(mod, file) {
  for (let d = PKG; ; d = dirname(d)) {
    const p = resolve(d, 'node_modules', mod, file);
    if (existsSync(p)) return p;
    if (dirname(d) === d) break;
  }
  return resolve(project, 'node_modules', mod, file);
}

function run(file, args = [], o = {}) {
  const r = spawnSync(file, args, { stdio: o.stdout ? ['inherit', o.stdout, 'inherit'] : 'inherit', env: { ...env, ...(o.env ?? {}) }, cwd: project });
  if (r.error) { console.error(`web-scumm: ${r.error.message}`); return 1; }
  return r.status ?? 1;
}
const tool = (name, args = [], o) => run(process.execPath, [bin('tsx', 'dist/cli.mjs'), '--tsconfig', tsconfig, resolve(PKG, 'tools', `${name}.ts`), ...args], o);
const vite = (args, o) => run(process.execPath, [bin('vite', 'bin/vite.js'), ...args, '--config', resolve(PKG, 'vite.config.ts')], o);
const all = (...steps) => { for (const s of steps) { const c = s(); if (c) return c; } return 0; };

function assets() {
  mkdirSync(resolve(project, '.cache'), { recursive: true });
  const out = openSync(resolve(project, '.cache', 'refs.json'), 'w');
  const c = tool('refs', [], { stdout: out });
  closeSync(out);
  return c || run(process.env.PYTHON ?? 'python3', [resolve(PKG, 'tools', 'assets.py')]);
}
const verifyGame = () => all(() => tool('validate'), () => tool('solve'), () => tool('i18n', ['status']), () => tool('lint'), () => tool('playtests'));
const verifyRelease = () => all(() => tool('validate', ['--release']), () => tool('weight', ['--release']), () => tool('i18n', ['status']), () => tool('voices', ['check', '--release']), () => tool('playtests', ['--strict']));

const COMMANDS = {
  create: ['create <folder> ["Title"] [--engine=<npm spec>]: a new game project from the template', () => run(process.execPath, [resolve(PKG, 'cli', 'create.mjs'), ...rest])],
  dev: ['the game in the browser, reloading as you edit (?edit=<room>: the placement editor)', () => vite(rest)],
  studio: ['the Studio: rooms, dialogues, the puzzle graph, the mixer', () => vite(['--open', '/__studio/', ...rest], { env: { STUDIO: '1' } })],
  assets: ['art/ and audio/ into public/assets (Python 3, Pillow)', assets],
  validate: ['the content checked: references, rules, dialogues, budgets', () => tool('validate', rest)],
  solve: ['the solver: a way to the end, softlocks (--prove), chapters', () => tool('solve', rest)],
  lint: ['what a player would trip on', () => tool('lint', rest)],
  i18n: ['translations: extract, status', () => tool('i18n', rest)],
  weight: ['what a phone downloads and decodes, against assetBudgets', () => tool('weight', rest)],
  provenance: ['where every asset comes from (--lock after a review)', () => tool('provenance', rest)],
  playtests: ['the sessions players shared, replayed and summed up', () => tool('playtests', rest)],
  voices: ['recorded lines: check, apply', () => tool('voices', rest)],
  prompts: ['image prompts for the sheets the game names', () => tool('prompts', rest)],
  verify: ['validate, solve, i18n status, lint, playtests', verifyGame],
  build: ['assets, verify, the production build in dist/, every file of it accounted for', () => all(assets, verifyGame, () => vite(['build', ...rest]), () => tool('dist'))],
  release: ['build, then the release gates (provenance lock, budgets, translations, voices, strict playtests); --commercial: no exception, no placeholder', () => all(assets, verifyGame, () => vite(['build']), verifyRelease, () => tool('solve', ['--prove']), () => (rest.includes('--commercial') ? tool('validate', ['--commercial', '--errors']) : 0), () => tool('dist'))],
  preview: ['serve dist/ locally', () => vite(['preview', '--host', '127.0.0.1', ...rest])],
  migrate: ['bring the game\'s sources to this engine version (ids, content format)', () => tool('migrate', rest)],
};

if (cmd === 'help' || cmd === '--help' || !COMMANDS[cmd]) {
  if (cmd !== 'help' && cmd !== '--help') console.error(`web-scumm: no command "${cmd}"\n`);
  console.log(`web-scumm ${JSON.parse(readFileSync(resolve(PKG, 'package.json'), 'utf8')).version}: an engine for point-and-click games in the browser\n\nUsage: web-scumm <command> [options]\n`);
  for (const [k, [d]] of Object.entries(COMMANDS)) console.log(`  ${k.padEnd(11)} ${d}`);
  process.exit(cmd === 'help' || cmd === '--help' ? 0 : 1);
}
process.exit(COMMANDS[cmd][1]());
