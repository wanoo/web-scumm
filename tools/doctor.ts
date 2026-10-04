// npm run doctor — actionable prerequisites report. It never installs anything.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';

type Check = { name: string; ok: boolean; detail: string; fix?: string };
const checks: Check[] = [];
const command = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' });

const nodeMajor = Number(process.versions.node.split('.')[0]);
checks.push({ name: 'Node.js', ok: nodeMajor >= 22, detail: process.versions.node, fix: 'Install Node.js 22 or newer.' });

const py = command('python3', ['-c', 'import sys; print(sys.version.split()[0])']);
checks.push({ name: 'Python', ok: py.status === 0, detail: py.status === 0 ? py.stdout.trim() : 'not found', fix: 'Install Python 3.' });
const pyModules = command('python3', ['-c', 'import PIL, numpy, scipy; print("Pillow " + PIL.__version__ + ", NumPy " + numpy.__version__ + ", SciPy " + scipy.__version__)']);
checks.push({ name: 'Python image modules', ok: pyModules.status === 0, detail: pyModules.status === 0 ? pyModules.stdout.trim() : 'Pillow, NumPy and/or SciPy missing', fix: 'Run: python3 -m pip install -r requirements.txt' });

const ffmpeg = command('ffmpeg', ['-version']);
checks.push({ name: 'ffmpeg', ok: ffmpeg.status === 0, detail: ffmpeg.status === 0 ? ffmpeg.stdout.split('\n')[0] : 'not found', fix: 'Install ffmpeg to build audio.' });

for (const [name, browser] of Object.entries({ Chromium: chromium, Firefox: firefox, WebKit: webkit })) {
  const path = browser.executablePath();
  checks.push({ name: `Playwright ${name}`, ok: existsSync(path), detail: existsSync(path) ? path : 'browser binary missing', fix: `Run: npx playwright install ${name.toLowerCase()}` });
}

for (const c of checks) console.log(`${c.ok ? '✔' : '✖'}  ${c.name}: ${c.detail}${!c.ok && c.fix ? `\n   ${c.fix}` : ''}`);
const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error(`\n${failed.length} prerequisite${failed.length === 1 ? '' : 's'} missing.`);
  process.exit(1);
}
console.log('\nDevelopment, asset and browser-test prerequisites are ready.');
