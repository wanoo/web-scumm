// The Bridge's commands about its store (4.1.10, ADR 0009, D20; split from cli.ts): which store a configuration
// names, `migrate` (the JSON-lines journal into SQLite or Postgres, or the SQL schema up and down), `doctor`,
// `compact`, `tenant export|delete`, `backup` and `restore`. A store is named by a string: `jsonl` (the journal of
// 4.1.9, beside config.json), `sqlite:<file>` (relative to the Bridge's directory) or `postgres://…`; `--store=` or
// the `BRIDGE_STORE` variable override the configuration's (a database URL with a password stays out of the file;
// `BRIDGE_STORE_FILE`, 4.1.18, reads it from a secret file).
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectJournal, JsonlBridgeStore } from './store';
import { DEFAULT_TENANT, type RealityStore, type TenantExport } from './store-async';
import { fromBridgeStore } from './store-memory';
import { PostgresRealityStore } from './store-postgres';
import { SqlRealityStore } from './store-sql';
import { SqliteRealityStore } from './store-sqlite';

/** `--key=value` or `--key value`. */
export const opt = (args: string[], k: string): string | undefined => {
  const eq = args.find((a) => a.startsWith(`--${k}=`));
  if (eq) return eq.slice(k.length + 3);
  const i = args.indexOf(`--${k}`);
  const next = i >= 0 ? args[i + 1] : undefined;
  return next !== undefined && !next.startsWith('--') ? next : undefined;
};

/** The part of config.json these commands read. */
export interface StoreFile {
  journal: string;
  store?: string;
  tenantId?: string;
}

/**
 * The URL in `BRIDGE_STORE_FILE`: a file named and missing or empty stops the Bridge with why (second reading of
 * 4.1.18 PR 4: an empty secret fell back to each instance's own journal, a split store without a word).
 */
function storeFromFile(file: string): string {
  if (!existsSync(file)) throw new Error(`BRIDGE_STORE_FILE: ${file} does not exist`);
  const url = readFileSync(file, 'utf8').trim();
  if (!url) throw new Error(`BRIDGE_STORE_FILE: ${file} is empty`);
  return url;
}

/**
 * The store a configuration names, after `--store=`, `BRIDGE_STORE` and `BRIDGE_STORE_FILE` (4.1.18: the URL read from
 * a file, so a database password is mounted as a secret file, never in an environment a process listing shows).
 */
export const storeSpec = (file: StoreFile, args: string[], env = process.env): string =>
  opt(args, 'store') ??
  (env.BRIDGE_STORE || undefined) ??
  (env.BRIDGE_STORE_FILE ? storeFromFile(env.BRIDGE_STORE_FILE) : undefined) ??
  file.store ??
  'jsonl';

/** `sqlite` alone means the file `bridge.sqlite` beside config.json. */
const normal = (spec: string) => (spec === 'sqlite' ? 'sqlite:bridge.sqlite' : spec);

/**
 * Opens a store. The journal takes its lock (one process per journal, 4.1.8) unless `lock: false` (a read-only
 * command); SQL stores bring their schema up unless `migrate: false`.
 */
export async function openStore(
  spec: string,
  dir: string,
  file: StoreFile,
  o: { lock?: boolean; migrate?: boolean; onRepair?: (what: string) => void; onPollError?: (e: unknown) => void } = {},
): Promise<RealityStore> {
  const s = normal(spec);
  if (s === 'jsonl') {
    const journal = new JsonlBridgeStore(resolve(dir, file.journal), {
      lock: o.lock ?? true,
      ...(o.onRepair ? { onRepair: o.onRepair } : {}),
    });
    const store = fromBridgeStore(journal, 'jsonl');
    const close = store.close.bind(store);
    store.close = async () => {
      await close();
      journal.close();
    };
    return store;
  }
  if (s.startsWith('sqlite:'))
    return SqliteRealityStore.open(resolve(dir, s.slice('sqlite:'.length)), {
      migrate: o.migrate ?? true,
      ...(o.onPollError ? { onPollError: o.onPollError } : {}),
    });
  if (/^postgres(ql)?:\/\//.test(s)) return PostgresRealityStore.open(s, { migrate: o.migrate ?? true });
  throw new Error(`unknown store "${spec}": jsonl, sqlite[:file] or postgres://…`);
}

/** A backup: every tenant of a store, one instant each (`bridge backup`). */
interface Backup {
  format: 'web-scumm-bridge-backup';
  /** 1: the tenants (players, signals, keys, pairings). 2 (4.1.18): also the runs and the daily challenge's tokens. */
  schema: 1 | 2;
  at: string;
  tenants: TenantExport[];
  /** The `runs` rows (every tenant's leaderboards and queue) and the `daily_kv` rows, on a SQL store. */
  runs?: Record<string, unknown>[];
  daily?: Record<string, unknown>[];
}

/**
 * The SQL tables beside the tenants that a backup carries (4.1.18, second reading of the release: `backup` left out
 * the leaderboards and the daily challenge). `run_quota` is not one: buckets of a minute, rebuilt by traffic.
 */
const BACKED: { table: 'runs' | 'daily_kv'; key: 'runs' | 'daily'; order: string }[] = [
  { table: 'runs', key: 'runs', order: 'tenant_id, id' },
  { table: 'daily_kv', key: 'daily', order: 'k' },
];

const say = (s: string) => console.log(s);

/** The commands of this file; undefined when `cmd` is not one of them. */
export async function storeCommand(
  cmd: string,
  args: string[],
  dir: string,
  file: StoreFile & { tenantId?: string },
  writeFile: (f: StoreFile) => void,
): Promise<number | undefined> {
  const spec = storeSpec(file, args);
  if (cmd === 'migrate') {
    const from = opt(args, 'from');
    const to = opt(args, 'to');
    if (from === undefined) {
      // The SQL schema: up to the latest, or to a version (`--schema=0` undoes everything).
      const target = await openStore(spec, dir, file, { migrate: false });
      try {
        if (!(target instanceof SqlRealityStore)) {
          console.error('✖  the JSON-lines journal has no schema: migrate --from=jsonl --to=sqlite moves it');
          return 1;
        }
        const version = opt(args, 'schema');
        const done = await target.migrate(version === undefined ? {} : { to: Number(version) });
        say(`✔  schema ${await target.schemaVersion()}${done.length ? ` (${done.join(', ')})` : ' (nothing to do)'}`);
        return 0;
      } finally {
        await target.close();
      }
    }
    if (from !== 'jsonl' || !to) {
      console.error(
        'usage: migrate --from=jsonl --to=sqlite[:file]|postgres://… [--tenant=<id>]  ·  migrate [--schema=N]',
      );
      return 2;
    }
    // The journal is read under its lock (the Bridge must be stopped), written into the new store as one tenant.
    const tenantId = opt(args, 'tenant') ?? file.tenantId ?? DEFAULT_TENANT;
    const source = await openStore('jsonl', dir, file, { onRepair: (w) => say(`⚠  ${w}`) });
    const target = await openStore(to, dir, file);
    try {
      if ((await target.tenants()).includes(tenantId)) {
        console.error(`✖  the target already holds the tenant ${tenantId}: nothing written`);
        return 1;
      }
      const x = await source.exportTenant(DEFAULT_TENANT);
      await target.importTenant({
        ...x,
        tenantId,
        signals: x.signals.map((s) => ({ ...s, tenantId })),
        keys: x.keys.map((k) => ({ ...k, tenantId })),
        quarantine: x.quarantine.map((q) => ({ ...q, tenantId })),
      });
      const back = await target.exportTenant(tenantId);
      if (back.signals.length !== x.signals.length || back.players.length !== x.players.length) {
        console.error('✖  the target does not hold what was written: the configuration is left on the journal');
        return 1;
      }
      // The configuration now names the new store, unless it is a URL (a password stays out of the file).
      if (!args.includes('--no-config') && !/^postgres/.test(to)) writeFile({ ...file, store: normal(to) });
      say(
        `✔  ${x.players.length} players and ${x.signals.length} signals moved to ${normal(to).replace(/\/\/[^@]*@/, '//…@')} as tenant ${tenantId}; the journal is kept as it was`,
      );
      return 0;
    } finally {
      await source.close();
      await target.close();
    }
  }
  if (cmd === 'doctor' && normal(spec) === 'jsonl') {
    // The journal read without a change: its lines, its players and signals, a last line cut short, corruption.
    const r = inspectJournal(resolve(dir, file.journal));
    console.log(JSON.stringify({ event: 'journal', ...r }));
    if (r.corrupt) {
      console.error(`✖  ${r.corrupt}: the Bridge will not start on it`);
      return 1;
    }
    say(r.torn ? '⚠  the last line was cut short by a crash: `serve` drops it and says so' : '✔  journal readable');
    return 0;
  }
  if (cmd === 'doctor') {
    // A SQL store read without a change: its schema, each tenant's rows, any gap in a player's sequence, quarantine.
    const store = await openStore(spec, dir, file, { migrate: false });
    try {
      const sql = store as SqlRealityStore;
      const version = await sql.schemaVersion();
      let bad = false;
      const report: Record<string, unknown>[] = [];
      for (const t of await store.tenants()) {
        const x = await store.exportTenant(t);
        const byPlayer = new Map<string, number[]>();
        for (const s of x.signals) byPlayer.set(s.playerId, [...(byPlayer.get(s.playerId) ?? []), s.sequence]);
        const gaps = [...byPlayer].filter(([, seqs]) => seqs.some((n, i) => n !== i + 1)).map(([p]) => p);
        if (gaps.length) bad = true;
        report.push({
          tenant: t,
          players: x.players.length,
          signals: x.signals.length,
          gaps,
          quarantined: x.quarantine.length,
        });
      }
      console.log(JSON.stringify({ event: 'store', kind: store.kind, schema: version, tenants: report }));
      for (const q of await store.quarantined())
        say(`⚠  quarantined: tenant ${q.tenantId}, ${q.playerId} #${q.sequence}: ${q.reason}`);
      say(bad ? '✖  a player has a gap in its sequence' : `✔  ${store.kind} store readable (schema ${version})`);
      return bad ? 1 : 0;
    } finally {
      await store.close();
    }
  }
  if (cmd === 'compact' && normal(spec) !== 'jsonl') {
    console.error(
      '✖  compact rewrites the JSON-lines journal; a SQL store keeps every signal in 4.1.10 (no retention yet)',
    );
    return 1;
  }
  if (cmd === 'tenant') {
    const [, sub] = args;
    const tenantId = opt(args, 'tenant') ?? file.tenantId ?? DEFAULT_TENANT;
    const store = await openStore(spec, dir, file);
    try {
      if (sub === 'export') {
        const out = JSON.stringify(await store.exportTenant(tenantId), null, 1);
        const to = opt(args, 'out');
        if (to) {
          writeFileSync(resolve(to), `${out}\n`, { mode: 0o600 });
          say(`✔  tenant ${tenantId} exported to ${resolve(to)}`);
        } else process.stdout.write(`${out}\n`);
        return 0;
      }
      if (sub === 'delete') {
        if (!args.includes('--yes')) {
          console.error(`✖  deleting the tenant ${tenantId} removes every row it has: add --yes`);
          return 1;
        }
        await store.deleteTenant(tenantId);
        say(`✔  tenant ${tenantId} deleted`);
        return 0;
      }
      console.error('usage: tenant <export|delete> --tenant=<id> [--out=<file>] [--yes]');
      return 2;
    } finally {
      await store.close();
    }
  }
  if (cmd === 'backup') {
    const out = opt(args, 'out');
    if (!out) {
      console.error('usage: backup --out=<file>');
      return 2;
    }
    const store = await openStore(spec, dir, file, { lock: false });
    try {
      const tenants = await Promise.all((await store.tenants()).map((t) => store.exportTenant(t)));
      const b: Backup =
        store instanceof SqlRealityStore
          ? {
              format: 'web-scumm-bridge-backup',
              schema: 2,
              at: new Date().toISOString(),
              tenants,
              ...Object.fromEntries(
                await store.db.tx(
                  undefined,
                  async (q) =>
                    Promise.all(
                      BACKED.map(async (t) => [t.key, await q.all(`SELECT * FROM ${t.table} ORDER BY ${t.order}`)]),
                    ),
                  { readOnly: true },
                ),
              ),
            }
          : { format: 'web-scumm-bridge-backup', schema: 1, at: new Date().toISOString(), tenants };
      writeFileSync(resolve(out), `${JSON.stringify(b)}\n`, { mode: 0o600 });
      chmodSync(resolve(out), 0o600);
      say(
        `✔  ${b.tenants.length} tenant(s)${b.schema === 2 ? `, ${b.runs?.length ?? 0} run(s), ${b.daily?.length ?? 0} daily record(s)` : ''} backed up to ${resolve(out)}`,
      );
      return 0;
    } finally {
      await store.close();
    }
  }
  if (cmd === 'restore') {
    const from = opt(args, 'from');
    if (!from || !existsSync(resolve(from))) {
      console.error('usage: restore --from=<backup file> [--force]');
      return 2;
    }
    const b = JSON.parse(readFileSync(resolve(from), 'utf8')) as Backup;
    if (b.format !== 'web-scumm-bridge-backup' || (b.schema !== 1 && b.schema !== 2)) {
      console.error('✖  not a Bridge backup of schema 1 or 2');
      return 1;
    }
    const store = await openStore(spec, dir, file);
    try {
      const present = await store.tenants();
      const clash = b.tenants.filter((t) => present.includes(t.tenantId)).map((t) => t.tenantId);
      if (clash.length && !args.includes('--force')) {
        console.error(`✖  the store already holds ${clash.join(', ')}: restore into an empty store, or --force`);
        return 1;
      }
      const rows = BACKED.filter((t) => (b[t.key]?.length ?? 0) > 0);
      if (rows.length && !(store instanceof SqlRealityStore)) {
        console.error('✖  this backup holds runs or daily records: restore it into a SQL store (--store=…)');
        return 1;
      }
      // Each tenant replaced in one transaction: deleted and written back together, or left as it was.
      for (const t of b.tenants) await store.importTenant(t, { replace: clash.includes(t.tenantId) });
      // Then the runs and the daily records in one transaction: an existing row is refused without --force, replaced
      // with it (the runs of the backup's tenants deleted first; a daily record is written once, never changed).
      let counts = '';
      if (store instanceof SqlRealityStore && rows.length) {
        const force = args.includes('--force');
        let refusedWhy = '';
        const ok = await store.db
          .tx('backup:restore', async (q) => {
            const tenantsOf = [...new Set((b.runs ?? []).map((r) => String(r.tenant_id)))];
            if (tenantsOf.length) {
              const marks = tenantsOf.map((_, i) => `$${i + 1}`).join(', ');
              const held = await q.all(`SELECT COUNT(*) AS n FROM runs WHERE tenant_id IN (${marks})`, tenantsOf);
              if (Number(held[0]?.n ?? 0) > 0 && !force) return false;
              await q.run(`DELETE FROM runs WHERE tenant_id IN (${marks})`, tenantsOf);
            }
            for (const t of rows)
              for (const r of b[t.key] ?? []) {
                // A column is named by the file: a plain identifier only, never text spliced into the statement.
                const cols = Object.keys(r);
                const bad = cols.find((c) => !/^[a-z_]{1,40}$/.test(c));
                if (bad) {
                  refusedWhy = `the backup names a column "${bad.slice(0, 40)}": refused, nothing restored of its runs`;
                  throw new Error(refusedWhy);
                }
                const sql = `INSERT INTO ${t.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})${t.table === 'daily_kv' ? ' ON CONFLICT (k) DO NOTHING' : ''}`;
                await q.run(
                  sql,
                  cols.map((c) => r[c]),
                );
              }
            return true;
          })
          .catch((e: unknown) => {
            if (refusedWhy) return refusedWhy;
            throw e;
          });
        if (typeof ok === 'string') {
          console.error(`✖  ${ok}`);
          return 1;
        }
        if (!ok) {
          console.error('✖  the store already holds runs of these tenants: restore into an empty store, or --force');
          return 1;
        }
        counts = `, ${b.runs?.length ?? 0} run(s), ${b.daily?.length ?? 0} daily record(s)`;
      }
      say(`✔  ${b.tenants.length} tenant(s)${counts} restored from ${b.at}`);
      return 0;
    } finally {
      await store.close();
    }
  }
  return undefined;
}
