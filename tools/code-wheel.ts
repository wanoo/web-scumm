// npm run code-wheel -- --game <id> [--format svg|pdf] [--seed <code>|story] [--out <dir>]: the printable code wheel of
// a game (4.1.15, §11.13): the large disc, the small disc and a booklet, in colour and in an economy version, as SVG
// pages (always) and, with --format pdf, one PDF drawn by Pillow (tools/code-wheel-pdf.py; `npm run doctor` says
// whether Pillow is there; without it the SVG pages are still written and the command says so). Portraits come from
// the game's cut sprites (games/<id>/art/<sheet>/<cell>.png). The wheel is the one the seed makes in the game.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { flushExit } from './flush';
import { type CodeWheelParams, generateWheel } from '../src/engine/core/remix/code-wheel';
import { pageSvg, printLayout } from '../src/engine/tools/code-wheel-print';

const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  const eq = argv.find((a) => a.startsWith(`--${k}=`));
  return i >= 0 ? argv[i + 1] : eq?.slice(k.length + 3);
};
// --game is read before tools/game.ts, which settles the game when it is first imported: a game id, never a path.
const gameArg = opt('game');
if (gameArg !== undefined) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(gameArg)) {
    console.error(`✗  --game "${gameArg}" is not a game id (letters, digits, - and _)`);
    process.exit(2);
  }
  process.env.GAME = gameArg;
}
const { GAME, GAME_DIR, loadGameModule, ROOT } = await import('./game');
const { game } = await loadGameModule();
const format = opt('format') ?? 'svg';
const seed = opt('seed') ?? 'story';
const out = resolve(opt('out') ?? join(ROOT, '.cache', 'code-wheel', GAME));

const found: CodeWheelParams[] = [];
const walk = (x: unknown) => {
  if (Array.isArray(x)) x.forEach(walk);
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (o.minigame === 'code-wheel') found.push(o.params as CodeWheelParams);
    Object.values(o).forEach(walk);
  }
};
walk(game.rooms);
if (!found.length) {
  console.error(`✗  [${GAME}] has no code wheel ({ minigame: 'code-wheel' })`);
  await flushExit(1);
}
const image = (id: string) => {
  const f = join(GAME_DIR, 'art', `${id}.png`);
  return existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString('base64')}` : undefined;
};
mkdirSync(out, { recursive: true });
const written: string[] = [];
for (const [k, params] of found.entries()) {
  const w = generateWheel(params, typeof params.seed === 'string' ? params.seed : seed);
  for (const economy of [false, true]) {
    const layout = printLayout(w, params, { title: game.title, economy, image });
    const tag = `${k ? `wheel${k + 1}-` : ''}${economy ? 'economy' : 'colour'}`;
    for (const page of layout.pages) {
      const f = join(out, `${tag}-${page.name}.svg`);
      writeFileSync(f, pageSvg(page, economy));
      written.push(f);
    }
    if (format === 'pdf') {
      const json = join(out, `${tag}.layout.json`);
      writeFileSync(json, JSON.stringify(layout));
      const pdf = join(out, `${tag}.pdf`);
      const r = spawnSync('python3', [join(ROOT, 'tools', 'code-wheel-pdf.py'), json, pdf], { encoding: 'utf8' });
      if (r.status === 0) written.push(pdf);
      else
        console.warn(
          `⚠  no PDF (${(r.stderr || r.error?.message || '').trim().split('\n').pop()}): the SVG pages are written; npm run doctor checks Pillow`,
        );
    }
  }
  console.log(
    `[${GAME}] wheel ${k + 1}: seed ${w.seed}, ${w.n} actors; the question's answer is in the booklet, upside down`,
  );
}
for (const f of written) console.log(`  ${f}`);
await flushExit(0);
