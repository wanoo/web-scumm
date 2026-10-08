// `web-scumm bridge serve` mounts the leaderboards and the daily challenge from its configuration (4.1.16): a `runs` and
// a `daily` section, on a SQL store, give `/v1/runs` and `/v1/daily`; the same sections on the JSON-lines journal are
// refused before anything listens (their records need SQL).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { realityManifest } from '@engine/reality/manifest';
import { signals } from './fixtures/signals';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const fixture = JSON.parse(readFileSync('tests/fixtures/reference-daily-key.json', 'utf8'));

async function initDir(sections: Record<string, unknown>): Promise<string> {
  const { main } = await import('../bridge/src/cli');
  const dir = mkdtempSync(join(tmpdir(), 'bridge-serve-runs-'));
  temps.push(dir);
  expect(await main(['init', `--dir=${dir}`, '--no-demo-webhooks'], { manifest: realityManifest(signals()) })).toBe(0);
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...sections }));
  writeFileSync(join(dir, 'daily.jwk'), JSON.stringify(fixture.jwk), { mode: 0o600 });
  writeFileSync(join(dir, 'daily.secret'), 'a secret of days\n', { mode: 0o600 });
  return dir;
}
const SECTIONS = {
  runs: {
    games: {
      reference: {
        dir: resolve('games/reference'),
        fingerprint: { logic: 'l', trustedExtensions: 't', presentation: 'p', engine: 'e' },
      },
    },
    worker: [process.execPath, '-e', 'process.exit(0)'],
    workers: 1,
  },
  daily: {
    games: { reference: { daily: 'daily', mystery: 'mystery' } },
    kid: fixture.kid,
    keyFile: 'daily.jwk',
    secretFile: 'daily.secret',
  },
};

describe('bridge serve with runs and daily sections', () => {
  it('on SQLite: /v1/daily signs the day, /v1/runs takes a run and answers a leaderboard', async () => {
    const { main } = await import('../bridge/src/cli');
    const dir = await initDir(SECTIONS);
    const lines: string[] = [];
    const log = console.log;
    console.log = (x: unknown) => void lines.push(String(x));
    try {
      const serving = main(['serve', `--dir=${dir}`, `--store=sqlite:${join(dir, 'bridge.sqlite')}`, '--port=0']);
      for (let i = 0; i < 200 && !lines.some((l) => l.includes('bridge.listening')); i++)
        await new Promise((r) => setTimeout(r, 25));
      const url = JSON.parse(lines.find((l) => l.includes('bridge.listening'))!).url as string;
      const day = await fetch(`${url}v1/daily?game=reference`);
      expect(day.status).toBe(200);
      expect(((await day.json()) as { token: string }).token.split('.')).toHaveLength(3);
      expect((await fetch(`${url}v1/daily?game=reference&date=2026-02-30`)).status).toBe(400);
      const board = await fetch(`${url}v1/runs?game=reference&category=any%25`);
      expect(board.status).toBe(200);
      expect(await board.json()).toEqual({ runs: [] });
      const bad = await fetch(`${url}v1/runs`, {
        method: 'POST',
        body: JSON.stringify({ player: 'Lou', envelope: '{' }),
      });
      expect(bad.status).toBe(400);
      process.emit('SIGTERM');
      expect(await serving).toBe(0);
    } finally {
      console.log = log;
    }
  }, 30_000);

  it('on the JSON-lines journal: refused, nothing listens', async () => {
    const { main } = await import('../bridge/src/cli');
    const dir = await initDir(SECTIONS);
    const errs: string[] = [];
    const err = console.error;
    console.error = (x: unknown) => void errs.push(String(x));
    try {
      expect(await main(['serve', `--dir=${dir}`, '--port=0'])).toBe(1);
      expect(errs.join('\n')).toMatch(/keep their records in SQL/);
    } finally {
      console.error = err;
    }
  });
});
