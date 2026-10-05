// npm run lint [-- --json] [--prove] [--static] [--max=20000]
// Content lint: conditions nothing can satisfy, rules another rule hides, items nothing needs, hints that cannot
// fire, and, from a solver run, live actions never run and rooms never reached. Exit 1 only on an error that is not
// ignored (`GameDef.lint.ignore`). --prove runs the exhaustive search first (slow on a big game); --static runs no
// solver at all. --json: { mode, status, truncated, findings, counts, ignored } on stdout, nothing else.
// Exit codes: 0 clean, 1 an error that is not ignored, 2 the solver's search was truncated (its reachability findings
// are then information, never verdicts).
import { flushExit } from './flush';
import { cachedSolve } from './proof-cache';
import { resolve } from 'node:path';
import { lintContent, lintMarkdown, whereText } from '../src/engine/tools/lint';
import { loadLayouts } from '../src/engine/tools/load';
import { GAME, GAME_DIR, loadGameModule } from './game';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const asJson = args.includes('--json');
const mode = args.includes('--static') ? 'static' : args.includes('--prove') ? 'prove' : 'witness';
const { game, commands } = await loadGameModule();
const layouts = loadLayouts(resolve(GAME_DIR, 'layout'));
const t0 = Date.now();
const s =
  mode === 'static'
    ? undefined
    : await cachedSolve(game, layouts, { commands, mode, maxStates: Number(arg('max') ?? 20000) });
const r = lintContent(game, layouts, { solve: s, commands });

if (asJson) {
  console.log(
    JSON.stringify({
      mode,
      status: s?.status ?? null,
      truncated: !!s?.truncated,
      findings: r.findings,
      counts: r.counts,
      ignored: r.ignored,
      ms: Date.now() - t0,
    }),
  );
} else {
  console.log(
    `\n[${GAME}] content lint (${mode}${s?.truncated ? ', search truncated' : ''}): ${r.counts.error} error(s), ${r.counts.warning} warning(s), ${r.counts.info} info, ${r.ignored} ignored — ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  for (const f of r.findings)
    console.log(
      `  ${f.severity === 'error' ? '✖' : f.severity === 'warning' ? '⚠' : 'ℹ'} ${f.code.padEnd(20)} ${whereText(f)}\n      ${f.message}\n      → ${f.fix}`,
    );
  if (!r.findings.length) console.log('  nothing to report');
}
if (!asJson && s?.truncated)
  console.log(
    `  ⚠ the search was truncated (${s.states} states): "never run" and "never reached" are information, not verdicts — raise --max or prove by chapters`,
  );
await flushExit(r.counts.error ? 1 : s?.truncated ? 2 : 0);
