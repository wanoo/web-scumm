// The prerequisite checks of `npm run doctor`, with their probes injected so a test runs them without a machine.
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  /** Needed only for a part of the work (the assets, the audio, a second browser): missing, it is said, not fatal (4.1.6). */
  optional?: boolean;
}
export interface Probes {
  /** Runs a command, returns its stdout and whether it succeeded. */
  command: (cmd: string, args: string[]) => { ok: boolean; stdout: string };
  exists: (path: string) => boolean;
  nodeVersion: string;
  /** Playwright browser name → executable path. */
  browsers: Record<string, string>;
}

/**
 * `--release` (4.1.8): what `npm run release-check` needs, Python and its modules and ffmpeg, is required, not
 * optional: the doctor predicts the release instead of smiling at a machine that cannot make it. Firefox and WebKit
 * stay optional there: release-check opens no browser (the e2e run in CI on every change); Chromium is always required.
 */
export function collectChecks(p: Probes, o: { release?: boolean } = {}): Check[] {
  const checks: Check[] = [];
  const optional = o.release ? {} : { optional: true as const };
  const nodeMajor = Number(p.nodeVersion.split('.')[0]);
  checks.push({ name: 'Node.js', ok: nodeMajor >= 22, detail: p.nodeVersion, fix: 'Install Node.js 22 or newer.' });
  const py = p.command('python3', ['-c', 'import sys; print(sys.version.split()[0])']);
  checks.push({
    name: 'Python',
    ok: py.ok,
    detail: py.ok ? py.stdout.trim() : 'not found',
    fix: 'Install Python 3 to prepare the assets (npm run assets).',
    ...optional,
  });
  const mods = p.command('python3', [
    '-c',
    'import PIL, numpy, scipy; print("Pillow " + PIL.__version__ + ", NumPy " + numpy.__version__ + ", SciPy " + scipy.__version__)',
  ]);
  checks.push({
    name: 'Python image modules',
    ok: mods.ok,
    detail: mods.ok ? mods.stdout.trim() : 'Pillow, NumPy and/or SciPy missing',
    fix: 'Run: python3 -m pip install -r requirements.txt',
    ...optional,
  });
  const ffmpeg = p.command('ffmpeg', ['-version']);
  checks.push({
    name: 'ffmpeg',
    ok: ffmpeg.ok,
    detail: ffmpeg.ok ? ffmpeg.stdout.split('\n')[0] : 'not found',
    fix: 'Install ffmpeg to build audio.',
    ...optional,
  });
  for (const [name, path] of Object.entries(p.browsers)) {
    const ok = p.exists(path);
    checks.push({
      name: `Playwright ${name}`,
      ok,
      detail: ok ? path : 'browser binary missing',
      fix: `Run: npx playwright install ${name.toLowerCase()}`,
      // Chromium runs the e2e and the Studio's checks; the other browsers are the second opinion, and release-check
      // opens none of them.
      ...(name === 'Chromium' ? {} : { optional: true as const }),
    });
  }
  return checks;
}

export function doctorReport(checks: Check[]): { text: string; failed: number; optional: number } {
  const lines = checks.map(
    (c) =>
      `${c.ok ? '✔' : c.optional ? '○' : '✖'}  ${c.name}: ${c.detail}${!c.ok && c.optional ? ' (optional)' : ''}${!c.ok && c.fix ? `\n   ${c.fix}` : ''}`,
  );
  // Only a required prerequisite fails the report: a machine without Python or WebKit develops and plays (4.1.6).
  const failed = checks.filter((c) => !c.ok && !c.optional).length;
  const optional = checks.filter((c) => !c.ok && c.optional).length;
  lines.push(
    '',
    failed
      ? `${failed} prerequisite${failed === 1 ? '' : 's'} missing.`
      : optional
        ? `Development and browser-test prerequisites are ready; ${optional} optional one${optional === 1 ? '' : 's'} missing (assets, audio or a second browser).`
        : 'Development, asset and browser-test prerequisites are ready.',
  );
  return { text: lines.join('\n'), failed, optional };
}
