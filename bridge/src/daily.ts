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
// (memory here; the Bridge's own store backs it when the server mounts it).
import { createHmac, randomBytes } from 'node:crypto';
import { b64url } from '../../src/engine/reality/protocol';
import { encodeSeedCode, REMIX_ALGORITHM_VERSION, seedCommitment } from '../../src/engine/reality/daily';

/** What the daily routes keep: the day tokens issued, the Mystery seeds behind their commitments. */
export interface DailyStore {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
}

export class MemoryDailyStore implements DailyStore {
  private m = new Map<string, string>();
  get(key: string) {
    return this.m.get(key);
  }
  put(key: string, value: string) {
    if (!this.m.has(key)) this.m.set(key, value);
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
}

export interface DailyRequest {
  method: string;
  /** The path and query, e.g. `/v1/daily?game=reference`. */
  url: string;
  body?: unknown;
}
export interface DailyResponse {
  status: number;
  body: unknown;
}

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

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

  async function daily(gameId: string, date: string): Promise<DailyResponse> {
    const game = o.games[gameId];
    if (!game) return { status: 404, body: { error: 'unknown game' } };
    const t = now();
    const today = isoDay(t);
    // Today, or a past day (a replay of an old challenge); never a day not yet open.
    if (date > today) return { status: 403, body: { error: 'that day is not open yet' } };
    const k = `daily|${gameId}|${date}`;
    const kept = store.get(k);
    if (kept) return { status: 200, body: { token: kept } };
    const start = Date.parse(`${date}T00:00:00Z`);
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
    store.put(k, token);
    return { status: 200, body: { token: store.get(k) } };
  }

  async function commit(body: unknown): Promise<DailyResponse> {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const gameId = typeof b.game === 'string' ? b.game : '';
    const game = o.games[gameId];
    if (!game) return { status: 404, body: { error: 'unknown game' } };
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
    store.put(`commit|${id}`, JSON.stringify({ seed, nonce, gameId }));
    return { status: 201, body: { id, commitment, token } };
  }

  function reveal(id: string): DailyResponse {
    const kept = store.get(`commit|${id}`);
    if (!kept) return { status: 404, body: { error: 'unknown commitment' } };
    const { seed, nonce } = JSON.parse(kept) as { seed: string; nonce: string };
    return { status: 200, body: { id, seed, nonce } };
  }

  return {
    async handle(req: DailyRequest): Promise<DailyResponse | null> {
      const u = new URL(req.url, 'http://bridge.local');
      if (req.method === 'GET' && u.pathname === '/v1/daily')
        return daily(u.searchParams.get('game') ?? '', u.searchParams.get('date') ?? isoDay(now()));
      if (req.method === 'POST' && u.pathname === '/v1/commit') return commit(req.body);
      const m = /^\/v1\/reveal\/([\w-]{1,64})$/.exec(u.pathname);
      if (req.method === 'GET' && m) return reveal(m[1]!);
      return null;
    },
  };
}
