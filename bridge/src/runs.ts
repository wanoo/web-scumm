// Speedrun leaderboards on the Bridge (4.1.14 "Time Attack", ADR 0017): `POST /v1/runs` takes a run's `.wsrun`, a queue
// hands it to an ISOLATED worker (a separate process: a bounded heap, killed at its time budget, an environment with no
// secret of the Bridge, no network, the game package approved by its fingerprint), and the worker's verdict, checked by
// the HMAC of a one-time key, is stored with the run. The HTTP process never replays a run and never trusts the
// client's word: a run's trust is `local` until the worker says `replay-valid`, and only an admin raises it to
// `moderator-verified`. Leaderboards are per tenant, game and category, separated by fixed and random seeds, ranked on
// valid runs only, shown with a pseudonym (never an email) and the trust level. Runs are kept 90 days by default and
// deleted on request with the token given at submission.
//
// 4.1.16 (ADR 0019): the runs are durable (`SqlRunStore` over the Reality store's SQLite or Postgres, runs-store.ts);
// any number of instances share one queue: a run is created once (its key is unique), claimed by one worker under a
// lease, and claimed again when its worker died; the leaderboard is the verifier's (`leaderboardKey`: a Fixed or Daily
// world has its own board), ties share a rank. `bridgeServer` mounts the routes when its options name a queue.
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RunOutcome, RunRecord, RunStore } from './runs-store';

export { MemoryRunStore, SqlRunStore } from './runs-store';
export type { RunRecord } from './runs-store';

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
  /** Runs waiting at most, every instance together (beyond: 429). */
  maxQueued?: number;
  /** Workers this instance runs at once (default 1): each claims a run, verifies it, claims the next. */
  workers?: number;
  /** How long a claimed run is a worker's (default the worker's budget + 30 s): beyond, another worker takes it over. */
  leaseMs?: number;
  /** How often this instance looks for runs other instances queued or whose worker died (ms, default 2 s; 0: never). */
  pollMs?: number;
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
  /** The audit line of each submission, verdict, moderation and deletion (default: JSON on stdout, the Bridge's log). */
  audit?: (line: { event: string; [k: string]: string | number | boolean | undefined }) => void;
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
const BOARD_KEY = /^[\w.%+-]{1,64}(:[\w.:-]{1,80})?$/;
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

/**
 * A run's identity: its game, category, seed and inputs, the inputs' RTA stamps (`t`) aside (schema 2: `runSeed`). Not
 * its world (4.1.16, after the second reading): a copy of someone's run re-sealed in another world of the same logic
 * (another seed of a catalogue, another cosmetic value) is the same run, and the first submitter keeps it.
 */
function runKeyOf(env: {
  gameId?: unknown;
  categoryId?: unknown;
  seed?: unknown;
  runSeed?: unknown;
  chunks?: unknown;
}): string {
  const chunks = Array.isArray(env.chunks) ? (env.chunks as { entries?: unknown }[]) : [];
  const entries = chunks
    .flatMap((c) => (Array.isArray(c?.entries) ? c.entries : []))
    .map((e) => {
      if (!e || typeof e !== 'object') return e;
      const { t: _t, ...rest } = e as Record<string, unknown>;
      return rest;
    });
  return sha256(
    stable({ gameId: env.gameId, categoryId: env.categoryId, seed: env.seed ?? env.runSeed ?? null, entries }),
  );
}

/** The queue: submissions in, the store's queue claimed by this instance's workers, verdicts stored. */
export class RunQueue {
  private loops = new Set<Promise<void>>();
  private buckets = new Map<string, { tokens: number; at: number }>();
  private timers: ReturnType<typeof setInterval>[] = [];
  /** This instance's name in a lease (a worker is `<instance>:<n>`). */
  readonly instance = randomBytes(6).toString('hex');
  private next = 0;
  constructor(readonly o: RunsOptions) {
    const every = o.purgeEveryMs ?? 3_600_000;
    if (every > 0) this.every(every, () => this.purge().then(() => undefined), 'the purge');
    const poll = o.pollMs ?? 2000;
    if (poll > 0) this.every(poll, async () => this.pump(), 'a poll of the queue');
  }

  private every(ms: number, f: () => Promise<void>, what: string) {
    const t = setInterval(() => {
      f().catch((e) => this.log(`runs: ${what} failed: ${(e as Error).message}`));
    }, ms);
    t.unref?.();
    this.timers.push(t);
  }

  private log(m: string) {
    (this.o.log ?? console.error)(m);
  }
  private audit(event: string, r: Pick<RunRecord, 'tenantId' | 'id'>, more: Record<string, string> = {}) {
    (this.o.audit ?? ((l) => console.log(JSON.stringify(l))))({ event, tenant: r.tenantId, run: r.id, ...more });
  }

  /** Stops the scheduled purge and poll (a host shutting down, a test). */
  close(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
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
    let head: Parameters<typeof runKeyOf>[0] & { format?: unknown };
    try {
      head = JSON.parse(b.envelope);
    } catch {
      throw new RunsError(400, 'envelope', 'the .wsrun is not JSON');
    }
    if (
      !head ||
      typeof head !== 'object' ||
      head.format !== 'web-scumm-speedrun' ||
      typeof head.gameId !== 'string' ||
      typeof head.categoryId !== 'string'
    )
      throw new RunsError(400, 'envelope', 'not a web-scumm speedrun envelope');
    if (!ID.test(head.categoryId)) throw new RunsError(400, 'envelope', 'a category id');
    if (!ID.test(head.gameId) || !Object.hasOwn(this.o.approved, head.gameId))
      throw new RunsError(404, 'game', 'this Bridge has no leaderboard for that game');
    if ((await this.o.store.queued()) >= (this.o.maxQueued ?? 100))
      throw new RunsError(429, 'busy', 'the queue is full, retry later');
    const id = `run_${randomBytes(9).toString('base64url')}`;
    const deleteToken = randomBytes(18).toString('base64url');
    // One statement: two instances receiving the same run at once create one row (a unique key, not a read first).
    const created = await this.o.store.create({
      id,
      tenantId,
      gameId: head.gameId,
      categoryId: head.categoryId,
      player: b.player.trim(),
      submittedAt: this.now(),
      status: 'queued',
      trust: 'local',
      runKey: runKeyOf(head),
      deleteTokenHash: sha256(deleteToken),
      envelope: b.envelope,
    });
    if (!created)
      throw new RunsError(409, 'duplicate', 'this run was submitted already (the first submitter keeps it)');
    this.audit('run.submitted', { tenantId, id }, { game: head.gameId, category: head.categoryId });
    this.pump();
    return { id, deleteToken, status: 'queued' };
  }

  /** Starts this instance's idle workers: each claims runs from the store until none is waiting. */
  private pump() {
    const n = Math.max(1, this.o.workers ?? 1);
    while (this.loops.size < n) {
      const worker = `${this.instance}:${this.next++ % n}`;
      const loop: Promise<void> = this.work(worker)
        .catch((e) => this.log(`runs: worker ${worker} stopped: ${(e as Error).message}`))
        .finally(() => this.loops.delete(loop));
      this.loops.add(loop);
    }
  }

  private async work(worker: string) {
    const lease = this.o.leaseMs ?? (this.o.timeoutMs ?? 60_000) + 30_000;
    for (;;) {
      const r = await this.o.store.claimNext(worker, lease, this.now());
      if (!r) return;
      try {
        await this.verify(r, worker);
      } catch (e) {
        await this.failed(r, worker, e);
      }
    }
  }

  /**
   * Waits until no run is waiting and this instance's workers are done (tests, shutdown). It claims once first: a run
   * whose lease expired is not `queued`, and only a claim finds it (the poll does the same on its own).
   */
  async idle(): Promise<void> {
    this.pump();
    for (;;) {
      if (!this.loops.size && (await this.o.store.queued()) > 0) this.pump();
      if (!this.loops.size) return;
      await Promise.all([...this.loops]);
    }
  }

  /** A verification that threw (a store, a spawn): the run is `inconclusive`, the queue goes on, it is logged. */
  private async failed(r: RunRecord, worker: string, e: unknown) {
    this.log(`runs: the verification of ${r.id} failed: ${(e as Error)?.message ?? String(e)}`);
    try {
      await this.o.store.complete(r.tenantId, r.id, worker, {
        verdict: 'inconclusive',
        code: 'crash',
        reason: 'the verification failed',
        trust: 'local',
        ranked: null,
      });
    } catch {
      /* the store itself is failing: the lease expires and another worker takes the run over */
    }
  }

  private async verify(r: RunRecord, worker: string) {
    const game = this.o.approved[r.gameId];
    if (!game) throw new Error(`no approved package for "${r.gameId}"`);
    const out = await runWorker(this.o, game, r.envelope);
    const valid = out.verdict === 'valid' || out.verdict === 'valid-unranked';
    // A Daily run sent after its day is practice: its verdict stands, it is not that day's board's (plan §7).
    const late = out.world?.validUntil !== undefined && r.submittedAt > out.world.validUntil;
    const outcome: RunOutcome = {
      verdict: out.verdict,
      code: out.code,
      reason: out.reason,
      // A worker grants at most `replay-valid`; anything else it might say is ignored.
      trust: valid ? 'replay-valid' : 'local',
      // A ranked time is only a valid run's; the envelope is not kept once its verdict is (the summary is).
      ranked: out.verdict === 'valid' && !late ? (out.ranked ?? null) : null,
      ...(late ? { reason: `${out.reason} (sent after its day: practice, not ranked)` } : {}),
      ...(out.seedKind ? { seedKind: out.seedKind } : {}),
      ...(out.world
        ? {
            worldHash: out.world.hash,
            worldMode: out.world.mode,
            worldSeed: out.world.seed,
            leaderboardKey: out.world.leaderboardKey,
          }
        : {}),
    };
    if (!(await this.o.store.complete(r.tenantId, r.id, worker, outcome)))
      this.log(`runs: ${r.id}: the lease was taken over before the verdict (another worker stores its own)`);
    else this.audit('run.verified', r, { verdict: out.verdict, code: out.code, worker });
  }

  /** Raises a verified run to `moderator-verified` (a human looked at it). */
  async moderate(tenantId: string, id: string): Promise<RunRecord> {
    const r = await this.o.store.get(tenantId, id);
    if (!r) throw new RunsError(404, 'run', 'no such run');
    if (r.trust !== 'replay-valid' && r.trust !== 'server-witnessed')
      throw new RunsError(409, 'trust', 'only a run the worker found valid can be moderated');
    await this.o.store.setTrust(tenantId, id, 'moderator-verified');
    this.audit('run.moderated', r);
    return { ...r, trust: 'moderator-verified' };
  }

  /** Deletes a run on its player's request (the token given at submission). */
  async remove(tenantId: string, id: string, token: string): Promise<void> {
    const r = await this.o.store.get(tenantId, id);
    if (!r) throw new RunsError(404, 'run', 'no such run');
    const a = Buffer.from(sha256(token), 'hex');
    const b = Buffer.from(r.deleteTokenHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new RunsError(403, 'token', 'not this run’s token');
    await this.o.store.delete(tenantId, id);
    this.audit('run.deleted', r);
  }

  /** Deletes the runs older than the retention (90 days by default). */
  purge(): Promise<number> {
    return this.o.store.purge(this.now() - (this.o.retentionDays ?? 90) * 86_400_000);
  }

  /**
   * A leaderboard: valid runs only, each player's best, on one key (the verifier's: the category, and for a Fixed or
   * Daily world its seed; default the category's own board). Sorted by time, then submission, then id; equal times
   * share a rank. `seed` (4.1.14) still filters schema 1 runs by seed kind.
   */
  async leaderboard(
    tenantId: string,
    gameId: string,
    categoryId: string,
    o: { key?: string; seed?: 'fixed' | 'random' } = {},
  ) {
    const key = o.key ?? categoryId;
    const rows = (await this.o.store.list(tenantId, { gameId, categoryId })).filter(
      (r) =>
        r.status === 'done' &&
        r.verdict === 'valid' &&
        r.ranked &&
        (r.leaderboardKey ?? categoryId) === key &&
        (!o.seed || r.seedKind === o.seed),
    );
    const best = new Map<string, RunRecord>();
    const before = (a: RunRecord, b: RunRecord) => {
      const ta = BigInt(a.ranked!);
      const tb = BigInt(b.ranked!);
      if (ta !== tb) return ta < tb ? -1 : 1;
      if (a.submittedAt !== b.submittedAt) return a.submittedAt - b.submittedAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    };
    for (const r of rows) {
      const b = best.get(r.player);
      if (!b || before(r, b) < 0) best.set(r.player, r);
    }
    const sorted = [...best.values()].sort(before);
    let rank = 0;
    return sorted.map((r, i) => {
      if (i === 0 || sorted[i - 1]!.ranked !== r.ranked) rank = i + 1;
      return { rank, ...publicView(r) };
    });
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
    ...(r.leaderboardKey
      ? { world: { hash: r.worldHash, mode: r.worldMode, seed: r.worldSeed }, leaderboardKey: r.leaderboardKey }
      : {}),
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

/** What a worker answers: the verdict, the time it ranks on, and the world it checked (4.1.16). */
export interface WorkerAnswer {
  verdict: string;
  code: string;
  reason: string;
  ranked?: string | null;
  seedKind?: 'fixed' | 'random';
  world?: { hash: string; mode: string; seed: string; leaderboardKey: string; validUntil?: number };
}

const isWorld = (w: unknown): w is NonNullable<WorkerAnswer['world']> =>
  !!w &&
  typeof w === 'object' &&
  ['hash', 'mode', 'seed', 'leaderboardKey'].every(
    (k) => typeof (w as Record<string, unknown>)[k] === 'string' && (w as Record<string, string>)[k]!.length <= 200,
  ) &&
  ((w as { validUntil?: unknown }).validUntil === undefined ||
    Number.isSafeInteger((w as { validUntil?: unknown }).validUntil));

/** One job in an isolated process: the verdict, or `inconclusive` when the worker died, ran out or answered wrong. */
export async function runWorker(
  o: Pick<RunsOptions, 'worker' | 'timeoutMs' | 'maxOldSpaceMb'>,
  game: ApprovedGame,
  envelope: string,
): Promise<WorkerAnswer> {
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
          world?: unknown;
        };
        if (r.jobId !== jobId) return done(inconclusive('signature', 'an answer to another job'));
        done({
          verdict: r.verdict,
          code: r.code,
          reason: r.reason,
          ranked: r.ranked ?? null,
          ...(r.seedKind ? { seedKind: r.seedKind } : {}),
          ...(isWorld(r.world) ? { world: r.world } : {}),
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
 * `GET /v1/runs/<id>` reads one, `GET /v1/runs?game=&category=[&key=]` is a leaderboard (4.1.14's `&seed=` kept), `DELETE /v1/runs/<id>` (header
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
        const key = url.searchParams.get('key') ?? undefined;
        if (!ID.test(game) || !ID.test(category)) throw new RunsError(400, 'query', '?game=<id>&category=<id>');
        if (key !== undefined && !BOARD_KEY.test(key)) throw new RunsError(400, 'query', '&key=<category>[:<seed>]');
        json(res, 200, {
          runs: await q.leaderboard(tenant, game, category, {
            ...(key ? { key } : {}),
            ...(seed === 'fixed' || seed === 'random' ? { seed } : {}),
          }),
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
