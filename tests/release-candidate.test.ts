// The candidate a tag stands on (4.1.17, plan §4.2): one `candidate` run on one SHA, its terminal gate green, its
// manifest naming that SHA, that run and the SHA-256 of every file the release will publish. A tag names the run;
// release.yml checks the files of that very run. The 4.1.16 tag was published before its first heavy run went red.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATED } from '../tools/mutation-sets';
import {
  buildManifest,
  candidateOf,
  checkManifest,
  judge,
  requiresCandidate,
  tagMessage,
  // @ts-expect-error: a plain .mjs tool without declarations
} from '../tools/release/candidate.mjs';

const dir = mkdtempSync(join(tmpdir(), 'ws-candidate-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const SHA = 'c'.repeat(40);
mkdirSync(join(dir, 'wsrun'), { recursive: true });
writeFileSync(join(dir, 'wsrun', 'run-story.wsrun'), '{"schema":2}');
writeFileSync(join(dir, 'e2e.json'), '{"ok":true}');

describe('the candidate of a release', () => {
  it('is required from 4.1.17 on, pre-releases included', () => {
    expect(requiresCandidate('4.1.16')).toBe(false);
    expect(requiresCandidate('v4.1.16-rc.2')).toBe(false);
    expect(requiresCandidate('4.1.17-rc.1')).toBe(true);
    expect(requiresCandidate('v4.1.17')).toBe(true);
    expect(requiresCandidate('4.2.0')).toBe(true);
    expect(requiresCandidate('5.0.0')).toBe(true);
    expect(() => requiresCandidate('4.1')).toThrow();
  });

  it('is named by the tag, on a line of its own', () => {
    expect(candidateOf(tagMessage('4.1.17-rc.1', '123456'))).toBe('123456');
    expect(candidateOf('4.1.16')).toBeNull();
    expect(candidateOf('4.1.17\n\ncandidate-run: 12x')).toBeNull();
    expect(candidateOf('see candidate-run: 99 later')).toBeNull();
  });

  it('is green only when every job it needs succeeded; skipped or cancelled is red', () => {
    expect(judge({ a: { result: 'success' }, b: { result: 'success' } }).ok).toBe(true);
    const r = judge({ a: { result: 'success' }, heavy: { result: 'skipped' }, m: { result: 'cancelled' } });
    expect(r.ok).toBe(false);
    expect(r.failed.map((f: { job: string }) => f.job)).toEqual(['heavy', 'm']);
    expect(judge({}).ok).toBe(false);
    expect(judge({ a: {} }).ok).toBe(false);
  });

  it('lists every file with its SHA-256, and the release checks them against that run and SHA', () => {
    const m = buildManifest({ sha: SHA, runId: 42, createdAt: '2026-10-08T00:00:00Z', dir });
    expect(m.candidateRunId).toBe('42');
    expect(m.artifacts.map((a: { name: string }) => a.name)).toEqual(['e2e.json', 'wsrun/run-story.wsrun']);
    expect(checkManifest(m, { sha: SHA, runId: '42', dir })).toEqual([]);
    expect(checkManifest(m, { sha: 'd'.repeat(40), runId: '42', dir })[0]).toMatch(/tested c+, not d+/);
    expect(checkManifest(m, { sha: SHA, runId: '43', dir })[0]).toMatch(/run 42's, not 43's/);
    // A file changed, removed or added after the candidate: refused.
    writeFileSync(join(dir, 'e2e.json'), '{"ok":false}');
    expect(checkManifest(m, { sha: SHA, runId: '42', dir })).toEqual([
      "e2e.json: its SHA-256 differs from the candidate's",
    ]);
    writeFileSync(join(dir, 'extra.txt'), 'x');
    rmSync(join(dir, 'wsrun', 'run-story.wsrun'));
    expect(checkManifest(m, { sha: SHA, runId: '42', dir })).toEqual([
      "e2e.json: its SHA-256 differs from the candidate's",
      'wsrun/run-story.wsrun: missing',
      'extra.txt: not in the manifest',
    ]);
    expect(checkManifest({ format: 'other' }, { sha: SHA, runId: '42', dir })).toEqual([
      'not a candidate manifest of schema 1',
    ]);
    expect(() => buildManifest({ sha: 'abc', runId: 1, dir })).toThrow(/full SHA/);
  });
});

describe('the workflows that judge a candidate', () => {
  const wf = (name: string) => readFileSync(`.github/workflows/${name}.yml`, 'utf8');
  const jobs = (text: string) => [...text.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);

  it('run each gated mutation set as a job of its own, never `--set=all` in one process', () => {
    for (const name of ['candidate', 'nightly', 'ci']) {
      const text = wf(name);
      const sets = text
        .match(/^ {8}set: \[([^\]]*)\]$/m)?.[1]
        ?.split(',')
        .map((s) => s.trim());
      expect(sets, name).toEqual(GATED);
      expect(text, name).not.toMatch(/--set=all/);
    }
    // release.yml keeps its own matrix, guarded per set for tags older than a set.
    expect(
      wf('release')
        .match(/^ {8}set: \[([^\]]*)\]$/m)?.[1]
        ?.split(',')
        .map((s) => s.trim()),
    ).toEqual(GATED);
  });

  it('judge every job in the terminal gate, which then writes the manifest', () => {
    const text = wf('candidate');
    const needs = text
      .match(/^ {4}needs: \[([^\]]*)\]$/m)?.[1]
      ?.split(',')
      .map((s) => s.trim());
    expect(needs).toEqual(jobs(text).filter((j) => j !== 'candidate-gate'));
    expect(text).toContain('node tools/release/candidate.mjs gate');
    expect(text).toContain('--run=${{ github.run_id }}');
    expect(text).not.toMatch(/^ {2}push:/m);
  });

  it('measure each store in its own job, and refuse a report of another backend', () => {
    for (const name of ['candidate', 'nightly']) {
      const text = wf(name);
      expect(text, name).toContain('--store=sqlite --out=bridge-load-sqlite.json');
      expect(text, name).toContain('tools/load-report.ts bridge-load-sqlite.json --store=sqlite');
      expect(text, name).toContain('tools/load-report.ts bridge-load-postgres.json --store=postgres');
      expect(text, name).not.toMatch(/BRIDGE_STORE:/);
    }
  });

  it('publish the candidate run the tag names, after checking its sums', () => {
    const text = wf('release');
    expect(text).toContain('node tools/release/candidate.mjs run-of "$TAG"');
    expect(text).toContain('candidate.mjs check .candidate-manifest/candidate-manifest.json --sha="$SHA" --run="$run"');
    expect(text).toContain('actions: read');
    // Only a run started by hand on main: a pull request's run judges its own copy of candidate.yml.
    expect(text).toContain('"candidate completed success workflow_dispatch main"');
    expect(readFileSync('tools/release/ship.mjs', 'utf8')).toMatch(
      /r\.event !== 'workflow_dispatch' \|\| r\.headBranch !== 'main'/,
    );
  });

  it('stay quiet on a pull request without full-ci (no target, no gate, no red check)', () => {
    expect(wf('candidate')).toContain("if: always() && needs.target.result != 'skipped'");
  });
});
