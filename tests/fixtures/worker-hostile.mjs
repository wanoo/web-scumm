// What a hostile run would try inside the worker's container (4.1.17, scripts/e2e-worker-container.mjs): the network
// (HTTP, DNS, TCP), writing outside /tmp, a host secret, a child process and the child's own network. Prints one JSON
// line of what happened, then stays (the container's `timeout -s KILL` must end it, the child with it).
import { execFileSync, spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';

const out = {};
const code = (e) => e?.cause?.code ?? e?.code ?? String(e?.message ?? e).slice(0, 60);
try {
  await fetch('http://1.1.1.1/', { signal: AbortSignal.timeout(3000) });
  out.fetch = 'open';
} catch (e) {
  out.fetch = `refused ${code(e)}`;
}
try {
  await dns.lookup('example.com');
  out.dns = 'open';
} catch (e) {
  out.dns = `refused ${code(e)}`;
}
out.tcp = await new Promise((ok) => {
  const s = net.connect({ host: '1.1.1.1', port: 53, timeout: 3000 });
  s.on('connect', () => (s.destroy(), ok('open')));
  s.on('timeout', () => (s.destroy(), ok('refused timeout')));
  s.on('error', (e) => ok(`refused ${code(e)}`));
});
for (const [k, f] of [
  ['writeApp', '/app/hostile.txt'],
  ['writeRoot', '/hostile.txt'],
  ['writeTmp', '/tmp/ok.txt'],
]) {
  try {
    writeFileSync(f, 'x');
    out[k] = 'written';
  } catch (e) {
    out[k] = `refused ${code(e)}`;
  }
}
out.canaryEnv = process.env.WORKER_CANARY ? 'seen' : 'absent';
// The host's file is named on the command line (the environment does not reach the container): it must not be there.
const canaryPath = process.argv[2];
out.canaryFile = !canaryPath ? 'not named' : existsSync(canaryPath) ? 'seen' : 'absent';
out.threads = readdirSync('/proc/self/task').length;
out.uid = process.getuid?.();
// A child may start (the pids limit bounds how many); it has no network either, and dies with the container.
const child = spawn('sleep', ['600'], { stdio: 'ignore' });
out.child = child.pid ? 'started' : 'refused';
try {
  execFileSync(process.execPath, ['-e', "fetch('http://1.1.1.1/',{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0),()=>process.exit(7))"], {
    stdio: 'ignore',
  });
  out.childFetch = 'open';
} catch (e) {
  out.childFetch = e.status === 7 ? 'refused' : `refused ${e.status}`;
}
console.log(JSON.stringify(out));
setInterval(() => {}, 1000);
