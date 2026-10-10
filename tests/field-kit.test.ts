// The Field Kit (4.1.18, plan §5.5): a report of another candidate, evidence that changed, a `passed` without what a
// reproduction needs, a duplicate, a secret, never make a pass succeed; `not-run`, `blocked` and `failed` are never
// rendered as done; the sheet has its thirteen rows and its counts; a bundle carries only the listed evidence,
// redacted, and refuses a key.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { manualPasses } from '../scripts/release-notes.mjs';
import {
  blankReport,
  type CandidateManifest,
  checkDir,
  MANIFEST,
  main,
  renderPasses,
  sha256,
  stageBundle,
  writePasses,
} from '../tools/field/field';
import { type FieldReport, PASS_IDS } from '../tools/field/schema';
import { hardSecrets, redact, reportLeaks } from '../tools/field/secrets';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'field-kit-'));
  temps.push(d);
  return d;
};

const SHA = 'a'.repeat(40);
const manifest: CandidateManifest = {
  format: 'web-scumm-candidate',
  schema: 1,
  sha: SHA,
  candidateRunId: '42',
  createdAt: '2026-10-10T00:00:00.000Z',
  artifacts: [
    { name: 'web-scumm-4.1.18.tgz', sha256: '1'.repeat(64) },
    { name: 'wsrun/run-story.wsrun', sha256: '2'.repeat(64) },
  ],
};

/** A folder from field:init, then `edit` on the pass it names. */
function folder(edit: Partial<Record<(typeof PASS_IDS)[number], (r: FieldReport, dir: string) => void>> = {}) {
  const dir = tmp();
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest));
  for (const id of PASS_IDS) {
    const r = blankReport(id, '4.1.18', manifest);
    edit[id]?.(r, dir);
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(r, null, 1));
  }
  return dir;
}

/** A pass tried and passed, with its evidence written beside it. */
function passed(r: FieldReport, dir: string, log = 'replayed: valid\n') {
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  writeFileSync(join(dir, 'evidence/run.log'), log);
  Object.assign(r, {
    status: 'passed',
    operator: 'tester-1',
    startedAt: '2026-10-10T09:00:00Z',
    finishedAt: '2026-10-10T09:40:00Z',
    environment: { os: 'iOS 19.1', browser: 'Safari', versions: { engine: '4.1.18' } },
    scenario: 'installed, offline, reload, update',
    evidence: [{ path: 'evidence/run.log', sha256: sha256(log), kind: 'log' }],
  });
}

describe('field:check', () => {
  it('accepts the thirteen reports field:init writes, all not run', () => {
    const { problems, reports } = checkDir(folder());
    expect(problems).toEqual([]);
    expect(reports.map((r) => r.status)).toEqual(PASS_IDS.map(() => 'not-run'));
  });

  it("refuses a report of another commit, another run or another candidate's files", () => {
    const dir = folder({
      'firefox-real-offline': (r) => (r.commit = 'b'.repeat(40)),
      'livesplit-obs': (r) => (r.candidateRun = '43'),
      'voices-listening': (r) => (r.packageDigests['web-scumm-4.1.18.tgz'] = '3'.repeat(64)),
      'blind-playtesters': (r) => delete r.packageDigests['wsrun/run-story.wsrun'],
    });
    const { problems } = checkDir(dir);
    expect(problems).toEqual([
      "blind-playtesters.json: its file digests are not the candidate's",
      'firefox-real-offline.json: tried commit bbbbbbb, the candidate is aaaaaaa',
      'livesplit-obs.json: tried run 43, the candidate is run 42',
      "voices-listening.json: its file digests are not the candidate's",
    ]);
  });

  it('accepts a pass passed with its evidence, refuses one whose evidence is missing or changed', () => {
    expect(checkDir(folder({ 'safari-ios-offline-update': passed })).problems).toEqual([]);
    const changed = folder({ 'safari-ios-offline-update': passed });
    writeFileSync(join(changed, 'evidence/run.log'), 'replayed: valid (edited)\n');
    expect(checkDir(changed).problems).toEqual([
      'safari-ios-offline-update.json: evidence evidence/run.log is not the file it names (SHA-256 differs)',
    ]);
    const gone = folder({ 'safari-ios-offline-update': passed });
    rmSync(join(gone, 'evidence/run.log'));
    expect(checkDir(gone).problems).toEqual(['safari-ios-offline-update.json: evidence evidence/run.log is missing']);
  });

  it('refuses a `passed` without its time, operator, environment, scenario or evidence, and one with a failure', () => {
    for (const [what, edit, want] of [
      ['no evidence', (r: FieldReport) => (r.evidence = []), 'evidence: a pass passed shows its evidence'],
      ['no time', (r: FieldReport) => delete r.startedAt, 'startedAt: a pass tried (passed) says startedAt'],
      ['no scenario', (r: FieldReport) => delete r.scenario, 'scenario: a pass tried (passed) says scenario'],
      ['no operator', (r: FieldReport) => delete r.operator, 'operator: a pass tried (passed) says operator'],
      [
        'no environment',
        (r: FieldReport) => (r.environment = { versions: {} }),
        'environment: a pass tried (passed) says on what (os, browser, device or versions)',
      ],
      [
        'a failure',
        (r: FieldReport) => r.failures.push({ step: 'update', expected: 'new', observed: 'old', reproducible: true }),
        'failures: a pass passed has no failure: it is failed',
      ],
      [
        'ends before it starts',
        (r: FieldReport) => (r.finishedAt = '2026-10-10T08:00:00Z'),
        'finishedAt: it finished before it started',
      ],
    ] as const) {
      const dir = folder({ 'phone-both-renderers': (r, d) => (passed(r, d), edit(r)) });
      expect(checkDir(dir).problems, what).toEqual([`phone-both-renderers.json: ${want}`]);
    }
  });

  it('a failed pass says what failed, a blocked one why, a pass not run has nothing', () => {
    const dir = folder({
      'code-wheel-human': (r, d) => (passed(r, d), (r.status = 'failed')),
      'mystery-deployed': (r, d) => (passed(r, d), (r.status = 'blocked'), (r.evidence = [])),
      'livesplit-obs': (r) => (r.startedAt = '2026-10-10T09:00:00Z'),
    });
    expect(checkDir(dir).problems).toEqual([
      'code-wheel-human.json: failures: a failed pass says what failed',
      'livesplit-obs.json: status: a pass not run has no time, evidence or failure',
      'mystery-deployed.json: notes: a blocked pass says what blocked it (notes)',
    ]);
  });

  it('refuses a field the schema does not name, two reports of one pass, and a missing pass', () => {
    const dir = folder({ 'run-resume-power-cycle': (r) => Object.assign(r, { token: 'x' }) });
    writeFileSync(join(dir, 'again.json'), readFileSync(join(dir, 'livesplit-obs.json')));
    rmSync(join(dir, 'voices-listening.json'));
    expect(checkDir(dir).problems).toEqual([
      'livesplit-obs.json: livesplit-obs is also again.json: one report per pass',
      'run-resume-power-cycle.json: (report): Unrecognized key: "token"',
      'voices-listening: no report',
    ]);
  });

  it('refuses an address, a bearer or a key in a report or in its text evidence', () => {
    const dir = folder({
      'archive-human-install': (r) => (r.notes = 'mail me at ann@example.org'),
      'connectors-real-security': (r, d) =>
        passed(r, d, 'auth: Authorization: Bearer abcdefghijklmnop\n-----BEGIN PRIVATE KEY-----\n'),
    });
    expect(checkDir(dir).problems).toEqual([
      'archive-human-install.json: holds an email address',
      'connectors-real-security.json: evidence evidence/run.log holds a private key',
      'connectors-real-security.json: evidence evidence/run.log holds a bearer',
    ]);
  });

  it('--require names passes that must be passed (a 4.2 gate), and refuses an id that is not a pass', () => {
    const dir = folder({ 'firefox-real-offline': passed });
    expect(checkDir(dir, ['firefox-real-offline']).problems).toEqual([]);
    expect(checkDir(dir, ['safari-ios-offline-update', 'nope']).problems).toEqual([
      'safari-ios-offline-update: required, not passed',
      '--require=nope: not a pass',
    ]);
  });
});

describe('field:report', () => {
  it('writes the thirteen rows and their counts; only `passed` is done for the release notes', () => {
    const dir = folder({
      'firefox-real-offline': passed,
      'code-wheel-human': (r, d) => {
        passed(r, d);
        r.status = 'failed';
        r.failures = [{ step: 'print', expected: 'readable', observed: 'too small', reproducible: true, issue: '#99' }];
      },
      'mystery-deployed': (r) =>
        Object.assign(r, {
          status: 'blocked',
          operator: 'ops',
          startedAt: '2026-10-10T09:00:00Z',
          finishedAt: '2026-10-10T09:05:00Z',
          scenario: 'deploy',
          environment: { os: 'Linux', versions: {} },
          notes: 'no domain yet',
        }),
    });
    const { reports } = checkDir(dir);
    const section = renderPasses(reports, manifest);
    const rows = section.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Pass'));
    expect(rows).toHaveLength(13);
    expect(section).toContain('1 passed, 1 failed, 1 blocked, 10 not run, of 13.');
    expect(rows.find((r) => r.includes('`code-wheel-human`'))).toContain('| failed | tester-1, 2026-10-10 |');
    expect(rows.find((r) => r.includes('`code-wheel-human`'))).toContain('print: too small (#99) |');
    expect(rows.find((r) => r.includes('`mystery-deployed`'))).toContain('| blocked |');
    expect(rows.find((r) => r.includes('`mystery-deployed`'))).toContain('no domain yet |');
    const sheet = writePasses(null, section, '4.1.18');
    expect(manualPasses(sheet)).toContain('1 of 13 done.');
  });

  it("replaces only its block in a sheet, or the sheet's people's passes section; 4.1.17's sheet still reads", () => {
    const old = readFileSync('docs/dev/passes/4.1.17.md', 'utf8');
    expect(manualPasses(old)).toContain('0 of 13 done.');
    const section = renderPasses([], manifest);
    const once = writePasses(old, section, '4.1.17');
    expect(once.startsWith(old.slice(0, old.indexOf("## People's passes")))).toBe(true);
    expect(once).not.toContain('| not done |');
    const again = writePasses(
      `${once}\n## After\n\ntext\n`,
      renderPasses([], { ...manifest, candidateRunId: '7' }),
      '4.1.17',
    );
    expect(again).toContain('candidate run 7');
    expect(again).not.toContain('candidate run 42');
    expect(again).toContain('## After\n\ntext\n');
  });

  it('field:report writes nothing when the reports do not check', () => {
    const dir = folder({ 'livesplit-obs': (r) => (r.commit = 'b'.repeat(40)) });
    const out = join(dir, 'sheet.md');
    expect(main(['report', `--dir=${dir}`, `--out=${out}`])).toBe(1);
    expect(() => readFileSync(out)).toThrow();
    const ok = folder();
    expect(main(['report', `--dir=${ok}`, `--out=${join(ok, 'sheet.md')}`])).toBe(0);
    expect(readFileSync(join(ok, 'sheet.md'), 'utf8')).toContain('0 passed, 0 failed, 0 blocked, 13 not run, of 13.');
  });
});

describe('field:bundle', () => {
  it('carries the report and its evidence, logs redacted, with the SHA-256 of what it carries', () => {
    const dir = folder({
      'bridge-postgres-https': (r, d) =>
        passed(r, d, 'from 203.0.113.7 ops@example.org token=s3cr3tvalue Authorization: Bearer abcdefghijkl\nok\n'),
    });
    const stage = tmp();
    const { files, redacted } = stageBundle(join(dir, 'bridge-postgres-https.json'), stage);
    expect(files).toEqual(['report.json', 'bundle-manifest.json', 'evidence/evidence/run.log']);
    expect(redacted.sort()).toEqual(['a bearer', 'a password or token value', 'an IPv4 address', 'an email address']);
    const log = readFileSync(join(stage, 'evidence/evidence/run.log'), 'utf8');
    expect(log).toBe('from <ip> <email> token=<redacted> Authorization: Bearer <redacted>\nok\n');
    const m = JSON.parse(readFileSync(join(stage, 'bundle-manifest.json'), 'utf8'));
    expect(m).toMatchObject({ passId: 'bridge-postgres-https', commit: SHA, candidateRun: '42' });
    expect(m.files[0]).toMatchObject({ path: 'evidence/evidence/run.log', sha256: sha256(log) });
    expect(m.report).toBe(sha256(readFileSync(join(stage, 'report.json'))));
  });

  it('refuses a key or a token in the evidence, and evidence that is not the file the report names', () => {
    const keyed = folder({ 'bridge-postgres-https': (r, d) => passed(r, d, 'ghp_abcdefghijklmnopqrstuvwxyz0123\n') });
    expect(() => stageBundle(join(keyed, 'bridge-postgres-https.json'), tmp())).toThrow(/a GitHub token: refused/);
    const changed = folder({ 'bridge-postgres-https': passed });
    writeFileSync(join(changed, 'evidence/run.log'), 'other\n');
    expect(() => stageBundle(join(changed, 'bridge-postgres-https.json'), tmp())).toThrow(
      /not the file the report names/,
    );
  });

  it('packs a tar.gz through `tar` (present on Linux, macOS and Windows)', () => {
    const dir = folder({ 'livesplit-obs': passed });
    const out = join(tmp(), 'b.tar.gz');
    expect(main(['bundle', `--report=${join(dir, 'livesplit-obs.json')}`, `--out=${out}`])).toBe(0);
    const list = spawnSync('tar', ['-tzf', out], { encoding: 'utf8' }).stdout;
    expect(list).toContain('bundle-manifest.json');
    expect(list).toContain('evidence/evidence/run.log');
  });
});

describe('the leak scan', () => {
  it('names a secret by its kind, never its value', () => {
    expect(hardSecrets('AKIAABCDEFGHIJKLMNOP')).toEqual(['an AWS access key']);
    expect(hardSecrets('{"kty":"OKP","d":"abcdefghijklmnopqrstuvwxyz"}')).toEqual(['a private JWK']);
    expect(hardSecrets(`${'1'.repeat(64)} ${'a'.repeat(40)}`)).toEqual([]);
    expect(reportLeaks('Basic dXNlcjpwYXNzd29yZA==')).toEqual(['a bearer']);
    expect(redact('nothing here').redacted).toEqual([]);
  });
});

describe('the second reading (4.1.18): what could pass for a pass, or leak', () => {
  it('reads a JSON escape decoded: a token or an address spelt \\u… is found', () => {
    const dir = folder({ 'archive-human-install': (r) => (r.notes = 'x') });
    const f = join(dir, 'archive-human-install.json');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace(
        '"notes": "x"',
        '"notes": "\\u0067hp_abcdefghijklmnopqrstuvwxyz0123 ops\\u0040example.org"',
      ),
    );
    expect(checkDir(dir).problems).toEqual([
      'archive-human-install.json: holds a GitHub token',
      'archive-human-install.json: holds an email address',
    ]);
  });

  it("redacts a secret named inside an identifier, and a URL's credentials", () => {
    const { text } = redact(
      'access_token=abcd1234 DB_PASSWORD=hunter22 clientSecret: s3cr3tv4lue postgres://bridge:pw1234@db:5432/bridge',
    );
    expect(text).toBe(
      'access_token=<redacted> DB_PASSWORD=<redacted> clientSecret: <redacted> postgres://bridge:<redacted>@db:5432/bridge',
    );
  });

  it('takes evidence only from evidence/: not a report, not the manifest, not a link, not an archive', () => {
    const own = folder({
      'firefox-real-offline': (r, d) => {
        passed(r, d);
        r.evidence = [
          { path: 'candidate-manifest.json', sha256: sha256(readFileSync(join(d, MANIFEST))), kind: 'log' },
        ];
      },
    });
    expect(checkDir(own).problems).toEqual([
      'firefox-real-offline.json: evidence candidate-manifest.json lies outside evidence/ (a report or the manifest is not evidence)',
    ]);
    const outside = tmp();
    writeFileSync(join(outside, 'secret.txt'), 'aws_secret_access_key=abcdefgh\n');
    const linked = folder({
      'firefox-real-offline': (r, d) => {
        passed(r, d);
        symlinkSync(join(outside, 'secret.txt'), join(d, 'evidence/link.txt'));
        r.evidence = [
          { path: 'evidence/link.txt', sha256: sha256(readFileSync(join(outside, 'secret.txt'))), kind: 'log' },
        ];
      },
    });
    expect(checkDir(linked).problems).toEqual(['firefox-real-offline.json: evidence evidence/link.txt is a link']);
    const zipped = folder({
      'firefox-real-offline': (r, d) => {
        passed(r, d);
        writeFileSync(join(d, 'evidence/logs.gz'), 'x');
        r.evidence = [{ path: 'evidence/logs.gz', sha256: sha256('x'), kind: 'log' }];
      },
    });
    expect(checkDir(zipped).problems).toEqual([
      'firefox-real-offline.json: evidence evidence/logs.gz is an archive, which cannot be read for a leak',
    ]);
  });

  it('reads any text evidence for a leak, whatever its extension (a .har, a .env)', () => {
    const dir = folder({
      'connectors-real-security': (r, d) => {
        passed(r, d);
        writeFileSync(
          join(d, 'evidence/session.har'),
          '{"headers":[{"name":"Authorization","value":"Bearer abcdefghijkl"}]}',
        );
        r.evidence = [
          { path: 'evidence/session.har', sha256: sha256(readFileSync(join(d, 'evidence/session.har'))), kind: 'har' },
        ];
      },
    });
    expect(checkDir(dir).problems).toEqual([
      'connectors-real-security.json: evidence evidence/session.har holds a bearer',
    ]);
  });

  it('refuses reports of two releases, and a release the candidate did not pack', () => {
    const two = folder({ 'voices-listening': (r) => (r.release = '4.1.19') });
    expect(checkDir(two).problems).toContain('the reports name several releases: 4.1.18, 4.1.19');
    const other = { ...manifest, artifacts: [{ name: 'pack/web-scumm-4.1.17.tgz', sha256: '1'.repeat(64) }] };
    const dir = tmp();
    writeFileSync(join(dir, MANIFEST), JSON.stringify(other));
    for (const id of PASS_IDS) writeFileSync(join(dir, `${id}.json`), JSON.stringify(blankReport(id, '4.1.18', other)));
    expect(checkDir(dir).problems).toEqual(['release 4.1.18: the candidate packed 4.1.17']);
  });

  it("keeps a person's text in its cell: no new row, comment, tag or marker", () => {
    const dir = folder({
      'mystery-deployed': (r) =>
        Object.assign(r, {
          status: 'blocked',
          operator: 'ops',
          startedAt: '2026-10-10T09:00:00Z',
          finishedAt: '2026-10-10T09:05:00Z',
          scenario: 'deploy',
          environment: { os: 'Linux', versions: {} },
          notes: 'a\r| fake | passed | | | |\\| <!-- field:end -->',
        }),
    });
    const section = renderPasses(checkDir(dir).reports, manifest);
    const row = section.split('\n').find((l) => l.includes('`mystery-deployed`'))!;
    expect(row).toContain('a \\| fake \\| passed \\| \\| \\| \\|\\\\\\| &lt;!-- field:end --&gt; |');
    expect(section.split('\n').filter((l) => l.startsWith('| ')).length).toBe(14);
    const sheet = writePasses(null, section, '4.1.18');
    expect(writePasses(sheet.replaceAll('\n', '\r\n'), section, '4.1.18')).not.toContain('\r\r');
    expect(manualPasses(sheet)).toContain('0 of 13 done.');
  });

  it('counts the status column only, in the first table', () => {
    const sheet =
      "## People's passes\n\n| Pass | Status | Who | Env | Failed |\n|---|---|---|---|---|\n| a | passed | | | failed once |\n| b | not-run | | | |\n\n| other | failed |\n";
    expect(manualPasses(sheet)).toContain('1 of 2 done.');
  });
});
