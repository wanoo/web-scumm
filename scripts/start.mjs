#!/usr/bin/env node
// npm start (4.1.8): serves dist/ with sirv on every interface at $PORT (8080 by default), what a host such as Clever
// Cloud runs. A Node launcher, not a shell line: `${PORT:-8080}` was a Unix expansion that cmd.exe and PowerShell do
// not know, so `npm start` failed on Windows. sirv-cli exports only its package.json: its command is found from it.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv-cli/package.json' with { type: 'json' };

const port = process.env.PORT?.trim() || '8080';
const bin = join(dirname(fileURLToPath(import.meta.resolve('sirv-cli/package.json'))), sirv.bin.sirv);
const child = spawn(process.execPath, [bin, 'dist', '--host', '0.0.0.0', '--port', port, '--maxage', '3600'], {
  stdio: 'inherit',
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
