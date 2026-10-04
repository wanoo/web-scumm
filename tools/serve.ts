// Starts Vite in explicit LAN mode with a fresh capability token for every file-writing route.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const lan = process.argv.includes('--lan');
const studio = process.argv.includes('--studio');
const token = process.env.WEB_SCUMM_STUDIO_TOKEN || randomBytes(24).toString('base64url');
const args = ['vite'];
if (lan) args.push('--host', '0.0.0.0');
if (studio) args.push('--open', lan ? `/__studio/?token=${token}` : '/__studio/');
if (lan) {
  console.log('\nLAN write access is protected by this one-session token:');
  console.log(`  ${token}`);
  console.log(`Studio: http://<this-machine>:5173/__studio/?token=${token}`);
  console.log(`Layout editor: http://<this-machine>:5173/?edit=<room>&token=${token}\n`);
}
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  stdio: 'inherit', env: { ...process.env, ...(lan ? { WEB_SCUMM_LAN: '1', WEB_SCUMM_STUDIO_TOKEN: token } : {}), ...(studio ? { STUDIO: '1' } : {}) },
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 1); });
