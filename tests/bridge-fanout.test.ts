// Stateless instances (4.1.10, D20): a signal accepted by one instance reaches a stream held by another, woken by the
// store (memory, SQLite's poll, Postgres NOTIFY with BRIDGE_PG_URL); streams are bounded per instance; a row that no
// longer reads is quarantined and skipped, never sent. Then three `serve` processes on one SQLite file, 1 000
// proposals, one process killed with SIGKILL in the middle: every proposal lands once (retried elsewhere with its
// dedupe key), every player's sequence is contiguous, and a stream held by a surviving process received each once.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { realityManifest } from '@engine/reality/manifest';
import type { RealityStore } from '../bridge/src/store-async';
import { MemoryRealityStore } from '../bridge/src/store-memory';
import { type PgModule, PostgresRealityStore } from '../bridge/src/store-postgres';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';
import { main } from '../bridge/src/cli';
import {
  initCluster,
  type Instance,
  journalOver,
  pairOver,
  proposeWithSequence,
  startInstance,
  streamOver,
} from '../tools/bridge-cluster';
import { eventKey, tenantBridge } from './fixtures/bridge-tenant';
import { signals } from './fixtures/signals';

const dir = mkdtempSync(join(tmpdir(), 'bridge-fanout-'));
const opened: RealityStore[] = [];
const children: Instance[] = [];
afterAll(async () => {
  for (const c of children) if (c.child.exitCode === null) c.child.kill('SIGKILL');
  for (const s of opened) await s.close().catch(() => {});
  // Windows keeps a killed process's files busy for a moment (EBUSY on bridge.sqlite): tried again for two seconds.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Two handles on one store: the same object, two SQLite connections, two Postgres pools. */
const PAIRS: { name: string; open: () => Promise<[RealityStore, RealityStore]> }[] = [
  {
    name: 'memory',
    open: async () => {
      const s = new MemoryRealityStore();
      return [s, s];
    },
  },
  {
    name: 'sqlite',
    open: async () => {
      const file = join(dir, `${randomBytes(4).toString('hex')}.sqlite`);
      const a = await SqliteRealityStore.open(file, { pollMs: 20 });
      const b = await SqliteRealityStore.open(file, { pollMs: 20 });
      opened.push(a, b);
      return [a, b];
    },
  },
];
if (process.env.BRIDGE_PG_URL)
  PAIRS.push({
    name: 'postgres',
    open: async () => {
      const pg = ((await import(/* @vite-ignore */ process.env.BRIDGE_PG_MODULE ?? 'pg')) as { default: PgModule })
        .default;
      const a = await PostgresRealityStore.open(process.env.BRIDGE_PG_URL!, { pg });
      const b = await PostgresRealityStore.open(process.env.BRIDGE_PG_URL!, { pg });
      await b.listening();
      opened.push(a, b);
      return [a, b];
    },
  });

const until = async (ok: () => boolean, ms = 5000) => {
  for (let t = 0; t < ms && !ok(); t += 20) await new Promise((r) => setTimeout(r, 20));
};

describe.each(PAIRS)('two instances of one tenant on $name', ({ open }) => {
  it('a signal accepted by A reaches the stream B holds, in order, once each', async () => {
    const [sa, sb] = await open();
    const tenantId = `t-${randomBytes(4).toString('hex')}`;
    const key = await eventKey();
    const a = await tenantBridge(sa, { tenantId, key });
    // B: the same tenant's configuration (the same root, key and operator), another instance.
    const b = await tenantBridge(sb, { tenantId, key, rootPrivate: a.rootPrivate });
    const link = await a.pair();
    const got: number[] = [];
    await b.bridge.subscribe(link.capability, (seq) => got.push(seq));
    await Promise.all(Array.from({ length: 20 }, (_, i) => a.propose(link.playerId, `d-${i}`)));
    await until(() => got.length >= 20);
    expect(got).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    a.bridge.close();
    b.bridge.close();
  });
});

describe('one instance, its limits and its quarantine', () => {
  it('streams are bounded per instance: beyond, a 429', async () => {
    const store = new MemoryRealityStore();
    const t = await tenantBridge(store, { limits: { streamsPerInstance: 1 } });
    const [p1, p2] = [await t.pair(), await t.pair()];
    await t.bridge.subscribe(p1.capability, () => {});
    await expect(t.bridge.subscribe(p2.capability, () => {})).rejects.toMatchObject({ status: 429, code: 'streams' });
    expect(t.bridge.telemetry.snapshot()['streams.refused:instance']).toBe(1);
  });

  it('a row that no longer reads is quarantined and skipped; the stream goes on; doctor lists it', async () => {
    const file = join(dir, 'quarantine.sqlite');
    const store = await SqliteRealityStore.open(file);
    opened.push(store);
    const t = await tenantBridge(store, { tenantId: 'default' });
    const link = await t.pair();
    for (const k of ['a', 'b', 'c']) await t.propose(link.playerId, k);
    await store.db.run("UPDATE signals SET jws = 'not a jws' WHERE player_id = $1 AND sequence = 2", [link.playerId]);
    const delivered = await t.bridge.signals(link.capability, 0);
    expect(delivered.map((d) => d.sequence)).toEqual([1, 3]);
    expect(await store.quarantined('default')).toEqual([
      expect.objectContaining({ playerId: link.playerId, sequence: 2, reason: 'not a compact JWS' }),
    ]);
    expect(t.bridge.telemetry.snapshot().quarantine).toBe(1);
    // A stream from the start skips it too.
    const got: number[] = [];
    const sub = await t.bridge.subscribe(link.capability, (seq) => got.push(seq), undefined, { after: 0 });
    await sub.pump();
    expect(got).toEqual([1, 3]);
  });
});

// On Postgres when CI's job gives one and `pg` resolves from the repository (a local run that loads `pg` from
// elsewhere, BRIDGE_PG_MODULE, cannot hand it to the spawned processes: that variant runs in CI only).
const CLUSTERS = [{ name: 'SQLite file', store: 'sqlite', env: {} as Record<string, string> }];
if (process.env.BRIDGE_PG_URL && !process.env.BRIDGE_PG_MODULE)
  CLUSTERS.push({ name: 'Postgres database', store: 'jsonl', env: { BRIDGE_STORE: process.env.BRIDGE_PG_URL } });

describe.each(CLUSTERS)('three processes, one $name, one killed', ({ store, env }) => {
  it('1 000 proposals, one instance killed with SIGKILL: none lost, none applied twice, sequences contiguous', async () => {
    const home = join(dir, `cluster-${randomBytes(3).toString('hex')}`);
    const tenantId = `t-${randomBytes(4).toString('hex')}`;
    const { token } = await initCluster(home, realityManifest(signals())!, {
      store,
      tenantId,
      limits: { perMinutePerConnector: 1_000_000, pendingPerPlayer: 1_000_000 },
    });
    const instances = await Promise.all([0, 1, 2].map(() => startInstance(home, { ...process.env, ...env })));
    children.push(...instances);
    const players: { playerId: string; capability: string }[] = [];
    for (let i = 0; i < 10; i++) players.push(await pairOver(instances[1]!.url, token));
    // A stream on a process that survives, and one on the process that will be killed, both opened first.
    const stream = streamOver(instances[2]!.url, players[0]!.capability);
    const doomed = streamOver(instances[0]!.url, players[1]!.capability);
    const exited = new Promise<string | null>((ok) => instances[0]!.child.once('exit', (_c, sig) => ok(sig)));
    // The connector does not know which instance died: it keeps sending to all three and retries elsewhere.
    const all = [0, 1, 2];
    const TOTAL = 1000;
    let next = 0;
    let done = 0;
    let killed = false;
    let retries = 0;
    const statuses = new Map<number, number>();
    const accepted = new Map<string, { playerId: string; sequence: number }>();
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= TOTAL) return;
        const body = { playerId: players[i % 10]!.playerId, signal: 'mail.answer.correct', dedupeKey: `d-${i}` };
        // The connector's own retry: on another instance, with the same dedupe key, until one answers.
        for (let attempt = 0; ; attempt++) {
          const r = await proposeWithSequence(instances[all[(i + attempt) % 3]!]!.url, token, body);
          if (r.status === 202 || r.status === 200) {
            statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
            accepted.set(body.dedupeKey, { playerId: body.playerId, sequence: r.sequence ?? -1 });
            break;
          }
          retries++;
          if (attempt > 20) throw new Error(`proposal ${i}: ${r.status}`);
        }
        done++;
        if (!killed && done >= 300) {
          killed = true;
          instances[0]!.child.kill('SIGKILL');
        }
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    expect(killed).toBe(true);
    expect(await exited).toBe('SIGKILL');
    // The risky path ran: proposals sent to the dead instance were retried elsewhere.
    expect(retries).toBeGreaterThan(0);
    // Every player's journal, read from a survivor: contiguous from 1, each dedupe key once, 1 000 in all.
    let total = 0;
    const keys = new Set<string>();
    const journals: { sequence: number; dedupeKey: string }[][] = [];
    for (const [n, p] of players.entries()) {
      const j = await journalOver(instances[1]!.url, p.capability);
      journals.push(j);
      expect(j.map((x) => x.sequence)).toEqual(Array.from({ length: j.length }, (_, k) => k + 1));
      for (const x of j) {
        expect(Number(x.dedupeKey.slice(2)) % 10, x.dedupeKey).toBe(n);
        keys.add(x.dedupeKey);
        // The sequence the connector was told is the one the journal holds.
        expect(accepted.get(x.dedupeKey)?.sequence, x.dedupeKey).toBe(x.sequence);
      }
      total += j.length;
    }
    expect(total).toBe(TOTAL);
    expect(keys.size).toBe(TOTAL);
    // A sample of accepted proposals sent again to another instance: 200, the same sequence, nothing new.
    for (let i = 0; i < TOTAL; i += 37) {
      const key = `d-${i}`;
      const r = await proposeWithSequence(instances[2]!.url, token, {
        playerId: players[i % 10]!.playerId,
        signal: 'mail.answer.correct',
        dedupeKey: key,
      });
      expect(r, key).toEqual({ status: 200, sequence: accepted.get(key)!.sequence });
    }
    expect((await journalOver(instances[1]!.url, players[0]!.capability)).length).toBe(100);
    // The stream held by instance 2 saw player 0's hundred signals, in order, once each.
    await until(() => stream.seen.length >= 100, 10_000);
    stream.stop();
    expect(stream.seen).toEqual(Array.from({ length: 100 }, (_, k) => k + 1));
    // The stream the killed instance held ended; reconnected elsewhere from its cursor, it resumes with the rest.
    await until(() => doomed.ended(), 5_000);
    expect(doomed.ended()).toBe(true);
    const cursor = doomed.seen.at(-1) ?? 0;
    expect(doomed.seen).toEqual(Array.from({ length: cursor }, (_, k) => k + 1));
    const resumed = streamOver(instances[1]!.url, players[1]!.capability, cursor);
    await until(() => resumed.seen.length >= 100 - cursor, 10_000);
    resumed.stop();
    expect(resumed.seen).toEqual(Array.from({ length: 100 - cursor }, (_, k) => cursor + k + 1));
    // And the store says the same: no gap, nothing quarantined.
    const log = console.log;
    const lines: string[] = [];
    console.log = (x: unknown) => void lines.push(String(x));
    const before = process.env.BRIDGE_STORE;
    if (env.BRIDGE_STORE) process.env.BRIDGE_STORE = env.BRIDGE_STORE;
    try {
      expect(await main(['doctor', `--dir=${home}`])).toBe(0);
    } finally {
      console.log = log;
      if (before === undefined) delete process.env.BRIDGE_STORE;
      else process.env.BRIDGE_STORE = before;
    }
    const report = JSON.parse(lines.find((l) => l.includes('"event":"store"')) ?? '{}') as {
      tenants?: { tenant: string; signals: number; gaps: string[]; quarantined: number }[];
    };
    expect(report.tenants?.find((t) => t.tenant === tenantId)).toEqual({
      tenant: tenantId,
      players: 10,
      signals: TOTAL,
      gaps: [],
      quarantined: 0,
    });
    console.info(
      `kill -9 test: ${TOTAL} proposals, ${retries} retries after the kill, ${statuses.get(200) ?? 0} answered as duplicates, the killed stream at ${doomed.seen.length}`,
    );
  }, 120_000);
});
