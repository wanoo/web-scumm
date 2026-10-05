// The release gate fails on each defect it exists for (LOG #40): a game without provenance, a placeholder nobody
// excepted, a translation whose lines have no stable id. Each case is the clean fixture with one thing broken, run
// through the real CLI (`validate --release`, the first step of `verify:release`).
import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CLEAN = 'tests/fixtures/release-game';
const made: string[] = [];
/** A sibling copy of the clean fixture (its relative imports keep working), changed by `edit`. */
const variant = (name: string, edit: (dir: string) => void) => {
  const dir = `tests/fixtures/release-tmp-${name}`;
  rmSync(dir, { recursive: true, force: true });
  cpSync(CLEAN, dir, { recursive: true });
  made.push(dir);
  edit(dir);
  return dir;
};
const release = (dir: string) =>
  spawnSync('npx', ['tsx', 'tools/validate.ts', '--release'], {
    encoding: 'utf8',
    env: { ...process.env, GAME: '', GAME_DIR: dir, ASSETS_DIR: join(dir, 'assets') },
  });
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('the release gate', () => {
  it('lets the clean fixture through, and release-check runs it', () => {
    expect(release(CLEAN).status).toBe(0);
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['verify:release']).toContain('validate -- --release');
    expect(scripts['release-check']).toContain('npm run verify:release');
  }, 60000);

  it('fails a game without provenance', () => {
    const r = release(variant('noprov', (d) => rmSync(join(d, 'provenance.json'))));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('provenance.json › missing');
  }, 60000);

  it('fails a placeholder that no release exception names', () => {
    const dir = variant('placeholder', (d) =>
      writeFileSync(
        join(d, 'provenance.json'),
        JSON.stringify({ assets: [{ match: 'img:*', source: 'x', licence: 'MIT', status: 'placeholder' }] }),
      ),
    );
    const r = release(dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('a placeholder would ship');
    writeFileSync(
      join(dir, 'provenance.json'),
      JSON.stringify({
        licences: { allow: ['MIT'] },
        assets: [{ match: 'img:*', source: 'x', licence: 'MIT', status: 'placeholder' }],
        releaseExceptions: [{ match: 'img:*', reason: 'a test' }],
      }),
    );
    // the status is a claim the lock recorded as `final`: it changed since the review
    expect(release(dir).stdout).toContain('its provenance entry changed since the review');
    const lock = JSON.parse(readFileSync(join(dir, 'provenance.lock.json'), 'utf8'));
    for (const a of Object.values(lock.assets) as { status: string }[]) a.status = 'placeholder';
    writeFileSync(join(dir, 'provenance.lock.json'), JSON.stringify(lock));
    expect(release(dir).status).toBe(0);
  }, 60000);

  it('fails a game translated into one other language whose lines have no id (no source-language file needed)', () => {
    const r = release(
      variant('translated', (d) => {
        mkdirSync(join(d, 'locales'), { recursive: true });
        writeFileSync(join(d, 'locales', 'fr.json'), JSON.stringify({ _: 'test' }));
        // back to the base fixture: its lines have no ids
        writeFileSync(
          join(d, 'index.ts'),
          "export { game, layouts, manifest, minigames } from '../../fixture/index';\n",
        );
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/no stable id/);
  }, 60000);

  it('fails a file that is not the one reviewed, a new one, and a missing lock', () => {
    const changed = release(
      variant('changed', (d) => writeFileSync(join(d, 'assets', 'img', 'items', 'key.webp'), 'another key\n')),
    );
    expect(changed.status).toBe(1);
    expect(changed.stdout).toContain('img:items/key: the file changed since its provenance was reviewed');
    const nolock = release(variant('nolock', (d) => rmSync(join(d, 'provenance.lock.json'))));
    expect(nolock.status).toBe(1);
    expect(nolock.stdout).toContain('provenance.lock.json › missing');
  }, 60000);

  it('fails a licence outside the policy, and a game without a policy', () => {
    const outside = release(
      variant('licence', (d) => {
        const p = JSON.parse(readFileSync(join(d, 'provenance.json'), 'utf8'));
        p.licences.allow = ['CC BY 4.0'];
        writeFileSync(join(d, 'provenance.json'), JSON.stringify(p));
      }),
    );
    expect(outside.status).toBe(1);
    expect(outside.stdout).toContain('MIT: not in licences.allow (CC BY 4.0), used by 14 asset(s)');
    const none = release(
      variant('nopolicy', (d) => {
        const p = JSON.parse(readFileSync(join(d, 'provenance.json'), 'utf8'));
        delete p.licences;
        writeFileSync(join(d, 'provenance.json'), JSON.stringify(p));
      }),
    );
    expect(none.status).toBe(1);
    expect(none.stdout).toContain('a release says which licences may ship');
  }, 60000);
});
