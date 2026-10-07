// Speedrun leaderboards on the Bridge (4.1.14 "Time Attack", ADR 0017): `POST /v1/runs` takes a run's `.wsrun`, a queue
// hands it to an ISOLATED worker (a separate process: a bounded heap, killed at its time budget, an environment with no
// secret of the Bridge, no network, the game package approved by its fingerprint), and the worker's verdict, checked by
// the HMAC of a one-time key, is stored with the run. The HTTP process never replays a run and never trusts the
// client's word: a run's trust is `local` until the worker says `replay-valid`, and only an admin raises it to
// `moderator-verified`. Leaderboards are per tenant, game and category, separated by fixed and random seeds, ranked on
// valid runs only, shown with a pseudonym (never an email) and the trust level. Runs are kept 90 days by default and
// deleted on request with the token given at submission.
//
// A new module beside the 4.1.10 Bridge: it reads its own `RunStore` (memory here; SQL with the RealityStore's
// backends is the next step) and is mounted by its host with `runsRoute(...)`; server.ts is not changed by 4.1.14.
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** How far a run is believed (ADR 0017). */
type RunTrust = 'local' | 'replay-valid' | 'server-witnessed' | 'moderator-verified';

/** A submitted run as the Bridge keeps it. */
export interface RunRecord {
  id: string;
  tenantId: string;
  gameId: string;
  categoryId: string;
  /** A pseudonym the player chose (never an email). */
  player: string;
  submittedAt: number;
  status: 'queued' | 'verifying' | 'done';
  verdict?: string;
  code?: string;
  reason?: string;
  trust: RunTrust;
  /** The time the category ranks on, in microticks (decimal), when the worker recomputed it. */
  ranked?: string | null;
  seedKind?: 'fixed' | 'random';
  /** SHA-256 of the envelope's text (a duplicate is refused). */
  envelopeHash: string;
  /** SHA-256 of the deletion token (the token itself is given once, at submission). */
  deleteTokenHash: string;
  envelope: string;
}

/** Where runs are kept, per tenant. */
interface RunStore {
  put(r: RunRecord): Promise<void>;
  get(tenantId: string, id: string): Promise<RunRecord | undefined>;
  list(tenantId: string, f?: { gameId?: string; categoryId?: string }): Promise<RunRecord[]>;
  byHash(tenantId: string, hash: string): Promise<RunRecord | undefined>;
  delete(tenantId: string, id: string): Promise<void>;
  /** Deletes the runs submitted before `before` (epoch ms); returns how many. */
  purge(before: number): Promise<number>;
}

export class MemoryRunStore implements RunStore {
  private rows = new Map<string, RunRecord>();
  private k = (t: string, id: string) => `${t}\u0000${id}`;
  async put(r: RunRecord) {
    this.rows.set(this.k(r.tenantId, r.id), structuredClone(r));
  }
  async get(t: string, id: string) {
    const r = this.rows.get(this.k(t, id));
    return r ? structuredClone(r) : undefined;
  }
  async list(t: string, f: { gameId?: string; categoryId?: string } = {}) {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.tenantId === t && (!f.gameId || r.gameId === f.gameId) && (!f.categoryId || r.categoryId === f.categoryId),
      )
      .map((r) => structuredClone(r));
  }
  async byHash(t: string, hash: string) {
    return [...this.rows.values()].find((r) => r.tenantId === t && r.envelopeHash === hash);
  }
  async delete(t: string, id: string) {
    this.rows.delete(this.k(t, id));
  }
  async purge(before: number) {
    let n = 0;
    for (const [k, r] of this.rows)
      if (r.submittedAt < before) {
        this.rows.delete(k);
        n++;
      }
    return n;
  }
}

/** A game the worker may verify against: its package's folder and the fingerprint approved for it. */
export interface ApprovedGame {
  dir: string;
  fingerprint: { logic: string; trustedExtensions: string; presentation: string; engine: string };
}

export interface RunsOptions {
  store: RunStore;
  /** Games by id: a run of another game is refused at submission. */
  approved: Record<string, ApprovedGame>;
  /** The worker's command (e.g. `[node, tsx/cli, tools/speedrun/worker.ts]`): it reads a job on stdin. */
  worker: string[];
  /** Wall time a worker gets before it is killed (default 60 s), and its heap (default 256 MB). */
  timeoutMs?: number;
  maxOldSpaceMb?: number;
  /** Runs waiting at most (beyond: 429). */
  maxQueued?: number;
  /** A run's envelope at most (bytes, default 2 MB). */
  maxBytes?: number;
  /** Days a run is kept (default 90). */
  retentionDays?: number;
  /** The admin token that moderates (`Authorization: Bearer …`); none: no moderation route. */
  adminToken?: string;
  now?: () => number;
}

class RunsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PSEUDONYM = /^[\p{L}\p{N} _.-]{2,32}$/u;
const ID = /^[\w.%+-]{1,64}$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The queue: submissions in, one worker at a time, verdicts stored. */
export class RunQueue {
  private queue: { tenantId: string; id: string }[] = [];
  private running: Promise<void> | null = null;
  constructor(readonly o: RunsOptions) {}

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  /** Accepts a run for verification. Returns its id and the token that deletes it (given once). */
  async submit(tenantId: string, input: unknown): Promise<{ id: string; deleteToken: string; status: string }> {
    const b = input as { player?: unknown; envelope?: unknown };
    if (typeof b?.player !== 'string' || !PSEUDONYM.test(b.player))
      throw new RunsError(400, 'player', 'a pseudonym of 2 to 32 letters, digits, spaces, _ . - (never an email)');
    if (typeof b.envelope !== 'string') throw new RunsError(400, 'envelope', 'the .wsrun text');
    if (Buffer.byteLength(b.envelope) > (this.o.maxBytes ?? 2_000_000))
      throw new RunsError(413, 'size', 'the run is too large');
    let head: { format?: unknown; gameId?: unknown; categoryId?: unknown };
    try {
      head = JSON.parse(b.envelope);
    } catch {
      throw new RunsError(400, 'envelope', 'the .wsrun is not JSON');
    }
    if (head.format !== 'web-scumm-speedrun' || typeof head.gameId !== 'string' || typeof head.categoryId !== 'string')
      throw new RunsError(400, 'envelope', 'not a web-scumm speedrun envelope');
    if (!ID.test(head.categoryId)) throw new RunsError(400, 'envelope', 'a category id');
    if (!this.o.approved[head.gameId]) throw new RunsError(404, 'game', 'this Bridge has no leaderboard for that game');
    if (this.queue.length >= (this.o.maxQueued ?? 100))
      throw new RunsError(429, 'busy', 'the queue is full, retry later');
    const envelopeHash = sha256(b.envelope);
    if (await this.o.store.byHash(tenantId, envelopeHash))
      throw new RunsError(409, 'duplicate', 'this run was submitted');
    const id = `run_${randomBytes(9).toString('base64url')}`;
    const deleteToken = randomBytes(18).toString('base64url');
    await this.o.store.put({
      id,
      tenantId,
      gameId: head.gameId,
      categoryId: head.categoryId,
      player: b.player.trim(),
      submittedAt: this.now(),
      status: 'queued',
      trust: 'local',
      envelopeHash,
      deleteTokenHash: sha256(deleteToken),
      envelope: b.envelope,
    });
    this.queue.push({ tenantId, id });
    this.pump();
    return { id, deleteToken, status: 'queued' };
  }

  private pump() {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.running = this.verify(next.tenantId, next.id).finally(() => {
      this.running = null;
      this.pump();
    });
  }

  /** Waits until the queue is empty (tests, shutdown). */
  async idle(): Promise<void> {
    for (;;) {
      if (!this.running && this.queue.length) this.pump();
      if (!this.running) return;
      await this.running;
    }
  }

  private async verify(tenantId: string, id: string) {
    const r = await this.o.store.get(tenantId, id);
    if (!r) return;
    r.status = 'verifying';
    await this.o.store.put(r);
    const game = this.o.approved[r.gameId]!;
    const out = await runWorker(this.o, game, r.envelope);
    Object.assign(r, out, { status: 'done' as const });
    // A worker grants at most `replay-valid`; anything else it might say is ignored.
    r.trust = out.verdict === 'valid' || out.verdict === 'valid-unranked' ? 'replay-valid' : 'local';
    await this.o.store.put(r);
  }

  /** Raises a verified run to `moderator-verified` (a human looked at it). */
  async moderate(tenantId: string, id: string): Promise<RunRecord> {
    const r = await this.o.store.get(tenantId, id);
    if (!r) throw new RunsError(404, 'run', 'no such run');
    if (r.trust !== 'replay-valid' && r.trust !== 'server-witnessed')
      throw new RunsError(409, 'trust', 'only a run the worker found valid can be moderated');
    r.trust = 'moderator-verified';
    await this.o.store.put(r);
    return r;
  }

  /** Deletes a run on its player's request (the token given at submission). */
  async remove(tenantId: string, id: string, token: string): Promise<void> {
    const r = await this.o.store.get(tenantId, id);
    if (!r) throw new RunsError(404, 'run', 'no such run');
    const a = Buffer.from(sha256(token), 'hex');
    const b = Buffer.from(r.deleteTokenHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new RunsError(403, 'token', 'not this run’s token');
    await this.o.store.delete(tenantId, id);
  }

  /** Deletes the runs older than the retention (90 days by default). */
  purge(): Promise<number> {
    return this.o.store.purge(this.now() - (this.o.retentionDays ?? 90) * 86_400_000);
  }

  /** A category's leaderboard: valid runs only, each player's best, separated by seed kind. */
  async leaderboard(tenantId: string, gameId: string, categoryId: string, seed?: 'fixed' | 'random') {
    const rows = (await this.o.store.list(tenantId, { gameId, categoryId })).filter(
      (r) => r.status === 'done' && r.verdict === 'valid' && r.ranked && (!seed || r.seedKind === seed),
    );
    const best = new Map<string, RunRecord>();
    for (const r of rows) {
      const b = best.get(r.player);
      if (!b || BigInt(r.ranked!) < BigInt(b.ranked!)) best.set(r.player, r);
    }
    return [...best.values()]
      .sort((a, b) => (BigInt(a.ranked!) < BigInt(b.ranked!) ? -1 : 1))
      .map((r, i) => ({ rank: i + 1, ...publicView(r) }));
  }
}

/** What anyone may read of a run: never the envelope's hash of a token, never anything but the pseudonym. */
function publicView(r: RunRecord) {
  return {
    id: r.id,
    gameId: r.gameId,
    categoryId: r.categoryId,
    player: r.player,
    submittedAt: r.submittedAt,
    status: r.status,
    ...(r.verdict ? { verdict: r.verdict, code: r.code, reason: r.reason } : {}),
    trust: r.trust,
    ...(r.ranked !== undefined ? { ranked: r.ranked } : {}),
    ...(r.seedKind ? { seedKind: r.seedKind } : {}),
  };
}

/** The worker's environment, built from scratch: no secret of the Bridge (PATH for the runtime, the package, a heap). */
export function workerEnv(game: ApprovedGame, o: Pick<RunsOptions, 'maxOldSpaceMb'>): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    GAME_DIR: game.dir,
    NODE_OPTIONS: `--max-old-space-size=${o.maxOldSpaceMb ?? 256}`,
  };
}

/** One job in an isolated process: the verdict, or `inconclusive` when the worker died, ran out or answered wrong. */
export async function runWorker(
  o: Pick<RunsOptions, 'worker' | 'timeoutMs' | 'maxOldSpaceMb'>,
  game: ApprovedGame,
  envelope: string,
): Promise<{ verdict: string; code: string; reason: string; ranked?: string | null; seedKind?: 'fixed' | 'random' }> {
  const jobId = randomBytes(8).toString('hex');
  const key = randomBytes(32).toString('hex');
  const timeout = o.timeoutMs ?? 60_000;
  const inconclusive = (code: string, reason: string) => ({ verdict: 'inconclusive', code, reason });
  const [cmd, ...args] = o.worker;
  if (!cmd) return inconclusive('worker', 'no worker command');
  const env = workerEnv(game, o);
  return new Promise((done) => {
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout + 5_000);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > 1_000_000) child.kill('SIGKILL');
      else out += d.toString('utf8');
    });
    child.stderr.resume();
    child.on('error', () => done(inconclusive('worker', 'the worker could not start')));
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (signal) return done(inconclusive('timeout', `the worker was stopped (${signal})`));
      try {
        const line = out.trim().split('\n').at(-1) ?? '';
        const { result, sig } = JSON.parse(line) as { result: string; sig: string };
        const want = createHmac('sha256', Buffer.from(key, 'hex')).update(result).digest();
        const got = Buffer.from(String(sig), 'hex');
        if (got.length !== want.length || !timingSafeEqual(got, want))
          return done(inconclusive('signature', 'the worker’s answer is not signed with this job’s key'));
        const r = JSON.parse(result) as {
          jobId: string;
          verdict: string;
          code: string;
          reason: string;
          ranked?: string | null;
          seedKind?: 'fixed' | 'random';
        };
        if (r.jobId !== jobId) return done(inconclusive('signature', 'an answer to another job'));
        done({
          verdict: r.verdict,
          code: r.code,
          reason: r.reason,
          ranked: r.ranked ?? null,
          ...(r.seedKind ? { seedKind: r.seedKind } : {}),
        });
      } catch {
        done(inconclusive('crash', `the worker gave no verdict (exit ${status})`));
      }
    });
    child.stdin.end(JSON.stringify({ jobId, key, envelope, approved: game.fingerprint, timeoutMs: timeout }));
  });
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new RunsError(413, 'size', 'the request is too large');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new RunsError(400, 'json', 'not JSON');
  }
}

/**
 * The routes of `/v1/runs` for a host's HTTP server: returns true when it answered. `POST /v1/runs` submits,
 * `GET /v1/runs/<id>` reads one, `GET /v1/runs?game=&category=&seed=` is a leaderboard, `DELETE /v1/runs/<id>` (header
 * `x-delete-token`) deletes on request, `POST /v1/runs/<id>/moderate` (admin bearer) raises a valid run's trust.
 */
export function runsRoute(q: RunQueue, tenantOf: (req: IncomingMessage) => string = () => 'default') {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> => {
    if (path !== '/v1/runs' && !path.startsWith('/v1/runs/')) return false;
    try {
      const tenant = tenantOf(req);
      const url = new URL(req.url ?? path, 'http://bridge');
      const m = /^\/v1\/runs\/([\w-]{1,40})(\/moderate)?$/.exec(path);
      if (req.method === 'POST' && path === '/v1/runs') {
        const body = await readBody(req, (q.o.maxBytes ?? 2_000_000) + 4096);
        json(res, 202, await q.submit(tenant, body));
      } else if (req.method === 'GET' && path === '/v1/runs') {
        const game = url.searchParams.get('game') ?? '';
        const category = url.searchParams.get('category') ?? '';
        const seed = url.searchParams.get('seed');
        if (!ID.test(game) || !ID.test(category)) throw new RunsError(400, 'query', '?game=<id>&category=<id>');
        json(res, 200, {
          runs: await q.leaderboard(tenant, game, category, seed === 'fixed' || seed === 'random' ? seed : undefined),
        });
      } else if (m && !m[2] && req.method === 'GET') {
        const r = await q.o.store.get(tenant, m[1]!);
        if (!r) throw new RunsError(404, 'run', 'no such run');
        json(res, 200, publicView(r));
      } else if (m && !m[2] && req.method === 'DELETE') {
        await q.remove(tenant, m[1]!, String(req.headers['x-delete-token'] ?? ''));
        res.writeHead(204).end();
      } else if (m?.[2] && req.method === 'POST') {
        const admin = q.o.adminToken;
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
        const ok =
          !!admin && bearer.length === admin.length && timingSafeEqual(Buffer.from(bearer), Buffer.from(admin));
        if (!ok) throw new RunsError(401, 'admin', 'the admin token is needed to moderate');
        json(res, 200, publicView(await q.moderate(tenant, m[1]!)));
      } else throw new RunsError(405, 'method', 'not a route of /v1/runs');
    } catch (e) {
      const err = e instanceof RunsError ? e : new RunsError(500, 'internal', 'the run could not be handled');
      json(res, err.status, { error: err.code, message: err.message });
    }
    return true;
  };
}
