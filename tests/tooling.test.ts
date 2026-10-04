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
