// npm run bridge:load [-- --instances=3 --players=1000 --proposals=50000 --concurrency=64 --streams=50 --out=<file>]
// (4.1.10, docs/dev/BENCH-BRIDGE.md): the Bridge under load, as deployed. Three `serve` processes on one store (a
// SQLite file; Postgres when BRIDGE_STORE names one), players seeded in the store with known capabilities (pairing
// is not what is measured, and its anonymous route is rate-limited by design), connector proposals sent over HTTP to
// the instances in turn, a share of the players followed by event streams on the last instance. Measured: the
// throughput, the latency of an accepted proposal (p50, p95, p99), the refusals and errors (the limits reached), the
// journal checked afterwards (one row per proposal, every sequence contiguous) and every stream complete. Prints one
// JSON line and writes it to --out; the machine is named in it. Nothing is published that this did not measure.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { realityManifest } from '../src/engine/reality/manifest';
import { openStore } from '../bridge/src/cli-store';
import { initCluster, type Instance, proposeOver, startInstance, streamOver } from './bridge-cluster';
import { pathToFileURL } from 'node:url';
import type { GameDef } from '../src/engine/core/types';
import { flushExit } from './flush';
import { ROOT } from './game';

const arg = (k: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const INSTANCES = arg('instances', 3);
const PLAYERS = arg('players', 1000);
const PROPOSALS = arg('proposals', 50_000);
const CONCURRENCY = arg('concurrency', 64);
const STREAMS = Math.min(arg('streams', 50), PLAYERS);
const out = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);

// The sample game that declares signals (games/signals), whatever game is selected.
const { game } = (await import(pathToFileURL(resolve(ROOT, 'games/signals/index.ts')).href)) as { game: GameDef };
const manifest = realityManifest(game);
if (!manifest) throw new Error('games/signals declares no reality.signals');
const signal = manifest.signals.find((s) => s.source === 'mail')?.id ?? manifest.signals[0]!.id;

const dir = mkdtempSync(join(tmpdir(), 'bridge-load-'));
const external = process.env.BRIDGE_STORE;
const tenantId = `load-${randomBytes(3).toString('hex')}`;
const instances: Instance[] = [];
let code = 0;
try {
  const { token } = await initCluster(dir, manifest, {
    store: external ? 'jsonl' : 'sqlite',
    tenantId,
    limits: {
      perMinutePerConnector: 1e9,
      pendingPerPlayer: 1e9,
      streamsPerInstance: 1e6,
      capabilityMs: 24 * 3_600_000,
    },
  });
  // The players, seeded in the store with capabilities this tool keeps.
  const store = await openStore(external ?? 'sqlite:bridge.sqlite', dir, { journal: 'journal.jsonl' });
  const players: { playerId: string; capability: string }[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const capability = randomBytes(32).toString('base64url');
    const playerId = `p-${randomBytes(8).toString('hex')}`;
    await store.putPlayer(tenantId, {
      playerId,
      gameId: manifest.gameId,
      capabilityHash: createHash('sha256').update(capability).digest('hex'),
      capabilityExpiresAt: Date.now() + 24 * 3_600_000,
      issuedAt: Date.now(),
    });
    players.push({ playerId, capability });
  }
  for (let i = 0; i < INSTANCES; i++) instances.push(await startInstance(dir));
  const last = instances[instances.length - 1]!;
  const streams = players.slice(0, STREAMS).map((p) => streamOver(last.url, p.capability));
  await new Promise((ok) => setTimeout(ok, 300));

  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= PROPOSALS) return;
        const p = players[i % PLAYERS]!;
        const t0 = performance.now();
        const status = await proposeOver(instances[i % INSTANCES]!.url, token, {
          playerId: p.playerId,
          signal,
          dedupeKey: `load-${i}`,
        });
        if (status === 202) latencies.push(performance.now() - t0);
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  // Every stream complete: each followed player's signals, in order, once each.
  const perPlayer = (n: number) => Math.floor(PROPOSALS / PLAYERS) + (n < PROPOSALS % PLAYERS ? 1 : 0);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && streams.some((s, n) => s.seen.length < perPlayer(n)))
    await new Promise((ok) => setTimeout(ok, 100));
  const streamsComplete = streams.filter((s, n) =>
    s.seen.every((seq, k) => seq === k + 1) ? s.seen.length === perPlayer(n) : false,
  ).length;
  for (const s of streams) s.stop();
  // The journal: one row per accepted proposal, every player's sequence contiguous.
  const x = await store.exportTenant(tenantId);
  const byPlayer = new Map<string, number[]>();
  for (const s of x.signals) byPlayer.set(s.playerId, [...(byPlayer.get(s.playerId) ?? []), s.sequence]);
  const gaps = [...byPlayer.values()].filter((seqs) => seqs.some((n, k) => n !== k + 1)).length;
  if (external) await store.deleteTenant(tenantId);
  await store.close();

  latencies.sort((a, b) => a - b);
  const q = (p: number) =>
    Math.round((latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0) * 10) / 10;
  const report = {
    at: new Date().toISOString(),
    store: external ? 'postgres' : 'sqlite',
    instances: INSTANCES,
    players: PLAYERS,
    proposals: PROPOSALS,
    concurrency: CONCURRENCY,
    seconds: Math.round(seconds * 10) / 10,
    perSecond: Math.round(PROPOSALS / seconds),
    latencyMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) },
    statuses: Object.fromEntries([...statuses].sort(([a], [b]) => a - b)),
    rows: x.signals.length,
    gaps,
    streams: { followed: STREAMS, complete: streamsComplete },
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
  const ok = report.rows === (statuses.get(202) ?? 0) && gaps === 0 && streamsComplete === STREAMS;
  if (!ok) {
    console.error('✖  the journal or a stream does not hold what was accepted');
    code = 1;
  }
} finally {
  for (const i of instances) if (i.child.exitCode === null) i.child.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}
await flushExit(code);
