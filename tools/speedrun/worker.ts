// The Bridge's isolated verification worker (4.1.14 "Time Attack", ADR 0017): one process per run, started by the
// Bridge's queue (bridge/src/runs.ts) with a bounded heap, a time budget it is killed at, an environment holding no
// secret of the Bridge (only GAME_DIR, the approved game package), and no network (fetch, WebSocket and sockets refused
// here; a deployment adds the OS's isolation). It reads one job on stdin (the run, the package's approved fingerprint,
// a one-time key), checks the package's fingerprint, verifies the run, and writes ONE line: the verdict as text and its
// HMAC under the job's key, so the queue knows the line is this job's answer and not text the run made up.
import { createHmac } from 'node:crypto';
import net from 'node:net';
import { canonicalJson } from '../../src/engine/core/canonical';
import type { GameFingerprint } from '../../src/engine/core/fingerprint';
import { rankedTime } from '../../src/engine/tools/speedrun/splits';
import { parseEnvelope, verifyRun } from '../../src/engine/tools/speedrun/verify';

// No network: whatever the replay runs, it cannot call out.
const refuse = () => {
  throw new Error('the verification worker has no network');
};
globalThis.fetch = refuse as typeof fetch;
(globalThis as { WebSocket?: unknown }).WebSocket = refuse;
net.Socket.prototype.connect = refuse as never;

interface Job {
  jobId: string;
  /** Hex key, used once: the queue checks the answer's HMAC with it. */
  key: string;
  envelope: string;
  approved: GameFingerprint;
  timeoutMs?: number;
}

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const job = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Job;

const { approvedContext } = await import('./package');
const ctx = await approvedContext(process.env.GAME_DIR);
let result: Record<string, unknown>;
const comps = ['logic', 'trustedExtensions', 'presentation', 'engine'] as const;
if (comps.some((k) => ctx.fingerprint[k] !== job.approved[k])) {
  result = {
    verdict: 'inconclusive',
    code: 'package-not-approved',
    reason: 'the game package on this worker is not the approved one',
    trust: 'local',
  };
} else {
  const r = await verifyRun(job.envelope, { ...ctx, timeoutMs: Math.min(job.timeoutMs ?? 60_000, 60_000) });
  let ranked: string | null = null;
  let seedKind: 'fixed' | 'random' = 'random';
  try {
    const env = parseEnvelope(job.envelope);
    const cat = ctx.game.speedrun?.categories.find((c) => c.id === env.categoryId);
    if (cat?.seed === 'fixed') seedKind = 'fixed';
    if (cat && r.recomputed) ranked = rankedTime(cat, { ...r.recomputed, rtaMs: env.timing.rtaMs })?.toString() ?? null;
  } catch {
    /* the verdict already says why */
  }
  result = { ...r, ranked, seedKind };
}
const text = canonicalJson({ jobId: job.jobId, ...result });
const sig = createHmac('sha256', Buffer.from(job.key, 'hex')).update(text).digest('hex');
process.stdout.write(`${canonicalJson({ result: text, sig })}\n`);
