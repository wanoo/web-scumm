// Checks that no sealed-ending text (from ANY outcome) appears in clear text in dist/.
import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_DIR } from '../tools/game';
import { isPrivateDistFile } from './spoiler-path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function main() {
  // A game without a sealed ending has no text to hide: only the private-file check below applies.
  const exists = (p: string) => access(p).then(() => true, () => false);
  const cfgPath = (await exists(resolve(GAME_DIR, 'private/ending.config.ts'))) ? resolve(GAME_DIR, 'private/ending.config.ts')
    : (await exists(resolve(GAME_DIR, 'ending.config.example.ts'))) ? resolve(GAME_DIR, 'ending.config.example.ts') : null;
  const needles: string[] = [];
  if (cfgPath) {
    const { config } = await import(cfgPath);
    const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    for (const o of Object.values(config.outcomes) as { ticket: string; headline: string; lines?: string[] }[]) {
      needles.push(o.headline, ...strip(o.ticket).split(' ').length > 2 ? [strip(o.ticket)] : [], ...(o.lines ?? []));
    }
    needles.push(config.message.split('\n')[0]);
  }
  const dist = resolve(root, 'dist');
  try { await access(dist); } catch { console.error('dist/ not found: run npm run build first.'); process.exit(1); }
  let bad = 0;
  for await (const f of walk(dist)) {
    if (!/\.(js|html|css|json|txt)$/.test(f)) continue;
    const txt = await readFile(f, 'utf8');
    for (const n of needles) {
      if (n && txt.includes(n)) { console.error(`✘ ${f} contains in clear text: "${n.slice(0, 40)}…"`); bad++; }
    }
  }
  for await (const f of walk(dist)) {
    if (isPrivateDistFile(dist, f)) { console.error(`✘ private file in dist: ${f}`); bad++; }
  }
  const bin = await readFile(resolve(dist, 'data/dossier.bin')).catch(() => null);
  if (bin) {
    const s = bin.toString('latin1');
    if (s.includes('ticket') || s.includes('headline')) { console.error('✘ dossier.bin contains clear-text JSON.'); bad++; }
  } else if (cfgPath) console.warn('⚠ dist/data/dossier.bin missing (npm run seal not run?)');
  if (bad) { console.error(`${bad} leak(s) found.`); process.exit(1); }
  console.log(cfgPath ? '✔ No sealed-ending text in clear text in dist/.' : '✔ No sealed ending in this game; no private file in dist/.');
}
main();
