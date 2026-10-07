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
  /**
   * The run's identity: SHA-256 of its game, category, seed and inputs (their RTA stamps aside). The same run
   * re-spaced or re-stamped is the same key: the first submitter keeps it, a second is refused.
   */
  runKey: string;
  /** SHA-256 of the deletion token (the token itself is given once, at submission). */
  deleteTokenHash: string;
  /** The `.wsrun` text until the worker's verdict is stored, then empty (the summary above stays). */
  envelope: string;
}

/** Where runs are kept, per tenant. */
interface RunStore {
  put(r: RunRecord): Promise<void>;
  get(tenantId: string, id: string): Promise<RunRecord | undefined>;
  list(tenantId: string, f?: { gameId?: string; categoryId?: string }): Promise<RunRecord[]>;
  byKey(tenantId: string, runKey: string): Promise<RunRecord | undefined>;
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
  async byKey(t: string, runKey: string) {
    return [...this.rows.values()].find((r) => r.tenantId === t && r.runKey === runKey);
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
  /** Submissions one client (per tenant) may make per minute (default 10; beyond: 429). */
  perMinute?: number;
  /** How often old runs are purged (ms, default an hour; 0: never on its own, call `purge()`). */
  purgeEveryMs?: number;
  /** Logs a failure the queue survives (default `console.error`). */
  log?: (message: string) => void;
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

/** JSON with sorted keys (the Bridge does not import the engine's `canonicalJson`: it reaches only `reality/`). */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

/** A run's identity: its game, category, seed and inputs, the inputs' RTA stamps (`t`) aside. */
function runKeyOf(env: { gameId?: unknown; categoryId?: unknown; seed?: unknown; chunks?: unknown }): string {
  const chunks = Array.isArray(env.chunks) ? (env.chunks as { entries?: unknown }[]) : [];
  const entries = chunks
    .flatMap((c) => (Array.isArray(c?.entries) ? c.entries : []))
    .map((e) => {
      if (!e || typeof e !== 'object') return e;
      const { t: _t, ...rest } = e as Record<string, unknown>;
      return rest;
    });
  return sha256(stable({ gameId: env.gameId, categoryId: env.categoryId, seed: env.seed ?? null, entries }));
}

/** The queue: submissions in, one worker at a time, verdicts stored. */
export class RunQueue {
  private queue: { tenantId: string; id: string }[] = [];
  private running: Promise<void> | null = null;
  private buckets = new Map<string, { tokens: number; at: number }>();
  private purger: ReturnType<typeof setInterval> | null = null;
  constructor(readonly o: RunsOptions) {
    const every = o.purgeEveryMs ?? 3_600_000;
    if (every > 0) {
      this.purger = setInterval(() => {
        this.purge().catch((e) => this.log(`runs: the purge failed: ${(e as Error).message}`));
      }, every);
      this.purger.unref?.();
    }
  }

  private log(m: string) {
    (this.o.log ?? console.error)(m);
  }

  /** Stops the scheduled purge (a host shutting down, a test). */
  close(): void {
    if (this.purger) clearInterval(this.purger);
    this.purger = null;
  }

  /** Takes a submission token for this client; false when it has none left this minute. */
  private take(key: string): boolean {
    const per = this.o.perMinute ?? 10;
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: per, at: now };
    b.tokens = Math.min(per, b.tokens + ((now - b.at) / 60_000) * per);
    b.at = now;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) for (const [k, x] of this.buckets) if (now - x.at > 120_000) this.buckets.delete(k);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private now() {
    return this.o.now?.() ?? Date.now();
  }

  /** Accepts a run for verification. Returns its id and the token that deletes it (given once). */
  async submit(
    tenantId: string,
    input: unknown,
    client = 'anonymous',
  ): Promise<{ id: string; deleteToken: string; status: string }> {
    if (!this.take(`${tenantId}\u0000${client}`))
      throw new RunsError(429, 'rate', 'too many runs from this client, retry in a minute');
    const b = input as { player?: unknown; envelope?: unknown };
    if (typeof b?.player !== 'string' || !PSEUDONYM.test(b.player))
      throw new RunsError(400, 'player', 'a pseudonym of 2 to 32 letters, digits, spaces, _ . - (never an email)');
    if (typeof b.envelope !== 'string') throw new RunsError(400, 'envelope', 'the .wsrun text');
    if (Buffer.byteLength(b.envelope) > (this.o.maxBytes ?? 2_000_000))
      throw new RunsError(413, 'size', 'the run is too large');
    let head: { format?: unknown; gameId?: unknown; categoryId?: unknown; seed?: unknown; chunks?: unknown };
    try {
      head = JSON.parse(b.envelope);
    } catch {
      throw new RunsError(400, 'envelope', 'the .wsrun is not JSON');
    }
    if (head.format !== 'web-scumm-speedrun' || typeof head.gameId !== 'string' || typeof head.categoryId !== 'string')
      throw new RunsError(400, 'envelope', 'not a web-scumm speedrun envelope');
    if (!ID.test(head.categoryId)) throw new RunsError(400, 'envelope', 'a category id');
    if (!ID.test(head.gameId) || !Object.hasOwn(this.o.approved, head.gameId))
      throw new RunsError(404, 'game', 'this Bridge has no leaderboard for that game');
    if (this.queue.length >= (this.o.maxQueued ?? 100))
      throw new RunsError(429, 'busy', 'the queue is full, retry later');
    const runKey = runKeyOf(head);
    if (await this.o.store.byKey(tenantId, runKey))
      throw new RunsError(409, 'duplicate', 'this run was submitted already (the first submitter keeps it)');
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
      runKey,
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
    this.running = this.verify(next.tenantId, next.id)
      .catch((e) => this.failed(next.tenantId, next.id, e))
      .finally(() => {
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

  /** A verification that threw (a store, a spawn): the run is `inconclusive`, the queue goes on, it is logged. */
  private async failed(tenantId: string, id: string, e: unknown) {
    this.log(`runs: the verification of ${id} failed: ${(e as Error)?.message ?? String(e)}`);
    try {
      const r = await this.o.store.get(tenantId, id);
      if (!r) return;
      Object.assign(r, {
        status: 'done',
        verdict: 'inconclusive',
        code: 'crash',
        reason: 'the verification failed',
        trust: 'local',
        envelope: '',
      });
      await this.o.store.put(r);
    } catch {
      /* the store itself is failing: the run stays as it was */
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
    // A ranked time is only a valid run's; the envelope is not kept once its verdict is (the summary is).
    if (out.verdict !== 'valid') r.ranked = null;
    r.envelope = '';
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
    // Its own process group: a runner (tsx) and the worker it starts are killed together, never one left hanging.
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let out = '';
    let size = 0;
    let killed: string | null = null;
    const kill = (why: string) => {
      killed ??= why;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => kill('timeout'), timeout + 5_000);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > 1_000_000) kill('output');
      else out += d.toString('utf8');
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      done(inconclusive('worker', 'the worker could not start'));
    });
    // 'exit', not 'close': a grandchild holding the pipes must not keep the queue waiting. What the worker wrote
    // before it exited is read until its stdout ends, a second at most.
    let ended = false;
    child.stdout.on('end', () => {
      ended = true;
    });
    child.on('exit', (status, signal) => {
      clearTimeout(timer);
      if (!killed && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL'); // whatever the worker left behind
        } catch {
          /* the group is gone */
        }
      }
      const settle = () => answer(status, signal);
      if (ended || killed) settle();
      else {
        const grace = setTimeout(settle, 1000);
        child.stdout.once('end', () => {
          clearTimeout(grace);
          settle();
        });
      }
    });
    let answered = false;
    const answer = (status: number | null, signal: NodeJS.Signals | null) => {
      if (answered) return;
      answered = true;
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
      if (killed === 'timeout' || signal)
        return done(inconclusive('timeout', `the worker was stopped (${signal ?? killed})`));
      if (killed) return done(inconclusive('crash', 'the worker wrote too much'));
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
    };
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
export function runsRoute(
  q: RunQueue,
  tenantOf: (req: IncomingMessage) => string = () => 'default',
  /** The client a rate limit counts (default: the socket's address; behind a proxy, the host passes its own). */
  clientOf: (req: IncomingMessage) => string = (req) => req.socket.remoteAddress ?? 'unknown',
) {
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> => {
    if (path !== '/v1/runs' && !path.startsWith('/v1/runs/')) return false;
    try {
      const tenant = tenantOf(req);
      const url = new URL(req.url ?? path, 'http://bridge');
      const m = /^\/v1\/runs\/([\w-]{1,40})(\/moderate)?$/.exec(path);
      if (req.method === 'POST' && path === '/v1/runs') {
        const body = await readBody(req, (q.o.maxBytes ?? 2_000_000) + 4096);
        json(res, 202, await q.submit(tenant, body, clientOf(req)));
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
      // A body refused half-read: the rest is not read, and the connection is not reused for another request.
      if (err.status === 413) {
        res.setHeader('connection', 'close');
        req.resume();
      }
      json(res, err.status, { error: err.code, message: err.message });
    }
    return true;
  };
}
