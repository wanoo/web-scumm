// How the queue runs a worker and reads its answer (4.1.17, the `runs` mutation set): a missing command, a process the
// worker left behind, an answer too long or exactly as long as allowed, an answer to another job, a world of the
// wrong shape, a worker stopped by a signal or silent. The fake worker misbehaves as told
// (tests/fixtures/runs-fake-worker.mjs).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runWorker } from '../bridge/src/runs';

const dir = mkdtempSync(join(tmpdir(), 'runs-worker-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const game = {
  dir: resolve('games/reference'),
  fingerprint: { logic: '', trustedExtensions: '', presentation: '', engine: '' },
};
const fake = (...args: string[]) => ({
  worker: [process.execPath, resolve('tests/fixtures/runs-fake-worker.mjs'), ...args],
  timeoutMs: 20_000,
});
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('a worker', () => {
  it('without a command is inconclusive, said', async () => {
    expect(await runWorker({ worker: [] }, game, '{}')).toMatchObject({ verdict: 'inconclusive', code: 'worker' });
  });

  it('that answered is valid, its seed kind kept', async () => {
    expect(await runWorker(fake('ok'), game, '{}')).toMatchObject({ verdict: 'valid', ranked: '100' });
    const w = { hash: 'h', mode: 'remix', seed: 's', leaderboardKey: 'any%' };
    expect(await runWorker(fake('world', JSON.stringify(w)), game, '{}')).toMatchObject({
      seedKind: 'fixed',
      world: w,
    });
  });

  it('leaves nothing behind: its process group goes when it exits', async () => {
    const file = join(dir, 'grandchild.pid');
    expect((await runWorker(fake('grandchild', file), game, '{}')).verdict).toBe('valid');
    const pid = Number(readFileSync(file, 'utf8'));
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((ok) => setTimeout(ok, 20));
    expect(alive(pid)).toBe(false);
  });

  it('may write a million bytes, not one more; an answer that long is read to its end', async () => {
    expect(await runWorker(fake('pad', '1000000'), game, '{}')).toMatchObject({ verdict: 'valid' });
    expect(await runWorker(fake('pad', '1000001'), game, '{}')).toMatchObject({
      verdict: 'inconclusive',
      code: 'crash',
    });
  });

  it('refuses an answer to another job, a world of the wrong shape, and says a signal or silence', async () => {
    expect(await runWorker(fake('other-job'), game, '{}')).toMatchObject({
      verdict: 'inconclusive',
      code: 'signature',
    });
    const at = (w: Record<string, unknown>) =>
      runWorker(
        fake('world', JSON.stringify({ hash: 'h', mode: 'm', seed: 's', leaderboardKey: 'k', ...w })),
        game,
        '{}',
      );
    expect((await at({ seed: 'x'.repeat(200) })).world).toBeDefined();
    expect((await at({ seed: 'x'.repeat(201) })).world).toBeUndefined();
    expect((await at({ mode: 1 })).world).toBeUndefined();
    expect((await at({ validUntil: 1.5 })).world).toBeUndefined();
    expect((await at({ validUntil: 5 })).world).toMatchObject({ validUntil: 5 });
    expect(await runWorker(fake('signal'), game, '{}')).toMatchObject({
      verdict: 'inconclusive',
      code: 'timeout',
      reason: expect.stringContaining('SIGTERM'),
    });
    expect(await runWorker(fake('silent'), game, '{}')).toMatchObject({
      verdict: 'inconclusive',
      code: 'crash',
      reason: expect.stringContaining('exit 3'),
    });
    expect(existsSync(dir)).toBe(true);
  });
});
