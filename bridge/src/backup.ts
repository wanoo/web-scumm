// The Bridge's backup and restore (4.1.19, ADR 0021): a backup is one logical snapshot of the whole store, described
// by its envelope (schema 3: backend, Bridge and SQL schema versions, start and end, counts per family, a SHA-256 of
// the canonical payload), written to a private temporary file then renamed; a restore reads a bounded file, validates
// every row before the first write, and writes tenants, runs and daily records in one SQL transaction whose result is
// compared with the file before it commits. A restore that fails changes nothing. The JSON-lines journal is refused
// before anything is touched (it has no transaction to restore into): migrate it to SQLite first.
// This is an operator's capability of the SQL stores, not of `RealityStore`: the runtime never restores.
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod/mini';
import type { RealityStore, TenantExport } from './store-async';
import { checkTenant } from './store-async';
import { exportTenantIn, importTenantIn, type Row, type SqlQuery, SqlRealityStore } from './store-sql';

const BACKUP_FORMAT = 'web-scumm-bridge-backup';
/** The largest backup file written or read by default (`--max-bytes=` changes it): 256 MiB. */
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
/** The most rows a backup loads in memory by default (`--max-rows=`): counted inside the snapshot, before reading it. */
export const MAX_BACKUP_ROWS = 2_000_000;

/**
 * The columns of `runs` and `daily_kv` a backup carries, in their canonical order (bridge/migrations/0002.up.sql). A
 * restore names only these, whatever the file says; `tests/bridge-backup.test.ts` compares them with the schema.
 */
export const RUN_COLUMNS = [
  'tenant_id',
  'id',
  'game_id',
  'category_id',
  'player',
  'submitted_at',
  'status',
  'verdict',
  'code',
  'reason',
  'trust',
  'ranked',
  'seed_kind',
  'world_hash',
  'world_mode',
  'world_seed',
  'leaderboard_key',
  'run_key',
  'delete_token_hash',
  'envelope',
  'lease_owner',
  'lease_until',
] as const;
export const DAILY_COLUMNS = ['k', 'v', 'created_at'] as const;

export interface BackupPayload {
  tenants: TenantExport[];
  runs: Row[];
  daily: Row[];
}
interface BackupCounts {
  tenants: number;
  players: number;
  signals: number;
  acks: number;
  revokedTokens: number;
  keys: number;
  quarantine: number;
  pairings: number;
  runs: number;
  daily: number;
}
export interface BackupV3 {
  format: typeof BACKUP_FORMAT;
  schema: 3;
  bridge: { version: string };
  store: { kind: RealityStore['kind']; schema: number | null };
  startedAt: string;
  endedAt: string;
  counts: BackupCounts;
  payload: BackupPayload;
  digest: { alg: 'sha256'; value: string };
}

/** A backup that cannot be made or read as it should: said to the operator, nothing written. */
export class BackupError extends Error {}

// ─── Canonical text and digest ────────────────────────────────────────────────────────────────────────────────────

/** JSON with keys sorted at every depth, `undefined` left out: the text a digest is taken of. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}
/** The SHA-256 of a payload's canonical text; the envelope's digest, which never covers itself. */
export const payloadDigest = (p: BackupPayload): string => createHash('sha256').update(stableJson(p)).digest('hex');

function countsOf(p: BackupPayload): BackupCounts {
  const sum = (f: (t: TenantExport) => number) => p.tenants.reduce((n, t) => n + f(t), 0);
  return {
    tenants: p.tenants.length,
    players: sum((t) => t.players.length),
    signals: sum((t) => t.signals.length),
    acks: sum((t) => t.acks.length),
    revokedTokens: sum((t) => t.revokedTokens.length),
    keys: sum((t) => t.keys.length),
    quarantine: sum((t) => t.quarantine.length),
    pairings: sum((t) => t.pairings?.length ?? 0),
    runs: p.runs.length,
    daily: p.daily.length,
  };
}

// ─── The file's shape ─────────────────────────────────────────────────────────────────────────────────────────────

const ident = z.string().check(z.minLength(1), z.maxLength(256));
const text = (max: number) => z.string().check(z.maxLength(max));
const count = z.int().check(z.nonnegative());
const many = <T extends z.ZodMiniType>(t: T, max = MAX_BACKUP_ROWS) => z.array(t).check(z.maxLength(max));
/** A BIGINT: a number from SQLite, a decimal string from Postgres' driver. Read as a safe integer. */
const bigint = z.pipe(
  z.union([count, z.string().check(z.regex(/^\d{1,15}$/))]),
  z.transform((v) => Number(v)),
);
const nullable = <T extends z.ZodMiniType>(t: T) => z.optional(z.nullable(t));

const PlayerSchema = z.strictObject({
  playerId: ident,
  gameId: ident,
  capabilityHash: text(256),
  capabilityExpiresAt: count,
  issuedAt: z.optional(count),
  revoked: z.optional(z.boolean()),
  sessionId: z.optional(ident),
  origin: z.optional(text(2048)),
});
const SignalSchema = z.strictObject({
  tenantId: ident,
  playerId: ident,
  sequence: count,
  id: ident,
  dedupeKey: text(512),
  jws: text(1 << 20),
  at: count,
  kid: z.optional(ident),
  payload: z.optional(z.record(z.string(), z.unknown())),
});
const KeySchema = z.strictObject({
  tenantId: ident,
  keyId: ident,
  publicKey: text(4096),
  retireAfter: z.optional(text(64)),
});
const QuarantineSchema = z.strictObject({
  tenantId: ident,
  playerId: ident,
  sequence: count,
  reason: text(4096),
  at: count,
});
const PairingSchema = z.strictObject({
  code: ident,
  gameId: ident,
  expiresAt: count,
  playerId: z.optional(ident),
  claimed: z.optional(z.boolean()),
  origin: z.optional(text(2048)),
  /** A journal's pairing could carry the capability it hands out once (schema 1): read, then dropped. */
  capability: z.optional(text(4096)),
});
const TenantSchema = z.strictObject({
  tenantId: ident,
  players: many(PlayerSchema),
  signals: many(SignalSchema),
  acks: many(z.strictObject({ playerId: ident, through: count })),
  revokedTokens: many(ident),
  keys: many(KeySchema),
  quarantine: many(QuarantineSchema),
  pairings: z.optional(many(PairingSchema)),
});
const RunSchema = z.strictObject({
  tenant_id: ident,
  id: ident,
  game_id: ident,
  category_id: ident,
  player: text(256),
  submitted_at: bigint,
  status: text(64),
  verdict: nullable(text(64)),
  code: nullable(text(256)),
  reason: nullable(text(8192)),
  trust: text(64),
  ranked: nullable(text(64)),
  seed_kind: nullable(text(64)),
  world_hash: nullable(text(256)),
  world_mode: nullable(text(64)),
  world_seed: nullable(text(1024)),
  leaderboard_key: nullable(text(1024)),
  run_key: text(512),
  delete_token_hash: text(256),
  envelope: text(8 << 20),
  lease_owner: nullable(text(256)),
  lease_until: nullable(bigint),
});
const DailySchema = z.strictObject({ k: text(1024).check(z.minLength(1)), v: text(1 << 20), created_at: bigint });

const LegacySchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  schema: z.union([z.literal(1), z.literal(2)]),
  at: text(64),
  tenants: many(TenantSchema, 100_000),
  runs: z.optional(many(RunSchema)),
  daily: z.optional(many(DailySchema)),
});
const CountsSchema = z.strictObject({
  tenants: count,
  players: count,
  signals: count,
  acks: count,
  revokedTokens: count,
  keys: count,
  quarantine: count,
  pairings: count,
  runs: count,
  daily: count,
});
const V3Schema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  schema: z.literal(3),
  bridge: z.strictObject({ version: text(64) }),
  store: z.strictObject({
    kind: z.enum(['memory', 'jsonl', 'sqlite', 'postgres']),
    schema: z.nullable(count),
  }),
  startedAt: text(64),
  endedAt: text(64),
  counts: CountsSchema,
  payload: z.strictObject({
    tenants: many(TenantSchema, 100_000),
    runs: many(RunSchema),
    daily: many(DailySchema),
  }),
  digest: z.strictObject({ alg: z.literal('sha256'), value: z.string().check(z.regex(/^[0-9a-f]{64}$/)) }),
});

/** A backup read and checked: its payload (rows normalised), the schema it was written in and when. */
export interface ReadBackup {
  schema: 1 | 2 | 3;
  at: string;
  storeSchema: number | null;
  payload: BackupPayload;
}

/** The first issues of a parse, path and message, for the operator. */
function issues(e: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string {
  return e.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Parses and checks a backup's text: its shape (every row of every family, unknown fields refused), then what the
 * rows say of each other (duplicates, a run of a tenant the file does not carry, an acknowledgement of a player it does
 * not hold), then, for schema 3, its counts and its digest. Throws `BackupError` saying the first problems found.
 */
export function readBackup(textIn: string): ReadBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(textIn);
  } catch (e) {
    throw new BackupError(`not JSON: ${(e as Error).message}`);
  }
  const schema = (raw as { schema?: unknown } | null)?.schema;
  if ((raw as { format?: unknown } | null)?.format !== BACKUP_FORMAT || ![1, 2, 3].includes(schema as number))
    throw new BackupError('not a Bridge backup of schema 1, 2 or 3');
  let out: ReadBackup;
  if (schema === 3) {
    const r = V3Schema.safeParse(raw);
    if (!r.success) throw new BackupError(`schema 3 refused: ${issues(r.error)}`);
    const payload = r.data.payload as BackupPayload;
    if (payloadDigest(payload) !== r.data.digest.value)
      throw new BackupError('the payload does not match its digest: the file was changed or truncated');
    if (stableJson(countsOf(payload)) !== stableJson(r.data.counts))
      throw new BackupError('the counts do not match the payload');
    out = { schema: 3, at: r.data.startedAt, storeSchema: r.data.store.schema, payload };
  } else {
    const r = LegacySchema.safeParse(raw);
    if (!r.success) throw new BackupError(`schema ${String(schema)} refused: ${issues(r.error)}`);
    out = {
      schema: r.data.schema,
      at: r.data.at,
      storeSchema: null,
      payload: { tenants: r.data.tenants as TenantExport[], runs: r.data.runs ?? [], daily: r.data.daily ?? [] },
    };
  }
  out.payload.tenants = out.payload.tenants.map(withoutCapabilities);
  const why = relations(out.payload, out.schema === 3);
  if (why) throw new BackupError(why);
  return out;
}

/** What the rows say of each other; undefined when they agree. */
function relations(p: BackupPayload, strictRuns: boolean): string | undefined {
  const dup = <T>(xs: T[], key: (x: T) => string): string | undefined => {
    const seen = new Set<string>();
    for (const x of xs) {
      const k = key(x);
      if (seen.has(k)) return k;
      seen.add(k);
    }
    return undefined;
  };
  const tenants = new Set<string>();
  for (const t of p.tenants) {
    try {
      checkTenant(t.tenantId);
    } catch {
      return `tenant "${t.tenantId.slice(0, 64)}" is not a tenant id`;
    }
    if (tenants.has(t.tenantId)) return `tenant ${t.tenantId} appears twice`;
    tenants.add(t.tenantId);
    const at = `tenant ${t.tenantId}`;
    const d =
      (dup(t.players, (x) => x.playerId) && `${at}: a player appears twice`) ||
      (dup(t.signals, (x) => `${x.playerId}\u0000${x.sequence}`) && `${at}: a signal's sequence appears twice`) ||
      (dup(t.signals, (x) => `${x.playerId}\u0000${x.dedupeKey}`) && `${at}: a signal's dedupe key appears twice`) ||
      (dup(t.acks, (x) => x.playerId) && `${at}: an acknowledgement appears twice`) ||
      (dup(t.revokedTokens, (x) => x) && `${at}: a revoked token appears twice`) ||
      (dup(t.keys, (x) => x.keyId) && `${at}: a key appears twice`) ||
      (dup(t.quarantine, (x) => `${x.playerId}\u0000${x.sequence}`) && `${at}: a quarantined row appears twice`) ||
      (dup(t.pairings ?? [], (x) => x.code) && `${at}: a pairing code appears twice`);
    if (d) return d;
    const players = new Set(t.players.map((x) => x.playerId));
    if (t.acks.some((a) => !players.has(a.playerId)))
      return `${at}: an acknowledgement names a player it does not hold`;
    for (const rows of [t.signals, t.keys, t.quarantine] as { tenantId: string }[][])
      if (rows.some((r) => r.tenantId !== t.tenantId)) return `${at}: a row belongs to another tenant`;
  }
  const run =
    (dup(p.runs, (r) => `${String(r.tenant_id)}\u0000${String(r.id)}`) && 'a run appears twice') ||
    (dup(p.runs, (r) => `${String(r.tenant_id)}\u0000${String(r.run_key)}`) && "a run's key appears twice") ||
    (dup(p.daily, (r) => String(r.k)) && 'a daily record appears twice');
  if (run) return run;
  if (strictRuns) {
    const stray = p.runs.find((r) => !tenants.has(String(r.tenant_id)));
    if (stray) return `a run belongs to tenant ${String(stray.tenant_id)}, which the backup does not carry`;
  }
  return undefined;
}

/** A tenant without the capabilities a journal's pairings may hold in clear: a backup carries hashes only. */
function withoutCapabilities(t: TenantExport): TenantExport {
  if (!t.pairings?.some((p) => p.capability !== undefined)) return t;
  return { ...t, pairings: t.pairings.map(({ capability: _, ...p }) => p) };
}

// ─── Bounded files ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Reads a backup file without trusting it: a link or anything but a regular file refused, its size checked before a
 * byte is read, at most `max + 1` bytes read, and a file that changed size while read refused.
 */
export function readBounded(path: string, max: number): string {
  const l = lstatSync(path, { throwIfNoEntry: false });
  if (!l) throw new BackupError(`${path} does not exist`);
  if (l.isSymbolicLink() || !l.isFile()) throw new BackupError(`${path} is not a regular file`);
  const fd = openSync(path, 'r');
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new BackupError(`${path} is not a regular file`);
    if (st.size > max) throw new BackupError(`${path} holds ${st.size} bytes, more than ${max} (--max-bytes=)`);
    const buf = Buffer.alloc(st.size + 1);
    let got = 0;
    for (;;) {
      const n = readSync(fd, buf, got, buf.length - got, got);
      if (n === 0) break;
      got += n;
      if (got === buf.length) break;
    }
    if (got !== st.size) throw new BackupError(`${path} changed while it was read`);
    return buf.subarray(0, got).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Writes a file of mode 600 the way a backup must be: a private temporary file beside it, written, flushed, closed,
 * renamed over the target, then the folder flushed where the system allows. An interruption leaves the old file or
 * the new one, never half of one.
 */
export function writeAtomic(path: string, content: string): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    const buf = Buffer.from(content, 'utf8');
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    unlinkSync(tmp);
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (e) {
    unlinkSync(tmp);
    throw e;
  }
  try {
    const dir = openSync(dirname(path), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    /* a folder cannot be flushed on every system (Windows): the rename is what makes it whole */
  }
}

/** This Bridge's version: its package's (the packed web-scumm-bridge), else the repository's. */
function bridgeVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    const f = new URL(rel, import.meta.url);
    if (!existsSync(f)) continue;
    try {
      const pkg = JSON.parse(readFileSync(f, 'utf8')) as { name?: string; version?: string };
      if ((pkg.name === 'web-scumm-bridge' || pkg.name === 'web-scumm') && pkg.version) return pkg.version;
    } catch {
      /* not this one */
    }
  }
  return 'unknown';
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────────────────────────────────────────

const TENANTS_SQL =
  'SELECT tenant_id FROM players UNION SELECT tenant_id FROM signals UNION SELECT tenant_id FROM signing_keys UNION SELECT tenant_id FROM revoked_tokens UNION SELECT tenant_id FROM pairings UNION SELECT tenant_id FROM quarantine UNION SELECT tenant_id FROM runs';
const COUNTED = ['players', 'signals', 'signing_keys', 'revoked_tokens', 'pairings', 'quarantine', 'runs', 'daily_kv'];

/** A run or daily row with every column of the canonical list, in its order, BIGINTs as numbers. */
function normalRow(r: Row, cols: readonly string[]): Row {
  const out: Row = {};
  for (const c of cols) {
    const v = r[c];
    out[c] = v === undefined ? null : typeof v === 'bigint' || (typeof v === 'string' && isBig(c)) ? Number(v) : v;
  }
  return out;
}
const isBig = (c: string) => c === 'submitted_at' || c === 'lease_until' || c === 'created_at';

/**
 * Every family of a SQL store read in one read-only transaction (Postgres: REPEATABLE READ READ ONLY; SQLite in WAL:
 * the snapshot of the transaction's first read): tenants, runs and daily records are one instant. The rows are
 * counted first, inside the same snapshot, and a store above `maxRows` is refused before it is loaded.
 */
async function sqlSnapshot(
  store: SqlRealityStore,
  maxRows: number,
): Promise<{ payload: BackupPayload; schema: number }> {
  return store.db.tx(
    undefined,
    async (q) => {
      let rows = 0;
      for (const t of COUNTED) rows += Number((await q.all(`SELECT COUNT(*) AS n FROM ${t}`))[0]?.n ?? 0);
      if (rows > maxRows)
        throw new BackupError(
          `the store holds ${rows} rows, more than ${maxRows} (--max-rows=); use pg_dump or the provider's snapshots`,
        );
      const [v] = await q.all('SELECT MAX(version) AS v FROM schema_migrations');
      const ids = (await q.all(TENANTS_SQL)).map((r) => String(r.tenant_id)).sort();
      const tenants: TenantExport[] = [];
      for (const id of ids) tenants.push(await exportTenantIn(q, id));
      const runs = (await q.all(`SELECT ${RUN_COLUMNS.join(', ')} FROM runs ORDER BY tenant_id, id`)).map((r) =>
        normalRow(r, RUN_COLUMNS),
      );
      const daily = (await q.all(`SELECT ${DAILY_COLUMNS.join(', ')} FROM daily_kv ORDER BY k`)).map((r) =>
        normalRow(r, DAILY_COLUMNS),
      );
      return { payload: { tenants, runs, daily }, schema: Number(v?.v ?? 0) };
    },
    { readOnly: true },
  );
}

/** A backup of the whole store (schema 3). The journal holds one tenant read at once: its export is one instant. */
export async function makeBackup(store: RealityStore, o: { maxRows?: number } = {}): Promise<BackupV3> {
  const startedAt = new Date().toISOString();
  let payload: BackupPayload;
  let schema: number | null = null;
  if (store instanceof SqlRealityStore) ({ payload, schema } = await sqlSnapshot(store, o.maxRows ?? MAX_BACKUP_ROWS));
  else {
    const tenants: TenantExport[] = [];
    for (const t of await store.tenants()) tenants.push(withoutCapabilities(await store.exportTenant(t)));
    payload = { tenants, runs: [], daily: [] };
  }
  return {
    format: BACKUP_FORMAT,
    schema: 3,
    bridge: { version: bridgeVersion() },
    store: { kind: store.kind, schema },
    startedAt,
    endedAt: new Date().toISOString(),
    counts: countsOf(payload),
    payload,
    digest: { alg: 'sha256', value: payloadDigest(payload) },
  };
}

// ─── Restore ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A tenant as an export reads it back: what a restore must find in the store before it commits. */
function normalTenant(x: TenantExport): TenantExport {
  const by = <T>(xs: T[], key: (x: T) => string) =>
    [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const seq = (n: number) => String(n).padStart(16, '0');
  return {
    tenantId: x.tenantId,
    players: by(x.players, (p) => p.playerId).map((p) => ({ ...p, ...(p.revoked ? {} : { revoked: undefined }) })),
    signals: by(x.signals, (s) => `${s.playerId}\u0000${seq(s.sequence)}`).map((s) => ({ ...s, tenantId: x.tenantId })),
    acks: by(
      x.acks.filter((a) => a.through > 0),
      (a) => a.playerId,
    ),
    revokedTokens: [...x.revokedTokens].sort(),
    keys: by(x.keys, (k) => k.keyId).map((k) => ({ ...k, tenantId: x.tenantId })),
    quarantine: by(x.quarantine, (r) => `${r.playerId}\u0000${seq(r.sequence)}`).map((r) => ({
      ...r,
      tenantId: x.tenantId,
    })),
    pairings: by(x.pairings ?? [], (p) => p.code).map((p) => ({ ...p, ...(p.claimed ? {} : { claimed: undefined }) })),
  };
}

export type RestoreOutcome = { ok: true; tenants: number; runs: number; daily: number } | { ok: false; why: string };

/** Raised inside the transaction when the store does not read back what was written: the transaction rolls back. */
class RestoreMismatch extends Error {}

/**
 * Restores a checked payload into a SQL store, all or nothing, in one transaction:
 * 1. without `force`, every conflict (a tenant, a run of its tenants, a daily key already held) is found before the
 *    first write, and the restore is refused;
 * 2. with `force`, the tenants, their runs and the daily keys are deleted and written again inside the transaction;
 * 3. before the commit, each tenant is exported again and compared with the file, and the runs and daily records are
 *    counted and read back: a difference rolls everything back.
 */
export async function restoreBackup(
  store: SqlRealityStore,
  p: BackupPayload,
  o: { force: boolean },
): Promise<RestoreOutcome> {
  const tenantIds = p.tenants.map((t) => t.tenantId);
  const runTenants = [...new Set([...tenantIds, ...p.runs.map((r) => String(r.tenant_id))])].sort();
  const dailyKeys = p.daily.map((r) => String(r.k));
  const marks = (xs: unknown[], from = 1) => xs.map((_, i) => `$${i + from}`).join(', ');
  try {
    return await store.db.tx('backup:restore', async (q: SqlQuery): Promise<RestoreOutcome> => {
      const held = new Set((await q.all(TENANTS_SQL)).map((r) => String(r.tenant_id)));
      const clash = tenantIds.filter((t) => held.has(t));
      const heldRuns = runTenants.length
        ? Number(
            (await q.all(`SELECT COUNT(*) AS n FROM runs WHERE tenant_id IN (${marks(runTenants)})`, runTenants))[0]
              ?.n ?? 0,
          )
        : 0;
      const heldDaily: string[] = [];
      for (let i = 0; i < dailyKeys.length; i += 500) {
        const part = dailyKeys.slice(i, i + 500);
        for (const r of await q.all(`SELECT k FROM daily_kv WHERE k IN (${marks(part)})`, part))
          heldDaily.push(String(r.k));
      }
      if (!o.force && (clash.length || heldRuns || heldDaily.length))
        return {
          ok: false,
          why: `the store already holds ${[
            clash.length ? `tenant(s) ${clash.join(', ')}` : '',
            heldRuns ? `${heldRuns} run(s) of these tenants` : '',
            heldDaily.length ? `${heldDaily.length} daily record(s)` : '',
          ]
            .filter(Boolean)
            .join(', ')}: restore into an empty store, or --force`,
        };
      for (const t of p.tenants) await importTenantIn(q, t, clash.includes(t.tenantId));
      if (o.force && runTenants.length)
        await q.run(`DELETE FROM runs WHERE tenant_id IN (${marks(runTenants)})`, runTenants);
      if (o.force)
        for (let i = 0; i < heldDaily.length; i += 500) {
          const part = heldDaily.slice(i, i + 500);
          await q.run(`DELETE FROM daily_kv WHERE k IN (${marks(part)})`, part);
        }
      // The columns are this file's list, never the backup's keys: nothing the file says is spliced into a statement.
      const insert = (table: string, cols: readonly string[]) =>
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${marks([...cols])})`;
      for (const r of p.runs)
        await q.run(
          insert('runs', RUN_COLUMNS),
          RUN_COLUMNS.map((c) => normalRow(r, RUN_COLUMNS)[c]),
        );
      for (const r of p.daily)
        await q.run(
          insert('daily_kv', DAILY_COLUMNS),
          DAILY_COLUMNS.map((c) => normalRow(r, DAILY_COLUMNS)[c]),
        );
      // Read back before the commit: what decides success is checked while it can still be undone.
      for (const t of p.tenants)
        if (stableJson(await exportTenantIn(q, t.tenantId)) !== stableJson(normalTenant(t)))
          throw new RestoreMismatch(`tenant ${t.tenantId} does not read back as the backup holds it`);
      if (runTenants.length) {
        const back = (
          await q.all(
            `SELECT ${RUN_COLUMNS.join(', ')} FROM runs WHERE tenant_id IN (${marks(runTenants)}) ORDER BY tenant_id, id`,
            runTenants,
          )
        ).map((r) => normalRow(r, RUN_COLUMNS));
        const want = p.runs
          .map((r) => normalRow(r, RUN_COLUMNS))
          .sort((a, b) => {
            const x = `${String(a.tenant_id)}\u0000${String(a.id)}`;
            const y = `${String(b.tenant_id)}\u0000${String(b.id)}`;
            return x < y ? -1 : x > y ? 1 : 0;
          });
        if (back.length !== want.length || stableJson(back) !== stableJson(want))
          throw new RestoreMismatch('the runs do not read back as the backup holds them');
      }
      for (const r of p.daily) {
        const [b] = await q.all(`SELECT ${DAILY_COLUMNS.join(', ')} FROM daily_kv WHERE k = $1`, [r.k]);
        if (!b || stableJson(normalRow(b, DAILY_COLUMNS)) !== stableJson(normalRow(r, DAILY_COLUMNS)))
          throw new RestoreMismatch(`the daily record ${String(r.k)} does not read back as the backup holds it`);
      }
      return { ok: true, tenants: p.tenants.length, runs: p.runs.length, daily: p.daily.length };
    });
  } catch (e) {
    if (e instanceof RestoreMismatch) return { ok: false, why: e.message };
    throw e;
  }
}

/**
 * After the commit, a separate health reading (an audit, not the condition of success): each restored tenant's export
 * and the runs and daily records counted again. A difference here is a fault of the backend, a P0.
 */
export async function auditRestore(store: SqlRealityStore, p: BackupPayload): Promise<string | undefined> {
  return store.db.tx(
    undefined,
    async (q) => {
      for (const t of p.tenants)
        if (stableJson(await exportTenantIn(q, t.tenantId)) !== stableJson(normalTenant(t)))
          return `tenant ${t.tenantId} differs after the commit`;
      for (const r of p.daily)
        if (!(await q.all('SELECT k FROM daily_kv WHERE k = $1', [r.k])).length)
          return `the daily record ${String(r.k)} is missing after the commit`;
      const ids = [...new Set(p.runs.map((r) => String(r.tenant_id)))];
      let n = 0;
      for (const id of ids)
        n += Number((await q.all('SELECT COUNT(*) AS n FROM runs WHERE tenant_id = $1', [id]))[0]?.n ?? 0);
      if (n !== p.runs.length) return `${n} run(s) found after the commit, ${p.runs.length} restored`;
      return undefined;
    },
    { readOnly: true },
  );
}
