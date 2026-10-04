// npm run doctor — actionable prerequisites report. It never installs anything. The checks live in doctor-checks.ts.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { collectChecks, doctorReport } from './doctor-checks';

const checks = collectChecks({
  command: (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { ok: r.status === 0, stdout: r.stdout ?? '' }; },
  exists: existsSync,
  nodeVersion: process.versions.node,
  browsers: { Chromium: chromium.executablePath(), Firefox: firefox.executablePath(), WebKit: webkit.executablePath() },
});
const { text, failed } = doctorReport(checks);
(failed ? console.error : console.log)(text);
process.exit(failed ? 1 : 0);
