// npm run runs:load [-- --store=sqlite|postgres://… --runs=100000 --players=5000 --reads=200 --max-p95-ms=<ms>
// --max-rss-mb=<MB> --out=<file>] (4.1.17, plan §6.3): the speedrun leaderboard at size. A store of the Bridge's
// schema is filled with `--runs` verified runs on one board (and as many on others, so the board's filter works),
// then the board is read `--reads` times: the latency (p50, p95, max), the process's memory before and after, and the
// SQL plan of the statement (EXPLAIN QUERY PLAN on SQLite, EXPLAIN on Postgres) are reported. A p95 or a resident
// memory past its bound fails the run; the report names the backend the store object is and the commit.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { type LeaderboardQuery, type RunRecord, SqlRunStore } from '../bridge/src/runs-store';
import { openStore } from '../bridge/src/cli-store';
import type { SqlRealityStore } from '../bridge/src/store-sql';
import { flushExit } from './flush';
import { loadSpec } from './load-report';
import { ROOT } from './game';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const RUNS = arg('runs', 100_000);
const PLAYERS = arg('players', 5000);
const READS = arg('reads', 200);
const MAX_P95 = arg('max-p95-ms', Number.POSITIVE_INFINITY);
const MAX_RSS = arg('max-rss-mb', Number.POSITIVE_INFINITY);
const out = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);

const spec = loadSpec(process.argv, process.env);
const dir = mkdtempSync(join(tmpdir(), 'runs-load-'));
const store = (await openStore(spec === 'sqlite' ? 'sqlite:runs-load.sqlite' : spec, dir, {
  journal: 'journal.jsonl',
})) as SqlRealityStore;
const runs = new SqlRunStore(store.db);
const tenantId = `load-${randomBytes(3).toString('hex')}`;
let code = 0;
try {
  const row = (i: number, key: string): RunRecord => ({
    id: `run_${i.toString(36).padStart(8, '0')}${key === 'any%' ? '' : 'x'}`,
    tenantId,
    gameId: 'reference',
    categoryId: 'any%',
    player: `p${(i * 7919) % PLAYERS}`,
    submittedAt: 1_700_000_000_000 + i,
    status: 'done',
    verdict: 'valid',
    trust: 'replay-valid',
    ranked: String(150_000_000 + ((i * 104_729) % 50_000_000)),
    leaderboardKey: key,
    runKey: `${key}-${i}`,
    deleteTokenHash: '0'.repeat(64),
    envelope: '',
  });
  const t0 = performance.now();
  // Filled in transactions of 2 000 rows (a commit per row would measure the disk, not the board).
  for (let from = 0; from < 2 * RUNS; from += 2000)
    await store.db.tx(undefined, async (tx) => {
      const inner = new SqlRunStore({
        dialect: store.db.dialect,
        run: (s: string, p?: unknown[]) => tx.run(s, p),
        all: (s: string, p?: unknown[]) => tx.all(s, p),
      } as never);
      for (let i = from; i < Math.min(from + 2000, 2 * RUNS); i++)
        await inner.create(row(i >> 1, i % 2 ? 'any%:WS-0000-0000' : 'any%'));
    });
  const fillSeconds = (performance.now() - t0) / 1000;
  if (store.db.dialect === 'postgres') await store.db.exec('ANALYZE runs');
  const q: LeaderboardQuery = { tenantId, gameId: 'reference', categoryId: 'any%', leaderboardKey: 'any%', limit: 100 };
  const { sql, params } = runs.boardSql(q);
  const explain = await store.db.all(
    `${store.db.dialect === 'sqlite' ? 'EXPLAIN QUERY PLAN' : 'EXPLAIN'} ${sql}`,
    params,
  );
  const rssBefore = process.memoryUsage().rss;
  const latencies: number[] = [];
  let first: Awaited<ReturnType<typeof runs.board>> = [];
  for (let k = 0; k < READS; k++) {
    const t = performance.now();
    const board = await runs.board(q);
    latencies.push(performance.now() - t);
    if (k === 0) first = board;
  }
  const rssAfter = process.memoryUsage().rss;
  latencies.sort((a, b) => a - b);
  const p = (x: number) =>
    Math.round((latencies[Math.min(latencies.length - 1, Math.floor(x * latencies.length))] ?? 0) * 10) / 10;
  const kind = store.kind;
  const report = {
    at: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    store: kind,
    runs: RUNS,
    rowsInTable: 2 * RUNS,
    players: PLAYERS,
    reads: READS,
    fillSeconds: Math.round(fillSeconds * 10) / 10,
    latencyMs: { p50: p(0.5), p95: p(0.95), max: p(1) },
    // The whole process's resident memory (the filled store's pages included), before and after the reads.
    rssMb: { before: Math.round(rssBefore / 2 ** 20), after: Math.round(rssAfter / 2 ** 20) },
    bounds: { p95Ms: MAX_P95, rssMb: MAX_RSS },
    board: {
      lines: first.length,
      firstRank: first[0]?.rank ?? null,
      players: new Set(first.map((r) => r.run.player)).size,
    },
    plan: explain.map((r) => String(r.detail ?? r['QUERY PLAN'] ?? JSON.stringify(r))),
    machine: {
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()} ${arch()}`,
      node: process.version,
    },
  };
  console.log(JSON.stringify(report));
  if (out) writeFileSync(resolve(out), `${JSON.stringify(report, null, 1)}\n`);
  const bad: string[] = [];
  if (first.length !== Math.min(100, PLAYERS))
    bad.push(`the board has ${first.length} lines, not ${Math.min(100, PLAYERS)}`);
  if (report.board.players !== first.length) bad.push('a pseudonym is on the board twice');
  if (report.latencyMs.p95 > MAX_P95) bad.push(`p95 ${report.latencyMs.p95} ms, above ${MAX_P95}`);
  if (report.rssMb.after > MAX_RSS) bad.push(`resident memory ${report.rssMb.after} MB, above ${MAX_RSS}`);
  for (const b of bad) console.error(`✖  ${b}`);
  if (bad.length) code = 1;
} finally {
  // A shared database keeps nothing of this measure (a CI service is thrown away anyway).
  if (store.db.dialect === 'postgres')
    await store.db.run('DELETE FROM runs WHERE tenant_id = $1', [tenantId]).catch(() => 0);
  await store.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
await flushExit(code);
