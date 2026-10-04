// The prerequisite checks of `npm run doctor`, with their probes injected so a test runs them without a machine.
export interface Check { name: string; ok: boolean; detail: string; fix?: string }
export interface Probes {
  /** Runs a command, returns its stdout and whether it succeeded. */
  command: (cmd: string, args: string[]) => { ok: boolean; stdout: string };
  exists: (path: string) => boolean;
  nodeVersion: string;
  /** Playwright browser name → executable path. */
  browsers: Record<string, string>;
}

export function collectChecks(p: Probes): Check[] {
  const checks: Check[] = [];
  const nodeMajor = Number(p.nodeVersion.split('.')[0]);
  checks.push({ name: 'Node.js', ok: nodeMajor >= 22, detail: p.nodeVersion, fix: 'Install Node.js 22 or newer.' });
  const py = p.command('python3', ['-c', 'import sys; print(sys.version.split()[0])']);
  checks.push({ name: 'Python', ok: py.ok, detail: py.ok ? py.stdout.trim() : 'not found', fix: 'Install Python 3.' });
  const mods = p.command('python3', ['-c', 'import PIL, numpy, scipy; print("Pillow " + PIL.__version__ + ", NumPy " + numpy.__version__ + ", SciPy " + scipy.__version__)']);
  checks.push({ name: 'Python image modules', ok: mods.ok, detail: mods.ok ? mods.stdout.trim() : 'Pillow, NumPy and/or SciPy missing', fix: 'Run: python3 -m pip install -r requirements.txt' });
  const ffmpeg = p.command('ffmpeg', ['-version']);
  checks.push({ name: 'ffmpeg', ok: ffmpeg.ok, detail: ffmpeg.ok ? ffmpeg.stdout.split('\n')[0] : 'not found', fix: 'Install ffmpeg to build audio.' });
  for (const [name, path] of Object.entries(p.browsers)) {
    const ok = p.exists(path);
    checks.push({ name: `Playwright ${name}`, ok, detail: ok ? path : 'browser binary missing', fix: `Run: npx playwright install ${name.toLowerCase()}` });
  }
  return checks;
}

export function doctorReport(checks: Check[]): { text: string; failed: number } {
  const lines = checks.map((c) => `${c.ok ? '✔' : '✖'}  ${c.name}: ${c.detail}${!c.ok && c.fix ? `\n   ${c.fix}` : ''}`);
  const failed = checks.filter((c) => !c.ok).length;
  lines.push('', failed ? `${failed} prerequisite${failed === 1 ? '' : 's'} missing.` : 'Development, asset and browser-test prerequisites are ready.');
  return { text: lines.join('\n'), failed };
}
