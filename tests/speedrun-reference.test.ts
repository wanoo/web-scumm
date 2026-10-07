// A complete attempt on the reference chapter (4.1.14 "Time Attack"): its `.wsrun`, committed under
// tests/fixtures/speedrun/ by tools/speedrun/reference-run.ts, is verified by `npm run speedrun:verify` as the release
// workflow does before attaching it to the release (its ninth asset). A run is bound to its engine version and its
// game's fingerprint: after `npm version` or a change of the reference game's logic, regenerate it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTool } from './run-tool';

const FILE = 'tests/fixtures/speedrun/reference-any.wsrun';

describe('the reference run', () => {
  it('is a complete Any% attempt with its splits, verified valid by speedrun:verify', () => {
    const env = JSON.parse(readFileSync(FILE, 'utf8'));
    expect(env).toMatchObject({
      format: 'web-scumm-speedrun',
      schema: 1,
      gameId: 'reference',
      categoryId: 'any%',
      trust: 'local',
    });
    expect(env.splits.every((s: { entry: number | null }) => s.entry !== null)).toBe(true);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(env.engineVersion, 'regenerate it: npx tsx tools/speedrun/reference-run.ts').toBe(pkg.version);
    const r = runTool(['tools/speedrun/verify.ts', FILE, '--json'], { env: { ...process.env, GAME: 'reference' } });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
    expect(out).toMatchObject({ verdict: 'valid', code: 'ok', trust: 'replay-valid' });
    expect(out.recomputed.finalProof).toBe(env.finalProof);
  }, 120000);

  it('an altered copy is refused, with its reason and exit code 1', () => {
    const env = JSON.parse(readFileSync(FILE, 'utf8'));
    env.timing.logicalTime = '1';
    const dir = mkdtempSync(join(tmpdir(), 'speedrun-'));
    const tmp = join(dir, 'altered.wsrun');
    writeFileSync(tmp, JSON.stringify(env));
    let r: ReturnType<typeof runTool>;
    try {
      r = runTool(['tools/speedrun/verify.ts', tmp], { env: { ...process.env, GAME: 'reference' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/invalid-replay \(time-mismatch\)/);
  }, 120000);
});
