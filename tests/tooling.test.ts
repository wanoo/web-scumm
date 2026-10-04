import { describe, expect, it } from 'vitest';
import { collectChecks, doctorReport } from '../tools/doctor-checks';
import { serveArgs } from '../tools/serve-args';
import { releaseNotes } from '../scripts/release-notes.mjs';

describe('doctor', () => {
  const probes = (ok: boolean) => ({
    command: (cmd: string) => ({ ok, stdout: cmd === 'ffmpeg' ? 'ffmpeg version 8.0\nbuilt' : '3.12.7\n' }),
    exists: () => ok, nodeVersion: ok ? '22.14.0' : '18.0.0', browsers: { Chromium: '/x/chromium', WebKit: '/x/webkit' },
  });
  it('reports every prerequisite with a fix when missing', () => {
    const bad = collectChecks(probes(false));
    expect(bad.map((c) => c.name)).toEqual(['Node.js', 'Python', 'Python image modules', 'ffmpeg', 'Playwright Chromium', 'Playwright WebKit']);
    expect(bad.every((c) => !c.ok && c.fix)).toBe(true);
    expect(doctorReport(bad).failed).toBe(6);
    expect(doctorReport(bad).text).toContain('npx playwright install webkit');
  });
  it('is quiet when everything is there', () => {
    const good = collectChecks(probes(true));
    expect(good.every((c) => c.ok)).toBe(true);
    expect(doctorReport(good)).toMatchObject({ failed: 0 });
    expect(good.find((c) => c.name === 'ffmpeg')?.detail).toBe('ffmpeg version 8.0');
  });
});

describe('serve', () => {
  it('loopback by default, a token and a banner on the LAN, the Studio URL carries it', () => {
    expect(serveArgs([], {}, () => 'T')).toMatchObject({ args: ['vite'], env: {}, banner: [] });
    const lan = serveArgs(['--lan', '--studio'], {}, () => 'T');
    expect(lan.args).toEqual(['vite', '--host', '0.0.0.0', '--open', '/__studio/?token=T']);
    expect(lan.env).toEqual({ WEB_SCUMM_LAN: '1', WEB_SCUMM_STUDIO_TOKEN: 'T', STUDIO: '1' });
    expect(lan.banner.join('\n')).toContain('token=T');
    expect(serveArgs(['--lan'], { WEB_SCUMM_STUDIO_TOKEN: 'given' }, () => 'T').token).toBe('given');
  });
});

describe('release notes', () => {
  const log = '# Changelog\n\n## 3.1.0 — 2026-10-05\n\n### Added\n\n- a\n\n## 3.0.0 — 2026-10-04\n\n- b\n';
  it('prints the section of the tag, without its heading', () => {
    expect(releaseNotes(log, 'v3.1.0')).toBe('### Added\n\n- a\n');
    expect(releaseNotes(log, '3.0.0')).toBe('- b\n');
    expect(releaseNotes(log, 'v3.2.0')).toBeNull();
  });
});

describe('e2e: the solver verdict', () => {
  it('accepts only an exit 0, solved, finished run with steps', async () => {
    const { solverResultOk } = await import('../scripts/e2e/util.mjs');
    const good = { status: 'solved', finished: true, steps: [{ start: 'new' }] };
    expect(solverResultOk(good, 0)).toEqual({ ok: true, reason: '' });
    expect(solverResultOk(good, 2).ok).toBe(false);
    expect(solverResultOk(good, null).reason).toContain('without a status');
    expect(solverResultOk({ ...good, status: 'truncated', truncated: true }, 0).reason).toContain('truncated');
    expect(solverResultOk({ ...good, finished: false, status: 'unsolved' }, 0).ok).toBe(false);
    expect(solverResultOk({ ...good, steps: [] }, 0).reason).toContain('no steps');
    expect(solverResultOk(undefined, 0).ok).toBe(false);
  });
});

describe('exit codes of the content tools', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const run = (args: string[], env: Record<string, string> = {}) => spawnSync('npx', ['tsx', ...args], { encoding: 'utf8', env: { ...process.env, GAME: 'demo', ...env } });

  it('lint exits 2 on a truncated proof and says so in its JSON', () => {
    const r = run(['tools/lint.ts', '--prove', '--max=1', '--json']);
    expect(r.status).toBe(2);
    const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
    expect(out).toMatchObject({ mode: 'prove', status: 'truncated', truncated: true });
    expect(out.findings.every((f: { severity: string }) => f.severity !== 'warning')).toBe(true);
  }, 60000);

  it('playtests --strict exits 1 on a session the content outgrew', async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'playtests-'));
    const file = JSON.parse(readFileSync('games/demo/playtests/walkthrough-hesitant.session.json', 'utf8'));
    file.session.log[5].act = { verb: 'use', a: 'key', b: 'pantry' }; // no key yet: not what was recorded, the replay diverges there
    writeFileSync(join(dir, 'diverged.session.json'), JSON.stringify(file));
    expect(run(['tools/playtests.ts', `--dir=${dir}`]).status).toBe(0);
    const strict = run(['tools/playtests.ts', `--dir=${dir}`, '--strict']);
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain('--strict');
  }, 90000);
});

describe('the proof by chapters has one verdict in every output', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const run = (args: string[]) => spawnSync('npx', ['tsx', 'tools/solve.ts', ...args], { encoding: 'utf8', env: { ...process.env, GAME: '', GAME_DIR: 'tests/fixtures/mismatch-game' } });
  it('an unreachable checkpoint fails the text output and --json alike, status checkpoint_mismatch', () => {
    const json = run(['--prove', '--chapters', '--json']);
    expect(json.status).toBe(1);
    expect(JSON.parse(json.stdout.trim().split('\n').pop()!).status).toBe('checkpoint_mismatch');
    const text = run(['--prove', '--chapters']);
    expect(text.status).toBe(1);
    expect(text.stdout).toContain('checkpoint_mismatch');
  }, 60000);
});

