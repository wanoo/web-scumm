// npm run replay -- <session.json> [--upTo=N] [--json]: plays a session exported from the game (settings › save ›
// "Export session", the Studio's Play tab, or the dev panel) on the real engine without a display, prints the journal
// and the final state, and exits 1 where the replay stops matching the recording. A tester's bug report is a session
// file and a screenshot; this is how to reproduce it. The game: GAME, otherwise package.json → config.game.
import { flushExit } from './flush';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { labelOf, parseSessionFile, replay } from '../src/engine/tools/replay';
import { flatState } from '../src/engine/core/diff';
import { describeEvent, journalDiff } from '../src/engine/core/journal';
import { loadLayouts } from '../src/engine/tools/load';
import { GAME_DIR, loadGameModule } from './game';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.log('usage: npm run replay -- <session.json> [--upTo=N] [--json]');
  process.exit(2);
}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const upTo = arg('upTo') ? Number(arg('upTo')) : undefined;
const { game, commands } = await loadGameModule();
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const f = parseSessionFile(readFileSync(file, 'utf8'));
if (f.game && f.game !== game.id) console.log(`⚠  the session was recorded on "${f.game}", this is "${game.id}"`);
if (f.v !== game.saveVersion)
  console.log(`⚠  the session was recorded with save version ${f.v}, the game is at ${game.saveVersion}`);
const t0 = Date.now();
const r = await replay(game, layouts, f.session, { commands, upTo });
// The semantic journal (4.1.11): a file that carries the recording's is compared with the replay's, sequence aside.
// Only a full replay can match it (`--upTo` stops early on purpose).
const jd = f.journal && upTo === undefined ? journalDiff(f.journal, r.journal) : -1;

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify({
      played: r.played,
      ended: r.ended,
      divergedAt: r.divergedAt ?? null,
      divergence: r.divergence ?? null,
      state: r.state,
      trace: r.trace,
      journal: r.journal,
      journalDivergedAt: jd < 0 ? null : jd,
      journalCompared: !!f.journal && upTo === undefined,
    }),
  );
  await flushExit(r.divergedAt === undefined && jd < 0 ? 0 : 1);
}
const start = f.session.start;
console.log(
  `\nSession: ${start.kind === 'checkpoint' ? `from checkpoint ${start.id}` : start.kind === 'load' ? `from a save (${f.session.base.room})` : 'a new game'}, ${f.session.log.length} entries${f.at ? `, recorded ${new Date(f.at).toLocaleString()}` : ''}`,
);
f.session.log.forEach((en, i) =>
  console.log(
    `  ${String(i + 1).padStart(3)}. ${labelOf(game, en)}${en.ran?.length ? `  ← ${en.ran.join(', ')}` : ''}${r.divergedAt === i ? '   ✖ diverges here' : ''}`,
  ),
);
console.log(`\nJournal (${r.trace.length} lines):`);
for (const t of r.trace) console.log(`  ${t.kind.padEnd(6)} ${t.room.padEnd(10)} ${t.text}`);
console.log(`\nSemantic journal (${r.journal.length} events${f.journal ? `, ${f.journal.length} recorded` : ''}):`);
for (const [i, e] of r.journal.entries())
  console.log(
    `  ${String(e.seq).padStart(4)} ${e.kind.padEnd(14)} ${describeEvent(e)}${i === jd ? '   ✖ differs from the recording' : ''}`,
  );
console.log(
  `\nState after ${r.played} entr${r.played === 1 ? 'y' : 'ies'} (${((Date.now() - t0) / 1000).toFixed(1)} s)${r.ended ? ', the ending reached' : ''}:`,
);
for (const [k, v] of Object.entries(flatState(r.state))) if (v !== '' && v !== 'false') console.log(`  ${k} = ${v}`);
if (r.divergedAt !== undefined) {
  console.log(`\n✖  Diverges at entry ${r.divergedAt + 1}: ${r.divergence}`);
  process.exit(1);
}
if (jd >= 0) {
  console.log(`\n✖  The semantic journal differs from the recording at event ${jd + 1}`);
  process.exit(1);
}
// A session longer than the journal's window was exported without its journal: the inputs matched, the journal
// could not be compared, and saying "matches" would claim more than was checked.
if (f.journalTruncated)
  console.log(`\n•  The inputs replay as recorded; no journal comparison: the window was exceeded`);
else console.log(`\n✔  The replay matches the recording`);
