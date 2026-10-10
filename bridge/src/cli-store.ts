// The Bridge's commands about its store (4.1.10, ADR 0009, D20; split from cli.ts): which store a configuration
// names, `migrate` (the JSON-lines journal into SQLite or Postgres, or the SQL schema up and down), `doctor`,
// `compact`, `tenant export|delete`, `backup` and `restore`. A store is named by a string: `jsonl` (the journal of
// 4.1.9, beside config.json), `sqlite:<file>` (relative to the Bridge's directory) or `postgres://…`; `--store=` or
// the `BRIDGE_STORE` variable override the configuration's (a database URL with a password stays out of the file;
// `BRIDGE_STORE_FILE`, 4.1.18, reads it from a secret file).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  auditRestore,
  BackupError,
  MAX_BACKUP_BYTES,
  MAX_BACKUP_ROWS,
  makeBackup,
  readBackup,
  readBounded,
  restoreBackup,
  writeAtomic,
} from './backup';
import { inspectJournal, JsonlBridgeStore } from './store';
import { DEFAULT_TENANT, type RealityStore } from './store-async';
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
      console.error('usage: backup --out=<file> [--max-bytes=<n>] [--max-rows=<n>]');
      return 2;
    }
    const maxBytes = Number(opt(args, 'max-bytes') ?? MAX_BACKUP_BYTES);
    const maxRows = Number(opt(args, 'max-rows') ?? MAX_BACKUP_ROWS);
    const store = await openStore(spec, dir, file, { lock: false });
    try {
      // Schema 3 (4.1.19, ADR 0021): one snapshot of every family, its counts and digest in the envelope.
      const b = await makeBackup(store, { maxRows });
      const content = `${JSON.stringify(b)}\n`;
      const bytes = Buffer.byteLength(content);
      if (bytes > maxBytes) {
        console.error(
          `✖  the backup would be ${bytes} bytes, more than ${maxBytes} (--max-bytes=): no file written; use pg_dump or the provider's snapshots`,
        );
        return 1;
      }
      writeAtomic(resolve(out), content);
      const c = b.counts;
      say(
        `✔  ${c.tenants} tenant(s), ${c.signals} signal(s), ${c.runs} run(s), ${c.daily} daily record(s) backed up to ${resolve(out)} (schema 3, one snapshot, sha256 ${b.digest.value.slice(0, 12)}…)`,
      );
      return 0;
    } catch (e) {
      if (e instanceof BackupError) {
        console.error(`✖  ${e.message}: no file written`);
        return 1;
      }
      throw e;
    } finally {
      await store.close();
    }
  }
  if (cmd === 'restore') {
    const from = opt(args, 'from');
    if (!from) {
      console.error('usage: restore --from=<backup file> [--force] [--max-bytes=<n>]');
      return 2;
    }
    // Everything is read and checked before the store is opened: a file refused touches nothing.
    let read: ReturnType<typeof readBackup>;
    try {
      read = readBackup(readBounded(resolve(from), Number(opt(args, 'max-bytes') ?? MAX_BACKUP_BYTES)));
    } catch (e) {
      if (e instanceof BackupError) {
        console.error(`✖  ${e.message}: nothing restored`);
        return 1;
      }
      throw e;
    }
    if (normal(spec) === 'jsonl') {
      console.error(
        '✖  the JSON-lines journal cannot be restored all or nothing: migrate it to SQLite first (migrate --from=jsonl --to=sqlite), then restore with --store=sqlite; nothing restored',
      );
      return 1;
    }
    const store = await openStore(spec, dir, file);
    try {
      if (!(store instanceof SqlRealityStore)) {
        console.error('✖  restore needs a SQL store (--store=sqlite or postgres://…): nothing restored');
        return 1;
      }
      const at = await store.schemaVersion();
      if (read.storeSchema !== null && read.storeSchema > at) {
        console.error(
          `✖  the backup comes from a store at schema ${read.storeSchema}, newer than this one (${at}): upgrade the Bridge; nothing restored`,
        );
        return 1;
      }
      let outcome: Awaited<ReturnType<typeof restoreBackup>>;
      try {
        outcome = await restoreBackup(store, read.payload, { force: args.includes('--force') });
      } catch (e) {
        console.error(`✖  the restore failed and was rolled back, nothing restored: ${(e as Error).message}`);
        return 1;
      }
      if (!outcome.ok) {
        console.error(`✖  ${outcome.why}; nothing restored`);
        return 1;
      }
      // An audit after the commit: a difference here is the backend's fault, a P0, said as such.
      const wrong = await auditRestore(store, read.payload);
      if (wrong) {
        console.error(`✖  P0: the restore committed but ${wrong}; stop the Bridge and keep this store for inspection`);
        return 3;
      }
      say(
        `✔  ${outcome.tenants} tenant(s), ${outcome.runs} run(s), ${outcome.daily} daily record(s) restored from ${read.at} (schema ${read.schema}), checked before and after the commit`,
      );
      return 0;
    } finally {
      await store.close();
    }
  }
  return undefined;
}
