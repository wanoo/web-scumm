// The Bridge's daily challenge and Mystery seeds (4.1.15, D26, docs/dev/threat-models/remix-seed.md): a new module the
// HTTP server mounts beside its routes (`dailyRoutes(...).handle`); it reads no player data and takes no action.
//   GET  /v1/daily?game=<id>[&date=YYYY-MM-DD]  the day's seed and rules, signed (EdDSA), valid 24 hours, verifiable
//                                              offline with the key the game's manifest names (`remix.daily`).
//   POST /v1/commit {game, mode}                a fresh Mystery seed, drawn here and kept; only its commitment
//                                              (SHA-256 of seed and nonce) is returned, signed, before the run starts.
//   GET  /v1/reveal/:id                         the seed and the nonce of a commitment, the same every time.
// The Bridge never chooses a seed after seeing a player's actions: a day's seed is a function of the day alone (an
// HMAC under the Bridge's secret, stored on first issue and never changed), a Mystery seed is fixed when its commitment
// is signed, and no route of this module reads an action, a journal or a player. Written against a small `DailyStore`
// (memory for tests; `SqlDailyStore` over the Bridge's own SQLite or Postgres when the server mounts it, 4.1.16: every
// write is "insert if absent", so two instances issue one token per day and one record per commitment).
// 4.1.16: a date is a real UTC day (`YYYY-MM-DD`), today or within `retentionDays`; a game id is one of `games`' own;
// a reveal is signed; the commits counted per client are forgotten after their hour.
import { createHmac, randomBytes } from 'node:crypto';
import type { SqlDb } from './store-sql';
import { b64url } from '../../src/engine/reality/protocol';
import { encodeSeedCode, REMIX_ALGORITHM_VERSION, seedCommitment } from '../../src/engine/reality/daily';

/** What the daily routes keep: the day tokens issued, the Mystery seeds behind their commitments, written once. */
export interface DailyStore {
  get(key: string): Promise<string | undefined>;
  /** Writes `value` unless the key has one; returns the value the key holds afterwards (the first writer's). */
  putIfAbsent(key: string, value: string): Promise<string>;
}

export class MemoryDailyStore implements DailyStore {
  private m = new Map<string, string>();
  async get(key: string) {
    return this.m.get(key);
  }
  async putIfAbsent(key: string, value: string) {
    if (!this.m.has(key)) this.m.set(key, value);
    return this.m.get(key)!;
  }
}

/** The daily records in SQL (bridge/migrations/0002, `daily_kv`), over the Reality store's database. */
export class SqlDailyStore implements DailyStore {
  constructor(
    readonly db: SqlDb,
    private now: () => number = Date.now,
  ) {}
  async get(key: string) {
    const [r] = await this.db.all('SELECT v FROM daily_kv WHERE k = $1', [key]);
    return r ? String(r.v) : undefined;
  }
  async putIfAbsent(key: string, value: string) {
    await this.db.run('INSERT INTO daily_kv (k, v, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      key,
      value,
      this.now(),
    ]);
    return (await this.get(key)) ?? value;
  }
}

export interface DailyOptions {
  /** The games this Bridge serves, with the Remix mode their daily challenge and their Mystery runs use. */
  games: Record<string, { daily: string; mystery?: string }>;
  /** The Ed25519 private key and its id (the public half is in each game's manifest, `remix.daily`). */
  key: CryptoKey;
  kid: string;
  /** The secret the days' seeds are derived from (never sent). */
  secret: string;
  store?: DailyStore;
  now?: () => number;
  /** Mystery commits one client may ask per game and per hour (default 3): shopping for a seed costs that much. */
  commitsPerHour?: number;
  /** How many past days a challenge can be asked for (default 30): older ones are refused, the store stays bounded. */
  retentionDays?: number;
}

export interface DailyRequest {
  method: string;
  /** The path and query, e.g. `/v1/daily?game=reference`. */
  url: string;
  body?: unknown;
  /** Who asks (the server passes the client's address): Mystery commits are counted per client. */
  client?: string;
}
export interface DailyResponse {
  status: number;
  body: unknown;
}

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** A real UTC day written `YYYY-MM-DD` (not `2026-02-30`, not an empty string): its midnight, or null. */
function dayStart(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && isoDay(t) === date ? t : null;
}

async function sign(payload: unknown, key: CryptoKey, kid: string): Promise<string> {
  const enc = (o: unknown) => b64url.encode(new TextEncoder().encode(JSON.stringify(o)));
  const h = enc({ alg: 'EdDSA', kid });
  const p = enc(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url.encode(sig)}`;
}

/** The seed of a day: an HMAC of the game and the day under the Bridge's secret, as a seed code. */
export function daySeed(secret: string, gameId: string, date: string): string {
  const d = createHmac('sha256', secret).update(`web-scumm-daily|${gameId}|${date}`).digest();
  return encodeSeedCode(d.readUInt32BE(0) * 8 + (d[4]! % 8));
}

export function dailyRoutes(o: DailyOptions) {
  const store = o.store ?? new MemoryDailyStore();
  const now = o.now ?? Date.now;

  const gameOf = (id: string) => (Object.hasOwn(o.games, id) ? o.games[id] : undefined);

  async function daily(gameId: string, date: string): Promise<DailyResponse> {
    const game = gameOf(gameId);
    if (!game) return { status: 404, body: { error: 'unknown game' } };
    const start = dayStart(date);
    if (start === null) return { status: 400, body: { error: 'a date is YYYY-MM-DD, a real day' } };
    const t = now();
    const today = isoDay(t);
    // Today, or a past day within the retention (a replay of an old challenge); never a day not yet open.
    if (date > today) return { status: 403, body: { error: 'that day is not open yet' } };
    if (start < Date.parse(`${today}T00:00:00Z`) - (o.retentionDays ?? 30) * DAY)
      return { status: 410, body: { error: 'that day is older than this Bridge keeps' } };
    const k = `daily|${gameId}|${date}`;
    const kept = await store.get(k);
    if (kept) return { status: 200, body: { token: kept } };
    const token = await sign(
      {
        format: 'web-scumm-daily',
        v: 1,
        gameId,
        date,
        seed: daySeed(o.secret, gameId, date),
        mode: game.daily,
        rules: { category: 'daily', algorithmVersion: REMIX_ALGORITHM_VERSION },
        notBefore: start,
        notAfter: start + DAY,
      },
      o.key,
      o.kid,
    );
    // Two instances signing the same day at once: the first token stored is the day's, for both.
    return { status: 200, body: { token: await store.putIfAbsent(k, token) } };
  }

  const commits = new Map<string, number[]>();
  async function commit(body: unknown, client = 'anonymous'): Promise<DailyResponse> {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const gameId = typeof b.game === 'string' ? b.game : '';
    const game = gameOf(gameId);
    if (!game) return { status: 404, body: { error: 'unknown game' } };
    // Shopping for a Mystery seed (commit, reveal, look, commit again) is bounded: so many commits per client and hour.
    const t = now();
    const k = `${client}|${gameId}`;
    const recent = (commits.get(k) ?? []).filter((x) => t - x < 3_600_000);
    // The table forgets clients whose hour is over once it grows (a flood of addresses does not keep it).
    if (commits.size > 10_000)
      for (const [c, xs] of commits) if (xs.every((x) => t - x >= 3_600_000)) commits.delete(c);
    if (recent.length >= (o.commitsPerHour ?? 3))
      return { status: 429, body: { error: 'too many Mystery seeds this hour' } };
    commits.set(k, [...recent, t]);
    const mode = game.mystery ?? game.daily;
    // Drawn here, before anything of the run exists; the body names the game, nothing else is read.
    const r = randomBytes(5);
    const seed = encodeSeedCode(r.readUInt32BE(0) * 8 + (r[4]! % 8));
    const nonce = b64url.encode(randomBytes(16));
    const id = b64url.encode(randomBytes(12));
    const commitment = seedCommitment(seed, nonce);
    const token = await sign(
      { format: 'web-scumm-commit', v: 1, id, gameId, mode, commitment, issuedAt: now() },
      o.key,
      o.kid,
    );
    await store.putIfAbsent(`commit|${id}`, JSON.stringify({ seed, nonce, gameId, mode, commitment }));
    return { status: 201, body: { id, commitment, token } };
  }

  async function reveal(id: string): Promise<DailyResponse> {
    const kept = await store.get(`commit|${id}`);
    if (!kept) return { status: 404, body: { error: 'unknown commitment' } };
    const { seed, nonce, gameId, mode, commitment } = JSON.parse(kept) as Record<string, string>;
    // The first reveal is recorded (a Mystery run must start within a minute of it: `worldVerdict`), once for every
    // instance: the first time stored is the reveal's.
    const revealedAt = Number(await store.putIfAbsent(`revealed|${id}`, String(now())));
    // Signed since 4.1.16: the time of the reveal is the Bridge's word, so a run's world evidence can carry it.
    const token = await sign(
      { format: 'web-scumm-reveal', v: 1, id, gameId, mode, commitment, seed, nonce, revealedAt },
      o.key,
      o.kid,
    );
    return { status: 200, body: { id, seed, nonce, revealedAt, token } };
  }

  return {
    async handle(req: DailyRequest): Promise<DailyResponse | null> {
      const u = new URL(req.url, 'http://bridge.local');
      if (req.method === 'GET' && u.pathname === '/v1/daily')
        return daily(u.searchParams.get('game') ?? '', u.searchParams.get('date') ?? isoDay(now()));
      if (req.method === 'POST' && u.pathname === '/v1/commit') return commit(req.body, req.client);
      const m = /^\/v1\/reveal\/([\w-]{1,64})$/.exec(u.pathname);
      if (req.method === 'GET' && m) return reveal(m[1]!);
      return null;
    },
  };
}
