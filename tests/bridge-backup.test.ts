// The Bridge's backup schema 3 and its all-or-nothing restore (4.1.19, ADR 0021, plan §5): every failed restore
// leaves the store as it was (a late error, an unknown column, a tenant that is not one, a truncated or forged file, a
// conflict without --force, the journal refused before it is touched); a backup is one snapshot even while a writer
// commits across families; the file is bounded, written atomically and checked by its digest; schemas 1 and 2 still
// read. SQLite always; Postgres too when `BRIDGE_PG_URL` names a database (CI's `bridge-postgres` job), each case in a
// database of its own.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { realityManifest } from '@engine/reality/manifest';
import {
  BackupError,
  type BackupPayload,
  DAILY_COLUMNS,
  makeBackup,
  payloadDigest,
  RUN_COLUMNS,
  readBackup,
  readBounded,
  restoreBackup,
  stableJson,
  writeAtomic,
} from '../bridge/src/backup';
import { main } from '../bridge/src/cli';
import type { TenantExport } from '../bridge/src/store-async';
import { type PgModule, PostgresRealityStore } from '../bridge/src/store-postgres';
import type { SqlRealityStore } from '../bridge/src/store-sql';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';
import { signals } from './fixtures/signals';

const temps: string[] = [];
const opened: SqlRealityStore[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const s of opened) await s.close().catch(() => {});
  for (const c of cleanups) await c().catch(() => {});
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `bridge-backup-${name}-`));
  temps.push(d);
  return d;
};

const PG_URL = process.env.BRIDGE_PG_URL;
const pgModule = async (): Promise<PgModule> =>
  ((await import(/* @vite-ignore */ process.env.BRIDGE_PG_MODULE ?? 'pg')) as { default: PgModule }).default;

/** A SQL store of each kind, empty, with a second handle on the same data (a writer beside the backup). */
interface Kind {
  name: string;
  open(): Promise<{ a: SqlRealityStore; b: SqlRealityStore; url: string }>;
}
const KINDS: Kind[] = [
  {
    name: 'sqlite',
    open: async () => {
      const file = join(tmp('db'), 'bridge.sqlite');
      const a = await SqliteRealityStore.open(file, { pollMs: 0 });
      const b = await SqliteRealityStore.open(file, { pollMs: 0 });
      opened.push(a, b);
      return { a, b, url: `sqlite:${file}` };
    },
  },
];
if (PG_URL)
  KINDS.push({
    name: 'postgres',
    open: async () => {
      const pg = await pgModule();
      const name = `bridge_backup_${randomBytes(4).toString('hex')}`;
      const admin = new pg.Pool({ connectionString: PG_URL });
      // A collation that orders ids otherwise than code units (en_US, the default of most images), when the server
      // has it: the read-back must not depend on the database's order.
      await admin
        .query(`CREATE DATABASE ${name} TEMPLATE template0 LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'`)
        .catch(() => admin.query(`CREATE DATABASE ${name}`));
      const url = new URL(PG_URL);
      url.pathname = `/${name}`;
      const a = await PostgresRealityStore.open(url.toString(), { pg });
      const b = await PostgresRealityStore.open(url.toString(), { pg });
      opened.push(a, b);
      cleanups.push(async () => {
        await a.close().catch(() => {});
        await b.close().catch(() => {});
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.end();
      });
      return { a, b, url: url.toString() };
    },
  });

/** A tenant with a row in every family the export knows. */
function tenant(id: string, n = 2): TenantExport {
  const players = Array.from({ length: n }, (_, i) => ({
    playerId: `p-${i}`,
    gameId: 'g',
    capabilityHash: `h${i}`.padEnd(64, '0'),
    capabilityExpiresAt: 2_000_000_000_000,
    issuedAt: 1_000 + i,
    sessionId: `s-${i}`,
    origin: 'https://game.example',
    ...(i === 1 ? { revoked: true } : {}),
  }));
  return {
    tenantId: id,
    players,
    signals: players.flatMap((p) =>
      [1, 2, 3].map((sequence) => ({
        tenantId: id,
        playerId: p.playerId,
        sequence,
        id: `${p.playerId}-sig-${sequence}`,
        dedupeKey: `${p.playerId}-d-${sequence}`,
        jws: `jws.${p.playerId}.${sequence}`,
        at: 5_000 + sequence,
        kid: 'k1',
        payload: { v: 2, signal: 'mail.answer.correct', n: sequence } as never,
      })),
    ),
    acks: [{ playerId: 'p-0', through: 2 }],
    revokedTokens: ['tok-1'],
    // Ids whose order depends on the collation (mixed case, `-` and `_`): a Postgres in en_US orders them otherwise.
    keys: ['k1', 'Kb', 'ka', 'k_-'].map((keyId) => ({ tenantId: id, keyId, publicKey: `pub-${keyId}` })),
    quarantine: [{ tenantId: id, playerId: 'p-0', sequence: 9, reason: 'unreadable', at: 7 }],
    pairings: [{ code: 'ABCD-1234', gameId: 'g', expiresAt: 3_000, playerId: 'p-0', claimed: true }],
  };
}
const runRow = (tenantId: string, id: string): Record<string, unknown> => ({
  tenant_id: tenantId,
  id,
  game_id: 'g',
  category_id: 'any%',
  player: `player-${id}`,
  submitted_at: 1_000,
  status: 'verified',
  verdict: 'valid',
  code: null,
  reason: null,
  trust: 'replay-valid',
  ranked: '42',
  seed_kind: null,
  world_hash: null,
  world_mode: null,
  world_seed: null,
  leaderboard_key: 'any%',
  run_key: `key-${id}`,
  delete_token_hash: 'h'.repeat(64),
  envelope: '{"v":2}',
  lease_owner: null,
  lease_until: null,
});
const dailyRow = (k: string) => ({ k, v: '{"token":"t"}', created_at: 7 });

async function fill(s: SqlRealityStore, p: BackupPayload): Promise<void> {
  const r = await restoreBackup(s, p, { force: false, carriesRuns: true });
  expect(r.ok, r.ok ? '' : r.why).toBe(true);
}
const payload = (): BackupPayload => ({
  tenants: [tenant('t-a'), tenant('t-b', 3)],
  runs: [runRow('t-a', 'run_Ab'), runRow('t-a', 'run_aa'), runRow('t-a', 'run_-z'), runRow('t-b', 'r1')],
  daily: [dailyRow('daily|g|2026-10-10'), dailyRow('mystery|g|x')],
});
/** The whole store as one canonical text: two equal texts are the same logical store. */
const state = async (s: SqlRealityStore) => stableJson((await makeBackup(s)).payload);

/** The command line in this process, its output kept. */
async function cli(args: string[]): Promise<{ code: number; out: string }> {
  const out: string[] = [];
  const [log, err] = [console.log, console.error];
  console.log = (x: unknown) => void out.push(String(x));
  console.error = (x: unknown) => void out.push(String(x));
  try {
    return { code: await main(args, { manifest: realityManifest(signals()) }), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}

describe('the backup file', () => {
  it('names every column of runs and daily_kv, in the schema’s order', async () => {
    const s = await SqliteRealityStore.open(':memory:', { pollMs: 0 });
    opened.push(s);
    const cols = async (t: string) => (await s.db.all(`PRAGMA table_info(${t})`)).map((r) => String(r.name));
    expect(await cols('runs')).toEqual([...RUN_COLUMNS]);
    expect(await cols('daily_kv')).toEqual([...DAILY_COLUMNS]);
  });

  it('is checked by its digest and its counts; a change or a truncation is refused', async () => {
    const s = await SqliteRealityStore.open(':memory:', { pollMs: 0 });
    opened.push(s);
    await fill(s, payload());
    const b = await makeBackup(s);
    expect(b.schema).toBe(3);
    expect(b.store).toEqual({ kind: 'sqlite', schema: 4 });
    expect(b.counts).toMatchObject({ tenants: 2, players: 5, signals: 15, runs: 4, daily: 2, pairings: 2 });
    expect(b.digest.value).toBe(payloadDigest(b.payload));
    const text = JSON.stringify(b);
    expect(readBackup(text).payload).toEqual(b.payload);
    const forged = JSON.parse(text);
    forged.payload.runs[0].ranked = '1';
    expect(() => readBackup(JSON.stringify(forged))).toThrow(/digest/);
    const recounted = JSON.parse(text);
    recounted.counts.runs = 5;
    expect(() => readBackup(JSON.stringify(recounted))).toThrow(/counts/);
    expect(() => readBackup(text.slice(0, -20))).toThrow(BackupError);
  });

  it('refuses unknown fields, wrong types, duplicates and runs of a tenant it does not carry', () => {
    const base = (): BackupPayload => payload();
    const v3 = (p: BackupPayload) =>
      JSON.stringify({
        format: 'web-scumm-bridge-backup',
        schema: 3,
        bridge: { version: 'x' },
        store: { kind: 'sqlite', schema: 4 },
        startedAt: 'a',
        endedAt: 'b',
        counts: {
          tenants: p.tenants.length,
          players: p.tenants.reduce((n, t) => n + t.players.length, 0),
          signals: p.tenants.reduce((n, t) => n + t.signals.length, 0),
          acks: p.tenants.reduce((n, t) => n + t.acks.length, 0),
          revokedTokens: p.tenants.reduce((n, t) => n + t.revokedTokens.length, 0),
          keys: p.tenants.reduce((n, t) => n + t.keys.length, 0),
          quarantine: p.tenants.reduce((n, t) => n + t.quarantine.length, 0),
          pairings: p.tenants.reduce((n, t) => n + (t.pairings?.length ?? 0), 0),
          runs: p.runs.length,
          daily: p.daily.length,
        },
        payload: p,
        digest: { alg: 'sha256', value: payloadDigest(p) },
      });
    expect(readBackup(v3(base())).schema).toBe(3);
    const cases: [string, (p: BackupPayload) => void, RegExp][] = [
      ['an unknown column in the last run', (p) => void (p.runs.at(-1)!.extra = 1), /runs/],
      ['a column spliced as SQL', (p) => void (p.runs[0] = { 'id) VALUES (1); --': 'x' }), /runs/],
      ['a time given as text', (p) => void (p.tenants[0]!.players[0]!.capabilityExpiresAt = '1' as never), /players/],
      ['a tenant id that is not one', (p) => void (p.tenants[1]!.tenantId = 'bad tenant!'), /tenant/],
      ['a tenant twice', (p) => void p.tenants.push(tenant('t-a')), /twice/],
      ['a player twice', (p) => void p.tenants[0]!.players.push({ ...p.tenants[0]!.players[0]! }), /twice/],
      ['a run twice', (p) => void p.runs.push(runRow('t-a', 'run_aa')), /twice/],
      ['a daily record twice', (p) => void p.daily.push(dailyRow('mystery|g|x')), /twice/],
      ['a run of a tenant not carried', (p) => void p.runs.push(runRow('t-z', 'r9')), /does not carry/],
      [
        'an ack of an unknown player',
        (p) => void p.tenants[0]!.acks.push({ playerId: 'nobody', through: 1 }),
        /player/,
      ],
      ['a signal of another tenant', (p) => void (p.tenants[0]!.signals[0]!.tenantId = 't-b'), /another tenant/],
    ];
    for (const [what, change, why] of cases) {
      const p = base();
      change(p);
      expect(() => readBackup(v3(p)), what).toThrow(why);
    }
  });

  it('still reads schemas 1 and 2, and drops a capability a journal’s pairing held', () => {
    const t = tenant('default');
    (t.pairings![0] as { capability?: string }).capability = 'secret-capability';
    const one = readBackup(JSON.stringify({ format: 'web-scumm-bridge-backup', schema: 1, at: 'x', tenants: [t] }));
    expect(one.schema).toBe(1);
    expect(JSON.stringify(one.payload)).not.toContain('secret-capability');
    const two = readBackup(
      JSON.stringify({
        format: 'web-scumm-bridge-backup',
        schema: 2,
        at: 'x',
        tenants: [t],
        // Postgres' driver gives a BIGINT as text: read as a number.
        runs: [{ ...runRow('default', 'r1'), submitted_at: '1000' }],
        daily: [dailyRow('k')],
      }),
    );
    expect(two.payload.runs[0]!.submitted_at).toBe(1000);
  });

  it('is read bounded: too large, a link or something else than a file is refused before it is read', () => {
    const d = tmp('bounded');
    const f = join(d, 'b.json');
    writeFileSync(f, 'x'.repeat(100));
    expect(readBounded(f, 100)).toHaveLength(100);
    expect(() => readBounded(f, 99)).toThrow(/more than 99/);
    expect(() => readBounded(d, 1000)).toThrow(/not a regular file/);
    if (process.platform !== 'win32') {
      symlinkSync(f, join(d, 'link.json'));
      expect(() => readBounded(join(d, 'link.json'), 1000)).toThrow(/not a regular file/);
    }
  });

  it('is written atomically: a private temporary file renamed, nothing left beside it', () => {
    const d = tmp('atomic');
    const f = join(d, 'b.json');
    writeFileSync(f, 'old');
    writeAtomic(f, 'new');
    expect(readFileSync(f, 'utf8')).toBe('new');
    expect(readdirSync(d)).toEqual(['b.json']);
  });
});

describe.each(KINDS)('restore on $name: all or nothing', (kind) => {
  it('round-trips every family; a second backup of the restored store is the same payload', async () => {
    const { a: source } = await kind.open();
    await fill(source, payload());
    const b = await makeBackup(source);
    const { a: target } = await kind.open();
    const r = await restoreBackup(target, readBackup(JSON.stringify(b)).payload, { force: false, carriesRuns: true });
    expect(r).toEqual({ ok: true, tenants: 2, runs: 4, daily: 2 });
    expect((await makeBackup(target)).digest.value).toBe(b.digest.value);
  });

  it('a conflict without --force is found before the first write; with --force, replaced in one transaction', async () => {
    const { a: s } = await kind.open();
    await fill(s, { tenants: [tenant('t-a', 1)], runs: [runRow('t-a', 'old')], daily: [dailyRow('mystery|g|x')] });
    const before = await state(s);
    const r = await restoreBackup(s, payload(), { force: false, carriesRuns: true });
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.why).toMatch(/t-a.*run\(s\).*daily record/);
    expect(await state(s)).toBe(before);
    const f = await restoreBackup(s, payload(), { force: true, carriesRuns: true });
    expect(f.ok).toBe(true);
    const after = (await makeBackup(s)).payload;
    // In code-unit order whatever the database's collation: the same file from SQLite and Postgres.
    expect(after.runs.map((x) => x.id)).toEqual(['run_-z', 'run_Ab', 'run_aa', 'r1']);
    expect(after.tenants.find((t) => t.tenantId === 't-a')!.players).toHaveLength(2);
  });

  it('a late error (the last row refused by the database) undoes the tenants already written', async () => {
    const { a: s } = await kind.open();
    await fill(s, { tenants: [tenant('t-keep', 1)], runs: [], daily: [] });
    const before = await state(s);
    const p = payload();
    // Past the file's checks on purpose: the database itself refuses the last statement, after every tenant was written.
    p.daily.push(dailyRow('daily|g|2026-10-10'));
    await expect(restoreBackup(s, p, { force: false, carriesRuns: true })).rejects.toThrow();
    expect(await state(s)).toBe(before);
  });

  it('a store that does not read back what was written rolls back before the commit', async () => {
    const { a: s } = await kind.open();
    const before = await state(s);
    const p = payload();
    // An acknowledgement of 0 is not stored; one beyond what the export reads back is a difference.
    p.tenants[0]!.players[0]!.capabilityExpiresAt = 1;
    p.tenants[0]!.acks = [
      { playerId: 'p-0', through: 2 },
      { playerId: 'p-0', through: 3 },
    ];
    const r = await restoreBackup(s, p, { force: false, carriesRuns: true });
    expect(r.ok).toBe(false);
    expect(await state(s)).toBe(before);
  });

  it('a backup taken while a writer commits a run and its daily record together is one instant', async () => {
    const { a: backup, b: writer } = await kind.open();
    await fill(writer, { tenants: [tenant('t-w', 1)], runs: [], daily: [] });
    let stop = false;
    let n = 0;
    const writing = (async () => {
      while (!stop) {
        const i = n++;
        await writer.db.tx('test:writer', async (q) => {
          const r = runRow('t-w', `w${i}`);
          await q.run(
            `INSERT INTO runs (${RUN_COLUMNS.join(', ')}) VALUES (${RUN_COLUMNS.map((_, j) => `$${j + 1}`).join(', ')})`,
            RUN_COLUMNS.map((c) => r[c]),
          );
          await q.run('INSERT INTO daily_kv (k, v, created_at) VALUES ($1, $2, $3)', [`w${i}`, 'v', i]);
        });
        // SQLite answers in microtasks: without a turn of the event loop the backup's timers would never run.
        await new Promise((ok) => setImmediate(ok));
      }
    })();
    try {
      for (let k = 0; k < 8; k++) {
        const b = await makeBackup(backup);
        // A run without its daily record (or the reverse) would be two instants in one file.
        expect(b.payload.runs.length).toBe(b.payload.daily.length);
        expect(readBackup(JSON.stringify(b)).payload.runs).toHaveLength(b.payload.runs.length);
        await new Promise((ok) => setTimeout(ok, 5));
      }
    } finally {
      stop = true;
      await writing;
    }
    expect(n).toBeGreaterThan(0);
  });

  it('from the command line: a refused file restores nothing; backup refuses above --max-bytes and writes no file', async () => {
    const { a: s, url } = await kind.open();
    await fill(s, payload());
    const dir = tmp('cli');
    expect((await cli(['init', `--dir=${dir}`, '--no-demo-webhooks'])).code).toBe(0);
    const out = join(dir, 'backup.json');
    const b = await cli(['backup', `--dir=${dir}`, `--store=${url}`, `--out=${out}`]);
    expect(b.code, b.out).toBe(0);
    expect(b.out).toContain('schema 3, one snapshot');
    const small = join(dir, 'small.json');
    const big = await cli(['backup', `--dir=${dir}`, `--store=${url}`, `--out=${small}`, '--max-bytes=100']);
    expect(big.code).toBe(1);
    // A bound that is not a positive integer is refused, never read as "no bound".
    for (const bad of ['--max-bytes=abc', '--max-rows=0', '--max-bytes=-1'])
      expect((await cli(['backup', `--dir=${dir}`, `--store=${url}`, `--out=${small}`, bad])).code, bad).toBe(2);
    expect((await cli(['backup', `--dir=${dir}`, `--store=${url}`, `--out=${small}`, '--max-rows=5'])).code).toBe(1);
    expect(existsSync(small)).toBe(false);
    const before = await state(s);
    const forged = JSON.parse(readFileSync(out, 'utf8'));
    forged.payload.runs.at(-1).surprise = 1;
    writeFileSync(join(dir, 'forged.json'), JSON.stringify(forged));
    const refused = await cli([
      'restore',
      `--dir=${dir}`,
      `--store=${url}`,
      `--from=${join(dir, 'forged.json')}`,
      '--force',
    ]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain('nothing restored');
    expect(await state(s)).toBe(before);
    const again = await cli(['restore', `--dir=${dir}`, `--store=${url}`, `--from=${out}`]);
    expect(again.code).toBe(1);
    expect(again.out).toContain('already holds');
    const forced = await cli(['restore', `--dir=${dir}`, `--store=${url}`, `--from=${out}`, '--force']);
    expect(forced.code, forced.out).toBe(0);
    expect(forced.out).toContain('checked before and after the commit');
    expect(await state(s)).toBe(before);
  });
});

describe.each(KINDS)('restore on $name: what a file does not carry', (kind) => {
  it('a schema 1 file (no runs) neither refuses over the leaderboards nor deletes them, even with --force', async () => {
    const { a: s } = await kind.open();
    await fill(s, payload());
    const one = { tenants: [tenant('t-a')], runs: [], daily: [] };
    const r = await restoreBackup(s, one, { force: true, carriesRuns: false });
    expect(r.ok, r.ok ? '' : r.why).toBe(true);
    expect((await makeBackup(s)).payload.runs).toHaveLength(4);
    // A schema 2 or 3 file that carries a tenant without runs says it had none: --force replaces them.
    expect((await restoreBackup(s, one, { force: true, carriesRuns: true })).ok).toBe(true);
    expect((await makeBackup(s)).payload.runs.map((x) => x.tenant_id)).toEqual(['t-b']);
  });

  it('more tenants than one statement’s list holds (chunks of 500)', async () => {
    const { a: s } = await kind.open();
    const many = Array.from({ length: 1_203 }, (_, i) => ({
      tenantId: `t-${String(i).padStart(4, '0')}`,
      players: [{ playerId: 'p', gameId: 'g', capabilityHash: 'h', capabilityExpiresAt: 1 }],
      signals: [],
      acks: [],
      revokedTokens: [],
      keys: [],
      quarantine: [],
      pairings: [],
    }));
    const p = { tenants: many, runs: [runRow('t-1202', 'r')], daily: [] };
    expect((await restoreBackup(s, p, { force: false, carriesRuns: true })).ok).toBe(true);
    const again = await restoreBackup(s, p, { force: false, carriesRuns: true });
    expect(again.ok ? '' : again.why).toMatch(/1 run\(s\)/);
    expect((await restoreBackup(s, p, { force: true, carriesRuns: true })).ok).toBe(true);
    expect((await makeBackup(s)).counts).toMatchObject({ tenants: 1_203, runs: 1 });
  }, 60_000);
});

describe('the journal', () => {
  it('is refused before anything is touched: restore needs a SQL store', async () => {
    const dir = tmp('jsonl');
    expect((await cli(['init', `--dir=${dir}`, '--no-demo-webhooks'])).code).toBe(0);
    const file = join(dir, 'b.json');
    const backup = await cli(['backup', `--dir=${dir}`, `--out=${file}`]);
    expect(backup.code, backup.out).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).store.kind).toBe('jsonl');
    const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { journal: string };
    const journal = join(dir, config.journal);
    const bytes = existsSync(journal) ? readFileSync(journal) : undefined;
    const r = await cli(['restore', `--dir=${dir}`, `--from=${file}`, '--force']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('migrate it to SQLite first');
    expect(existsSync(journal) ? readFileSync(journal) : undefined).toEqual(bytes);
  });
});
