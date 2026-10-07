// npm run prove:matrix [-- --only=c11,o21 --time=600 --max=10000000 --mem=4096 --json=matrix.json] (4.1.13): the
// reference matrix of docs/dev/PROOF-MATRIX.md, the twelve instances of `matrixGame` (tests/gen/random-game.ts),
// each proved in its own process under the published budgets: 10 000 000 states, --time seconds (600 on the
// maintainer's Mac, 1 200 on the runner), --mem MB of heap (4 096). Prints one row per instance (verdict, the
// verdict the matrix expects, states, time, states per second, peak memory, what stopped it) and the threshold
// line. Exit 1 on a false verdict: `proved` where the matrix expects a softlock, a softlock where it expects a proof,
// or a search error. An instance that runs out of budget is `unknown` (truncated), never `proved`; it is the gap
// report, not a failure. Nightly only (.github/workflows/nightly.yml), never on a pull request.
// --representation=objects|compact, --checkpoint-dir=<dir> (resume each instance from there), --workers=N: passed on.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../src/engine/tools/solve-pool';
import { proofProfileLines, solve, type SolveOptions } from '../src/engine/tools/solve';
import { MATRIX, matrixGame } from '../tests/gen/random-game';
import { fileCheckpoint } from './checkpoint';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const num = (k: string, d: number) => (arg(k) === undefined ? d : Number(arg(k)));

/** One instance's measures (the child's last line on stdout). */
export interface MatrixRow {
  id: string;
  rooms: number;
  open: boolean;
  status: string;
  verdict: 'proved' | 'softlock' | 'unsolvable' | 'unknown' | 'error';
  states: number;
  seconds: number;
  statesPerSecond: number;
  peakRssMb: number;
  peakHeapMb: number;
  stoppedBy?: string;
  softlockCount: number;
  softlockSample?: string[];
  pathLength: number;
  crashed?: string;
  /** With --profile: what each abstraction did and the explosion profile. */
  profile?: string[];
}

const verdictOf = (status: string): MatrixRow['verdict'] =>
  status === 'solved'
    ? 'proved'
    : status === 'softlocks'
      ? 'softlock'
      : status === 'unsolved'
        ? 'unsolvable'
        : status === 'truncated'
          ? 'unknown'
          : 'error';

const child = arg('child');
if (child) {
  const m = MATRIX.find((x) => x.id === child);
  if (!m) throw new Error(`no instance ${child}`);
  const { game, layouts, rooms } = matrixGame(m.seed, { characters: 3, rooms: [20, 40], open: m.open });
  let peakRss = 0,
    peakHeap = 0,
    lastLog = Date.now();
  const sample = () => {
    const u = process.memoryUsage();
    peakRss = Math.max(peakRss, u.rss);
    peakHeap = Math.max(peakHeap, u.heapUsed);
  };
  const t0 = Date.now();
  const rep = arg('representation');
  const opts: SolveOptions = {
    mode: 'prove',
    maxStates: num('max', 10_000_000),
    timeLimitMs: num('time', 600) * 1000,
    onProgress: (p) => {
      sample();
      if (Date.now() - lastLog > 15000) {
        lastLog = Date.now();
        process.stderr.write(
          `  … ${child}: ${p.states} states, ${p.queue} queued, ${Math.round(p.ms / 1000)} s, ${Math.round(peakRss / 1e6)} MB\n`,
        );
      }
    },
    ...(rep === 'objects' ? { representation: 'objects' as const } : {}),
    ...(arg('workers') ? { workers: Number(arg('workers')) } : {}),
    ...(arg('checkpoint-dir')
      ? { checkpoint: fileCheckpoint(resolve(arg('checkpoint-dir')!, `${child}.ckpt`), { resume: true }) }
      : {}),
    // The heap budget: stop as `truncated` a little before Node would die of it.
    maxMemoryMb: Math.floor(num('mem', 4096) * 0.9),
    ...(process.argv.includes('--symmetry') ? { symmetry: true } : {}),
    ...(arg('profile') ? { explosion: true } : {}),
  };
  const r = await solve(game, layouts, opts);
  sample();
  const seconds = (Date.now() - t0) / 1000;
  const row: MatrixRow = {
    id: child,
    rooms,
    open: m.open,
    status: r.status,
    verdict: verdictOf(r.status),
    states: r.states,
    seconds: Math.round(seconds * 10) / 10,
    statesPerSecond: Math.round(r.states / Math.max(0.001, seconds)),
    peakRssMb: Math.round(Math.max(peakRss, process.resourceUsage().maxRSS * 1024) / 1e6),
    peakHeapMb: Math.round(peakHeap / 1e6),
    ...(r.profile.stoppedBy ? { stoppedBy: r.profile.stoppedBy } : {}),
    softlockCount: r.softlockCount,
    ...(r.softlockCauses[0] ? { softlockSample: r.softlockCauses[0].sample } : {}),
    pathLength: r.path.length,
    ...(arg('profile') ? { profile: proofProfileLines(r.profile) } : {}),
  };
  process.stdout.write(`${JSON.stringify(row)}\n`, () => process.exit(0));
} else {
  const only = arg('only')?.split(',');
  const mem = num('mem', 4096);
  const rows: MatrixRow[] = [];
  const pass = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('--only=') && !a.startsWith('--json='))
    .map((a) => (a.startsWith('--profile=') ? '--profile=1' : a));
  for (const m of MATRIX) {
    if (only && !only.includes(m.id)) continue;
    const out = await new Promise<{ code: number | null; text: string }>((done) => {
      const p = spawn(
        process.execPath,
        [`--max-old-space-size=${mem}`, '--import', 'tsx', 'tools/prove-matrix.ts', `--child=${m.id}`, ...pass],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let text = '';
      p.stdout.on('data', (d) => (text += d));
      p.on('close', (code) => done({ code, text }));
    });
    const last = out.text.trim().split('\n').pop() ?? '';
    let row: MatrixRow;
    try {
      row = JSON.parse(last) as MatrixRow;
    } catch {
      const { rooms } = matrixGame(m.seed, { open: m.open });
      row = {
        id: m.id,
        rooms,
        open: m.open,
        status: 'truncated',
        verdict: 'unknown',
        states: 0,
        seconds: 0,
        statesPerSecond: 0,
        peakRssMb: 0,
        peakHeapMb: 0,
        softlockCount: 0,
        pathLength: 0,
        crashed: `the process stopped (exit ${out.code}): out of memory (${mem} MB) or killed`,
      };
    }
    rows.push(row);
    console.log(
      `${row.id.padEnd(4)} ${String(row.rooms).padStart(2)} rooms ${row.open ? 'open       ' : 'constrained'}  ${row.verdict.padEnd(9)} (expected ${m.expected.padEnd(8)}) ${String(row.states).padStart(8)} states ${String(row.seconds).padStart(6)} s ${String(row.statesPerSecond).padStart(5)} st/s ${String(row.peakRssMb).padStart(5)} MB${row.stoppedBy ? `  stopped by ${row.stoppedBy}` : ''}${row.crashed ? `  ${row.crashed}` : ''}`,
    );
  }
  // A false verdict: a proof where the matrix knows a softlock, or the reverse. `unknown` on either side is no claim.
  const wrong = rows.filter((r) => {
    const e = MATRIX.find((m) => m.id === r.id)!.expected;
    return r.verdict === 'error' || (e !== 'unknown' && r.verdict !== 'unknown' && r.verdict !== e);
  });
  const within = rows.filter((r) => r.verdict !== 'unknown' && r.verdict !== 'error').length;
  console.log(
    `${wrong.length ? '✖' : '✔'}  ${within}/${rows.length} instance(s) with a verdict within the budget${wrong.length ? `, ${wrong.length} false or failed: ${wrong.map((r) => r.id).join(', ')}` : ', no false verdict'}`,
  );
  // --profile=<file>: the explosion profile of each instance, in Markdown (docs/dev/PROOF-PROFILE.md).
  const prof = arg('profile');
  if (prof)
    writeFileSync(
      prof,
      [
        '# The explosion profile of the proof matrix',
        '',
        `*Written by \`npm run prove:matrix -- ${process.argv
          .slice(2)
          .filter((a) => !a.startsWith('--json='))
          .join(' ')}\` on ${new Date().toISOString().slice(0, 10)}. One section per instance of*`,
        '*[PROOF-MATRIX.md](PROOF-MATRIX.md): the abstractions (what each did, or why it is off) and what multiplies the*',
        '*states (`src/engine/tools/solve/explosion.ts`). Measured on the states the search stored within the budget.*',
        '',
        ...rows.flatMap((r) => [
          `## ${r.id} (${r.rooms} rooms, ${r.open ? 'open' : 'constrained'}): ${r.verdict}, ${r.states} states, ${r.seconds} s`,
          '',
          '```',
          ...(r.profile ?? [r.crashed ?? 'no profile']),
          '```',
          '',
        ]),
      ].join('\n'),
    );
  const json = arg('json');
  if (json) writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1) + '\n');
  process.exit(wrong.length ? 1 : 0);
}
