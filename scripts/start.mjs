#!/usr/bin/env node
// npm start (4.1.8): serves dist/ with sirv on every interface at $PORT (8080 by default), what a host such as Clever
// Cloud runs. A Node launcher, not a shell line: `${PORT:-8080}` was a Unix expansion that cmd.exe and PowerShell do
// not know, so `npm start` failed on Windows. sirv's own command reads the arguments from process.argv.
const port = process.env.PORT?.trim() || '8080';
process.argv.splice(2, process.argv.length, 'dist', '--host', '0.0.0.0', '--port', port, '--maxage', '3600');
await import('sirv-cli/bin.js');
