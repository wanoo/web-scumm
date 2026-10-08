// The speedrun worker's container profile (4.1.17, plan §10.3): one function makes its `docker run` arguments, for a
// configuration's `worker` command and for CI's `worker-container` job (scripts/e2e-worker-container.ts, Linux). No
// network unless asked, and asking says so.
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error: a plain .mjs tool without declarations
import { PIDS_LIMIT, workerContainerArgs } from '../tools/speedrun/container.mjs';

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('the worker container', () => {
  it('no network, a read-only root, a bounded /tmp, no capability, an unprivileged user, limits, its own timeout', () => {
    const a: string[] = workerContainerArgs({ image: 'img', app: '/srv/web-scumm', games: '/srv/games' });
    expect(value(a, '--network')).toBe('none');
    expect(a).toContain('--read-only');
    expect(value(a, '--tmpfs')).toBe('/tmp:rw,size=64m');
    expect(value(a, '--cap-drop')).toBe('ALL');
    expect(value(a, '--security-opt')).toBe('no-new-privileges');
    expect(value(a, '--user')).toBe('65534:65534');
    expect(value(a, '--pids-limit')).toBe(String(PIDS_LIMIT));
    expect(value(a, '--memory')).toBe('512m');
    expect(a.filter((x) => x.endsWith(':ro'))).toEqual(['/srv/web-scumm:/app:ro', '/srv/games:/srv/games:ro']);
    // Only the names the Bridge passes reach the container (never `-e` with a value, never --env-file).
    expect(a.filter((_, i) => a[i - 1] === '-e')).toEqual(['GAME_DIR', 'NODE_OPTIONS']);
    expect(a.slice(a.indexOf('img') + 1, a.indexOf('img') + 5)).toEqual(['timeout', '-s', 'KILL', '70']);
  });

  it('a network only when asked, and said on stderr', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a: string[] = workerContainerArgs({ image: 'img', app: '/a', network: 'bridge' });
    expect(value(a, '--network')).toBe('bridge');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/WITH a network/));
    warn.mockRestore();
    expect(() => workerContainerArgs({ image: '', app: '/a' })).toThrow();
  });
});
