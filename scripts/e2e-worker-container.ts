// npm run e2e:worker-container [-- --image=node:22-bookworm-slim] (4.1.17, plan §10.3, Linux with Docker): the speedrun
// worker in the container profile REALITY-OPS documents (tools/speedrun/container.mjs), started the way the Bridge's
// queue starts it (`runWorker`, bridge/src/runs.ts):
// 1. the reference run, verified inside the container: `valid`, its answer signed with the job's key;
// 2. a hostile script in the same profile: HTTP, DNS and TCP refused, nothing written outside /tmp, the host's
//    secret (an environment variable, a file in the runner's home) unseen, a child process allowed but without a
//    network, and the whole container killed by its own `timeout -s KILL`, child included, nothing left running;
// 3. the reference run again: the next worker starts as if nothing happened.
// The in-process refusal (tools/speedrun/worker.ts) is defence in depth; this is the isolation that is announced.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runWorker } from '../bridge/src/runs';
import { approvedContext } from '../tools/speedrun/package';
// @ts-expect-error: a plain .mjs tool without declarations
import { PIDS_LIMIT, workerContainerArgs } from '../tools/speedrun/container.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const image = process.argv.find((a) => a.startsWith('--image='))?.slice(8) ?? 'node:22-bookworm-slim';
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✔' : '✖'}  ${what}`);
  if (!ok) failed++;
};

const ctx = await approvedContext(resolve(ROOT, 'games/reference'));
const game = { dir: '/app/games/reference', fingerprint: ctx.fingerprint };
const envelope = readFileSync(resolve(ROOT, 'tests/fixtures/speedrun/reference-any.wsrun'), 'utf8');
const worker = workerContainerArgs({ image, app: ROOT, timeoutS: 70 });
check(
  worker.includes('none') && worker[worker.indexOf('--network') + 1] === 'none',
  'the profile has no network by default',
);

const verify = async (what: string) => {
  const t0 = Date.now();
  const a = await runWorker({ worker, timeoutMs: 60_000 }, game, envelope);
  check(a.verdict === 'valid', `${what}: ${a.verdict} (${a.code}) in ${Math.round((Date.now() - t0) / 1000)} s`);
};
await verify('the reference run, verified in the container');

// The host's secrets: in the environment the docker client gets, and in a file of the runner's home.
const canary = join(homedir(), `.worker-canary-${randomBytes(4).toString('hex')}`);
writeFileSync(canary, `canary-${randomBytes(8).toString('hex')}`);
const name = `ws-hostile-${randomBytes(4).toString('hex')}`;
const hostile = workerContainerArgs({
  image,
  app: ROOT,
  timeoutS: 10,
  name,
  command: ['node', 'tests/fixtures/worker-hostile.mjs', canary],
});
const t0 = Date.now();
const r = spawnSync(hostile[0]!, hostile.slice(1), {
  encoding: 'utf8',
  env: { PATH: process.env.PATH ?? '', WORKER_CANARY: 'the Bridge secret', GAME_DIR: game.dir },
  timeout: 120_000,
});
rmSync(canary, { force: true });
const seconds = (Date.now() - t0) / 1000;
let seen: Record<string, string | number> = {};
try {
  seen = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}');
} catch {
  console.error(r.stdout, r.stderr);
}
console.log(`   the hostile script saw: ${JSON.stringify(seen)}`);
for (const k of ['fetch', 'dns', 'tcp', 'writeApp', 'writeRoot'])
  check(String(seen[k] ?? '').startsWith('refused'), `${k}: ${seen[k] ?? 'nothing said'}`);
check(seen.writeTmp === 'written', `/tmp is writable (bounded): ${seen.writeTmp}`);
check(seen.canaryEnv === 'absent' && seen.canaryFile === 'absent', "the host's secret is not seen");
check(seen.uid === 65534, `an unprivileged user (${seen.uid})`);
check(
  typeof seen.threads === 'number' && seen.threads < PIDS_LIMIT / 2,
  `${seen.threads} threads, under half the pids limit (${PIDS_LIMIT})`,
);
check(
  seen.child === 'started' && String(seen.childFetch).startsWith('refused'),
  `a child starts, without a network: ${seen.childFetch}`,
);
check(r.status === 137 && seconds < 60, `killed by its own timeout (exit ${r.status} after ${Math.round(seconds)} s)`);
const left = spawnSync('docker', ['ps', '-aq', '--filter', `name=${name}`], { encoding: 'utf8' }).stdout.trim();
check(left === '', 'nothing of it is left running');

await verify('the next worker, after the hostile one');
process.exit(failed ? 1 : 0);
