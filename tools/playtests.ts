// npm run playtests [-- --json] [--strict] [--require=N] [--require-completed=N] [--require-devices=N] [--dir=games/<id>/playtests] [--out=.cache/playtests]
// Replays every playtest of the current game (sessions shared from phones: ids and indices only) and sums them up:
// time per room, where players stall, hints shown, where they stopped, a heat map on the puzzle graph. A session the
// content has outgrown (the replay diverges) is reported, not an error: re-record or delete it. No file: exit 0.
// --strict (the release gate): a diverged session is an error (exit 1): re-record it or delete it. It asks for no
// number of sessions: zero sessions pass it, and it says so. The field quotas (3.7.1, `npm run verify:field`) do:
// --require=N sessions, --require-completed=N played to the end, --require-devices=N device families (iOS, Android,
// desktop, from the file); one missed is an error, with no session at all too.
// --out writes report.md, report.json and heat.svg. --json prints the report on stdout, nothing else.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { analyzePlaytests, playtestsMarkdown, quotaShortfalls, type PlaytestFile, type PlaytestQuotas } from '../src/engine/tools/playtests';
import { parseSessionFile } from '../src/engine/tools/replay';
import { puzzleGraph, toPuzzleSvg } from '../src/engine/tools/puzzle';
import { loadLayouts } from '../src/engine/tools/load';
import { GAME, GAME_DIR, WORK, loadGameModule } from './game';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const asJson = args.includes('--json');
const strict = args.includes('--strict');
const dir = resolve(arg('dir') ?? join(GAME_DIR, 'playtests'));
const { game, commands } = await loadGameModule();
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));

const num = (k: string) => { const v = arg(k); return v === undefined ? undefined : Number(v); };
const quotas: PlaytestQuotas = { sessions: num('require'), completed: num('require-completed'), devices: num('require-devices') };
const asked = Object.values(quotas).some((v) => v !== undefined);
const shortfall = (files: Parameters<typeof quotaShortfalls>[0]) => {
  const miss = asked ? quotaShortfalls(files, quotas) : [];
  if (miss.length) { console.error(`✖ [${GAME}] field quotas missed: ${miss.join('; ')}`); process.exitCode = 1; }
};

const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.session.json')).sort() : [];
if (!names.length) {
  if (asJson) console.log(JSON.stringify({ files: [], total: { files: 0, entries: 0, ms: 0 } }));
  else console.log(`[${GAME}] no playtests in ${relative(WORK, dir)} (play on a phone, "Share session" in the pause menu, drop the file there)${strict && !asked ? ': --strict asks for none, 0 sessions checked' : ''}`);
  shortfall([]);
  process.exit(process.exitCode ?? 0);
}
const files: PlaytestFile[] = [];
let bad = 0;
for (const name of names) {
  try {
    const file = parseSessionFile(readFileSync(join(dir, name), 'utf8'));
    if (file.game && file.game !== game.id) { console.error(`  ✖ ${name}: recorded on game "${file.game}", not "${game.id}"`); bad++; continue; }
    if (file.v !== game.saveVersion) console.error(`  ⚠ ${name}: recorded with save version ${file.v}, the game is at ${game.saveVersion}: the replay may diverge`);
    files.push({ name, file });
  } catch (e) { console.error(`  ✖ ${name}: ${(e as Error).message}`); bad++; }
}
if (bad) process.exit(1);

const t0 = Date.now();
const report = await analyzePlaytests(game, layouts, files, { commands });
const markdown = playtestsMarkdown(report, game);
if (asJson) console.log(JSON.stringify(report));
else {
  console.log(markdown);
  console.log(`${files.length} session(s) replayed in ${((Date.now() - t0) / 1000).toFixed(1)} s${report.divergences ? ` · ${report.divergences} diverged (content changed since: re-record or delete)` : ''}`);
}
if (strict && report.divergences) {
  console.error(`✖ --strict: ${report.divergences} session(s) no longer replay on this content: ${report.files.filter((f) => f.divergedAt !== undefined).map((f) => `${f.name} (#${f.divergedAt! + 1}: ${f.divergence})`).join(', ')}`);
  process.exitCode = 1;
}
shortfall(report.files);
const out = arg('out');
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.md'), markdown);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(out, 'heat.svg'), toPuzzleSvg(puzzleGraph(game, { commands }), { heat: report.heat }));
  if (!asJson) console.log(`written: ${relative(WORK, out)}/report.md, report.json, heat.svg`);
}
