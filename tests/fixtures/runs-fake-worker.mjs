// A worker that misbehaves on purpose (4.1.17, tests/bridge-runs-worker.test.ts): its first argument says how. It
// speaks the protocol of tools/speedrun/worker.ts (one job on stdin, one signed line out) when it answers at all.
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [mode, arg] = process.argv.slice(2);
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const sign = (o) => {
  const result = JSON.stringify(o);
  return `${JSON.stringify({ result, sig: createHmac('sha256', Buffer.from(job.key, 'hex')).update(result).digest('hex') })}\n`;
};
const valid = { jobId: job.jobId, verdict: 'valid', code: 'ok', reason: 'fake', trust: 'replay-valid', ranked: '100' };
const say = (text) => process.stdout.write(text, () => process.exit(0));
if (mode === 'other-job') say(sign({ ...valid, jobId: 'another' }));
else if (mode === 'world') say(sign({ ...valid, seedKind: 'fixed', world: JSON.parse(arg) }));
else if (mode === 'pad') {
  // `arg` bytes in all: blank lines first, the signed answer last.
  const line = sign(valid);
  say(`${'\n'.repeat(Number(arg) - Buffer.byteLength(line))}${line}`);
} else if (mode === 'grandchild') {
  // A process left behind, its pid written where the test looks; then the answer.
  const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(arg, String(g.pid));
  say(sign(valid));
} else if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
else if (mode === 'silent') process.exit(3);
else say(sign(valid));
