// Scaffolds games/<id> from games/_template and makes it the current game.
// Usage: npm run new-game <id> ["Working title"]
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [id, ...rest] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) { console.error('usage: npm run new-game <id> ["Title"]   (id: lowercase letters, digits, dashes)'); process.exit(1); }
const title = rest.join(' ') || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const dir = join('games', id);
if (existsSync(dir)) { console.error(`${dir} already exists`); process.exit(1); }

cpSync('games/_template', dir, { recursive: true });
// Placeholder art so the game runs right away: the sample cat as hero, the interface icons, one background, a few items.
for (const [from, to] of [['games/demo/art/hero', 'art/hero'], ['games/demo/art/ui', 'art/ui'], ['games/demo/art/items', 'art/items'], ['games/demo/art/home2', 'art/home2']]) {
  if (existsSync(from)) cpSync(from, join(dir, to), { recursive: true });
}
mkdirSync(join(dir, 'art/decor'), { recursive: true });
if (existsSync('games/demo/art/decor/backyard.jpg')) cpSync('games/demo/art/decor/backyard.jpg', join(dir, 'art/decor/backyard.jpg'));

// The placeholder art comes from the sample game: say so, with its licence, so it is never shipped by mistake
// (npm run validate -- --release warns about every placeholder, and fails on an asset no entry covers).
const borrowed = { source: 'Placeholder from the web-scumm sample game (games/demo/art), replace before a release', author: 'Wano', licence: 'CC BY 4.0', status: 'placeholder', note: 'Attribution if kept: "Artwork by Wano, from the web-scumm project (https://github.com/wanoo/web-scumm)"' };
writeFileSync(join(dir, 'provenance.json'), JSON.stringify({ assets: [
  ...['img:hero/*', 'img:ui/*', 'img:items/*', 'img:home2/*', 'img:decor/backyard'].map((match) => ({ match, ...borrowed })),
] }, null, 2) + '\n');

const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|json|md)$/.test(e)) writeFileSync(p, readFileSync(p, 'utf8').replace(/__ID__/g, id).replace(/__TITLE__/g, title)); } };
walk(dir);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.config = { ...(pkg.config ?? {}), game: id };
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log(`games/${id} created ("${title}") and set as the current game.
Next:
  npm run assets      # prepare the placeholder art
  npm run validate && npm run solve
  (provenance.json lists the borrowed placeholder art: add an entry for each asset you make)
  npm run dev         # then open the URL on your phone, landscape; ?edit=start to place things
Write the story in games/${id}/storyboard.json, rooms in games/${id}/rooms/, characters in cast.ts. See docs/en/CONTENT_GUIDE.md.`);
