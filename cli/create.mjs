#!/usr/bin/env node
// web-scumm create <folder> ["Title"] [--engine=<npm spec>] (3.9), also `npx create-web-scumm <folder>`: a game
// project from the engine's template. The folder gets game/ (the template: one room, a hero, placeholder art drawn
// from shapes), a package.json whose scripts call `web-scumm`, a tsconfig.json whose `@engine` points into the
// installed package, and a .gitignore. Then: cd <folder> && npm install && npm run dev.
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [folder, ...words] = args.filter((a) => !a.startsWith('--'));
if (!folder) { console.error('usage: web-scumm create <folder> ["Title"] [--engine=<npm spec>]'); process.exit(2); }
const dir = resolve(folder);
const id = basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '') || 'game';
const title = words.join(' ') || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
if (existsSync(dir) && readdirSync(dir).length) { console.error(`${folder} exists and is not empty`); process.exit(1); }

cpSync(join(PKG, 'games', '_template'), join(dir, 'game'), { recursive: true });
const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|json|md)$/.test(e)) writeFileSync(p, readFileSync(p, 'utf8').replace(/__ID__/g, id).replace(/__TITLE__/g, title)); } };
walk(join(dir, 'game'));
// The template's art is a placeholder drawn from shapes (tools/placeholder-art.py): provenance says so, and a release
// refuses it until each file is replaced and reviewed (web-scumm provenance --lock).
writeFileSync(join(dir, 'game', 'provenance.json'), JSON.stringify({ licences: { allow: ['CC BY 4.0', 'CC0 1.0'] }, assets: [
  { match: 'img:*', source: 'Placeholder drawn from shapes by tools/placeholder-art.py (web-scumm template): replace before a release', author: 'web-scumm', licence: 'CC0 1.0', status: 'placeholder' },
] }, null, 2) + '\n');

// The page's icons, its preview image and the full font the engine falls back to: the project's public/ (Vite serves it).
for (const f of ['icons', 'og.png', 'fonts']) if (existsSync(join(PKG, 'public', f))) cpSync(join(PKG, 'public', f), join(dir, 'public', f), { recursive: true });

const engine = opt('engine') ?? `^${version}`;
writeFileSync(join(dir, 'package.json'), JSON.stringify({
  name: id, private: true, version: '0.1.0', type: 'module',
  config: { game: id },
  scripts: { dev: 'web-scumm dev', studio: 'web-scumm studio', assets: 'web-scumm assets', verify: 'web-scumm verify', build: 'web-scumm build', release: 'web-scumm release', preview: 'web-scumm preview', 'web-scumm': 'web-scumm' },
  dependencies: { 'web-scumm': engine },
}, null, 2) + '\n');
writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022', 'DOM', 'DOM.Iterable'], strict: true, skipLibCheck: true,
    isolatedModules: true, noEmit: true, resolveJsonModule: true, baseUrl: '.',
    paths: { '@engine/*': ['node_modules/web-scumm/src/engine/*'], '@game': ['game/index.ts'], '@game/*': ['game/*'] },
    types: ['vite/client', 'node'],
  },
  include: ['game', 'node_modules/web-scumm/src/env.d.ts'],
}, null, 2) + '\n');
writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\n.cache\npublic/assets\n');
writeFileSync(join(dir, 'README.md'), `# ${title}\n\nA point-and-click game made with [web-scumm](https://github.com/wanoo/web-scumm).\n\n\`\`\`bash\nnpm install\nnpm run assets   # art and audio into public/assets (Python 3 with Pillow)\nnpm run dev      # open the URL, landscape; ?edit=start places things\nnpm run verify   # the content checked, the solver finds the end\nnpm run build    # dist/, every file accounted for, licences inside\n\`\`\`\n\nThe game is in \`game/\`: rooms, characters, items, rules. The art in \`game/art\` is a placeholder; a release refuses it\nuntil it is replaced and reviewed (\`npx web-scumm provenance --lock\`).\n`);
console.log(`${folder}: "${title}" created (web-scumm ${engine}).\nNext:\n  cd ${folder}\n  npm install\n  npm run assets && npm run dev`);
