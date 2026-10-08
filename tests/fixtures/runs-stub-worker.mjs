// A stand-in for tools/speedrun/worker.ts in the queue's tests (4.1.16): it speaks the same protocol (one job on stdin,
// one line out, signed with the job's key) without replaying anything, so the tests of leases, instances and
// leaderboards stay fast. The envelope says what to answer: `stub.verdict` (default `valid`), `stub.sleepMs`, and its
// time and world. The real worker's verdicts are tests/bridge-runs.test.ts's.
import { createHmac } from 'node:crypto';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const env = JSON.parse(job.envelope);
const stub = env.stub ?? {};
if (stub.sleepMs) await new Promise((ok) => setTimeout(ok, stub.sleepMs));
const v = env.variant ?? { hash: '0'.repeat(64), mode: 'story', seed: 'story' };
const board = stub.board ?? env.categoryId;
const result = JSON.stringify({
  jobId: job.jobId,
  verdict: stub.verdict ?? 'valid',
  code: stub.verdict && stub.verdict !== 'valid' ? 'stub' : 'ok',
  reason: 'stub',
  trust: 'replay-valid',
  ranked: env.timing?.logicalTime ?? null,
  world: { hash: v.hash, mode: v.mode, seed: v.seed, leaderboardKey: board, ...(stub.validUntil ? { validUntil: stub.validUntil } : {}) },
});
const sig = createHmac('sha256', Buffer.from(job.key, 'hex')).update(result).digest('hex');
process.stdout.write(`${JSON.stringify({ result, sig })}\n`, () => process.exit(0));
