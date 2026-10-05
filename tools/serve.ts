// Starts Vite in explicit LAN mode with a fresh capability token for every file-writing route (tools/serve-args.ts).
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { serveArgs } from './serve-args';

const plan = serveArgs(process.argv, process.env, () => randomBytes(24).toString('base64url'));
for (const line of plan.banner) console.log(line);
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', plan.args, {
  stdio: 'inherit',
  env: { ...process.env, ...plan.env },
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
