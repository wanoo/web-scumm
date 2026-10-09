// `web-scumm bridge serve` mounts the leaderboards and the daily challenge from its configuration (4.1.16): a `runs` and
// a `daily` section, on a SQL store, give `/v1/runs` and `/v1/daily`; the same sections on the JSON-lines journal are
// refused before anything listens (their records need SQL).
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { realityManifest } from '@engine/reality/manifest';
import { signals } from './fixtures/signals';
import { SqlRunStore, type RunRecord } from '../bridge/src/runs-store';
import { SqliteRealityStore } from '../bridge/src/store-sqlite';

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

describe('bridge serve moderates with the token of runs.adminTokenFile (4.1.17)', () => {
  const run = (tenantId: string, id: string, trust: RunRecord['trust']): RunRecord => ({
    id,
    tenantId,
    gameId: 'reference',
    categoryId: 'any%',
    player: 'Lou',
    submittedAt: 1,
    status: 'done',
    verdict: trust === 'local' ? 'invalid-replay' : 'valid',
    trust,
    ranked: trust === 'local' ? null : '100',
    runKey: `k-${id}`,
    deleteTokenHash: '0'.repeat(64),
    envelope: '',
  });
  const quiet = async <T>(f: (lines: string[], errs: string[]) => Promise<T>) => {
    const lines: string[] = [];
    const errs: string[] = [];
    const [log, err] = [console.log, console.error];
    console.log = (x: unknown) => void lines.push(String(x));
    console.error = (x: unknown) => void errs.push(String(x));
    try {
      return await f(lines, errs);
    } finally {
      console.log = log;
      console.error = err;
    }
  };

  it('401 without the bearer or with another, 200 with it on a verified run, 409 on an unverified one, 404 across tenants; counted', async () => {
    const { main } = await import('../bridge/src/cli');
    const token = randomBytes(24).toString('base64url');
    const dir = await initDir({ ...SECTIONS, runs: { ...SECTIONS.runs, adminTokenFile: 'runs-admin' } });
    writeFileSync(join(dir, 'runs-admin'), `${token}\n`, { mode: 0o600 });
    const tenant = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).tenantId ?? 'default';
    const file = join(dir, 'bridge.sqlite');
    const s = await SqliteRealityStore.open(file, { pollMs: 0 });
    const store = new SqlRunStore(s.db);
    await store.create(run(tenant, 'run_ok', 'replay-valid'));
    await store.create(run(tenant, 'run_local', 'local'));
    await store.create(run('elsewhere', 'run_other', 'replay-valid'));
    await s.close();
    await quiet(async (lines) => {
      const serving = main(['serve', `--dir=${dir}`, `--store=sqlite:${file}`, '--port=0']);
      for (let i = 0; i < 200 && !lines.some((l) => l.includes('bridge.listening')); i++)
        await new Promise((r) => setTimeout(r, 25));
      const url = JSON.parse(lines.find((l) => l.includes('bridge.listening'))!).url as string;
      const moderate = (id: string, bearer?: string) =>
        fetch(`${url}v1/runs/${id}/moderate`, {
          method: 'POST',
          headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
        });
      expect((await moderate('run_ok')).status).toBe(401);
      expect((await moderate('run_ok', `${token}x`)).status).toBe(401);
      expect((await moderate('run_ok', token.slice(1))).status).toBe(401);
      const ok = await moderate('run_ok', token);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { trust: string }).trust).toBe('moderator-verified');
      expect((await moderate('run_local', token)).status).toBe(409);
      expect((await moderate('run_other', token)).status).toBe(404);
      const health = (await (await fetch(`${url}healthz`)).json()) as { moderation: unknown };
      expect(health.moderation).toEqual({ accepted: 1, refused: 3 });
      // The audit says what was refused and why, never the bearer.
      const audit = lines.filter((l) => l.includes('run.moderation-refused'));
      expect(audit).toHaveLength(3);
      expect(audit.join('\n')).not.toContain(token.slice(0, 12));
      process.emit('SIGTERM');
      expect(await serving).toBe(0);
    });
  }, 30_000);

  it('refuses to start on a missing, short or world-readable token file', async () => {
    const { main } = await import('../bridge/src/cli');
    for (const [what, write, why] of [
      ['missing', () => {}, /does not exist/],
      ...(process.platform === 'win32'
        ? []
        : ([
            [
              'open to others',
              (f: string) => (writeFileSync(f, 'x'.repeat(40)), chmodSync(f, 0o620)),
              /open to others/,
            ],
          ] as const)),
      ['short', (f: string) => writeFileSync(f, 'short', { mode: 0o600 }), /fewer than 32/],
    ] as const) {
      const dir = await initDir({ ...SECTIONS, runs: { ...SECTIONS.runs, adminTokenFile: 'runs-admin' } });
      write(join(dir, 'runs-admin'));
      await quiet(async (_, errs) => {
        expect(
          await main(['serve', `--dir=${dir}`, `--store=sqlite:${join(dir, 'bridge.sqlite')}`, '--port=0']),
          what,
        ).toBe(1);
        expect(errs.join('\n'), what).toMatch(why);
      });
    }
  });
});
