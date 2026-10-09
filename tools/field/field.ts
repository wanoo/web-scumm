// npm run field:<command> … (4.1.18 "Dress Rehearsal", docs/dev/PLAN-4.1.18-DRESS-REHEARSAL.md §5): the people's passes
// as data. A pass is one JSON report (tools/field/schema.ts) in a folder that also holds the candidate's manifest; the
// sheet docs/dev/passes/<version>.md is generated from them, never edited by hand into a success.
//
//   field:init   --release=<x.y.z> --candidate=<run id> [--manifest=<candidate-manifest.json>] [--dir=<folder>] [--force]
//                the thirteen reports at `not-run`, bound to the candidate's commit, run and file digests (the manifest is
//                downloaded from the run with `gh` when not given); an existing report is kept unless --force
//   field:check  --dir=<folder> [--require=<passId,…>]
//                every report against the schema, the candidate, its evidence's SHA-256 and the leak scan; --require
//                names passes that must be `passed` (a 4.2 gate; no human pass blocks a 4.1.x tag, D12)
//   field:report --dir=<folder> --out=<sheet.md>
//                the people's passes table, written between `<!-- field:begin -->` and `<!-- field:end -->` (or in place of
//                the sheet's "## People's passes" section, or as a new sheet)
//   field:bundle --report=<report.json> --out=<bundle.tar.gz>
//                the report and only the evidence it lists, logs redacted, refused on a key or a token, with its own
//                SHA-256 manifest: what a reproduction ticket carries
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIELD_STATUSES, type FieldReport, FieldReportSchema, PASS_IDS, PASS_LABELS, type PassId } from './schema';
import { hardSecrets, redact, reportLeaks } from './secrets';

/** The candidate's manifest (tools/release/candidate.mjs): the commit, the run, the digest of each file it judged. */
export interface CandidateManifest {
  format: 'web-scumm-candidate';
  schema: 1;
  sha: string;
  candidateRunId: string;
  createdAt: string;
  artifacts: { name: string; sha256: string }[];
}
export const MANIFEST = 'candidate-manifest.json';
const TEXT = new Set(['.log', '.txt', '.json', '.ndjson', '.md', '.wsrun', '.csv', '.yml', '.yaml', '.html']);

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

export function readManifest(file: string): CandidateManifest {
  const m = JSON.parse(readFileSync(file, 'utf8')) as CandidateManifest;
  if (
    m?.format !== 'web-scumm-candidate' ||
    m.schema !== 1 ||
    !/^[0-9a-f]{40}$/.test(m.sha) ||
    !/^\d+$/.test(m.candidateRunId)
  )
    throw new Error(`${file}: not a candidate manifest of schema 1`);
  return m;
}

/** The digests a report is bound to: every file the candidate judged (its tarballs since 4.1.18, its runs, its reports). */
export const digestsOf = (m: CandidateManifest): Record<string, string> =>
  Object.fromEntries(m.artifacts.map((a) => [a.name, a.sha256]));

/** One pass, not run yet, bound to the candidate. */
export function blankReport(passId: PassId, release: string, m: CandidateManifest): FieldReport {
  return {
    schema: 1,
    passId,
    release,
    commit: m.sha,
    candidateRun: m.candidateRunId,
    packageDigests: digestsOf(m),
    status: 'not-run',
    environment: { versions: {} },
    evidence: [],
    failures: [],
  };
}

const sameDigests = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/** The reports of a folder, by file, as parsed JSON (the manifest and anything not `.json` left out). */
function reportFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== MANIFEST)
    .sort();
}

/**
 * What is wrong with a folder of reports; [] when nothing is. Each report must parse, be the folder candidate's (commit,
 * run, every digest), say nothing a leak scan refuses, and show evidence whose SHA-256 is the one it names; each pass
 * appears exactly once; `require` names passes that must be `passed`.
 */
export function checkDir(dir: string, require: readonly string[] = []): { problems: string[]; reports: FieldReport[] } {
  const problems: string[] = [];
  if (!existsSync(join(dir, MANIFEST)))
    return { problems: [`${dir}: no ${MANIFEST} (npm run field:init)`], reports: [] };
  const m = readManifest(join(dir, MANIFEST));
  const want = digestsOf(m);
  const reports: FieldReport[] = [];
  const seen = new Map<string, string>();
  for (const f of reportFiles(dir)) {
    const raw = readFileSync(join(dir, f), 'utf8');
    for (const leak of reportLeaks(raw)) problems.push(`${f}: holds ${leak}`);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      problems.push(`${f}: not JSON`);
      continue;
    }
    // The pass a file is for counts before its schema: an invalid report is not also a missing one.
    const id = (json as { passId?: unknown })?.passId;
    if (typeof id === 'string') {
      if (seen.has(id)) problems.push(`${f}: ${id} is also ${seen.get(id)}: one report per pass`);
      else seen.set(id, f);
    }
    const parsed = FieldReportSchema.safeParse(json);
    if (!parsed.success) {
      for (const i of parsed.error.issues) problems.push(`${f}: ${i.path.join('.') || '(report)'}: ${i.message}`);
      continue;
    }
    const r = parsed.data;
    if (r.commit !== m.sha)
      problems.push(`${f}: tried commit ${r.commit.slice(0, 7)}, the candidate is ${m.sha.slice(0, 7)}`);
    if (r.candidateRun !== m.candidateRunId)
      problems.push(`${f}: tried run ${r.candidateRun}, the candidate is run ${m.candidateRunId}`);
    if (!sameDigests(r.packageDigests, want)) problems.push(`${f}: its file digests are not the candidate's`);
    for (const e of r.evidence) {
      const p = join(dir, e.path);
      if (!existsSync(p)) {
        problems.push(`${f}: evidence ${e.path} is missing`);
        continue;
      }
      const b = readFileSync(p);
      if (sha256(b) !== e.sha256) problems.push(`${f}: evidence ${e.path} is not the file it names (SHA-256 differs)`);
      if (TEXT.has(extname(p).toLowerCase()))
        for (const leak of reportLeaks(b.toString('utf8'))) problems.push(`${f}: evidence ${e.path} holds ${leak}`);
    }
    reports.push(r);
  }
  for (const id of PASS_IDS) if (!seen.has(id)) problems.push(`${id}: no report`);
  for (const id of require) {
    if (!(PASS_IDS as readonly string[]).includes(id)) problems.push(`--require=${id}: not a pass`);
    else if (reports.find((r) => r.passId === id)?.status !== 'passed') problems.push(`${id}: required, not passed`);
  }
  return { problems, reports };
}

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** The people's passes table of a sheet, from the reports, in the order of PASS_IDS. */
export function renderPasses(reports: readonly FieldReport[], m: CandidateManifest): string {
  const by = new Map(reports.map((r) => [r.passId, r]));
  const count = Object.fromEntries(FIELD_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  const rows = PASS_IDS.map((id) => {
    const r = by.get(id);
    const status = r?.status ?? 'not-run';
    count[status]++;
    const env = r
      ? [r.environment.deviceFamily, r.environment.deviceModel, r.environment.os, r.environment.browser]
          .concat(Object.entries(r.environment.versions).map(([k, v]) => `${k} ${v}`))
          .filter(Boolean)
          .join(', ')
      : '';
    const who = r?.operator ? `${r.operator}, ${r.startedAt?.slice(0, 10) ?? ''}` : '';
    const failed = r?.failures.map((x) => `${x.step}: ${x.observed}${x.issue ? ` (${x.issue})` : ''}`).join('; ');
    return `| ${PASS_LABELS[id]} (\`${id}\`) | ${status} | ${cell(who)} | ${cell(env)} | ${cell(failed || (status === 'blocked' ? r?.notes : ''))} |`;
  });
  return [
    "## People's passes",
    '',
    `Generated by \`npm run field:report\` from the reports of candidate run ${m.candidateRunId} (commit \`${m.sha.slice(0, 7)}\`):`,
    `${count.passed} passed, ${count.failed} failed, ${count.blocked} blocked, ${count['not-run']} not run, of ${PASS_IDS.length}.`,
    'Only `passed` qualifies a surface (D18); a pass of another commit no longer counts.',
    '',
    '| Pass | Status | Who, when | Device, OS, browser, versions | What failed |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

const BEGIN = '<!-- field:begin -->';
const END = '<!-- field:end -->';

/** The sheet with its people's passes replaced: between the markers, else the section, else appended. */
export function writePasses(sheet: string | null, section: string, release: string): string {
  const block = `${BEGIN}\n${section}${END}\n`;
  if (sheet === null) return `# Passes, ${release}\n\n${block}`;
  const b = sheet.indexOf(BEGIN);
  const e = sheet.indexOf(END);
  if (b >= 0 && e > b) return sheet.slice(0, b) + block + sheet.slice(e + END.length + 1);
  const h = sheet.indexOf("## People's passes");
  if (h < 0) return `${sheet.trimEnd()}\n\n${block}`;
  const next = sheet.indexOf('\n## ', h + 1);
  return sheet.slice(0, h) + block + (next < 0 ? '' : sheet.slice(next + 1));
}

/**
 * A reproduction bundle: the report and the evidence it lists, text redacted (addresses, bearers, password values,
 * IPs), refused when a key or a token remains, each file's SHA-256 in `bundle-manifest.json`. Returns the staging
 * folder (the caller packs it).
 */
export function stageBundle(reportFile: string, into: string): { files: string[]; redacted: string[] } {
  const dir = dirname(reportFile);
  const r = FieldReportSchema.parse(JSON.parse(readFileSync(reportFile, 'utf8')));
  const leaks = reportLeaks(readFileSync(reportFile, 'utf8'));
  if (leaks.length) throw new Error(`${basename(reportFile)} holds ${leaks.join(', ')}: refused`);
  const files: { path: string; sha256: string; source: string; redacted: string[] }[] = [];
  const redacted = new Set<string>();
  for (const e of r.evidence) {
    const src = readFileSync(join(dir, e.path));
    if (sha256(src) !== e.sha256) throw new Error(`evidence ${e.path} is not the file the report names`);
    let out: Buffer = src;
    let cut: string[] = [];
    if (TEXT.has(extname(e.path).toLowerCase())) {
      const text = src.toString('utf8');
      const hard = hardSecrets(text);
      if (hard.length) throw new Error(`evidence ${e.path} holds ${hard.join(', ')}: refused, never bundled`);
      const red = redact(text);
      out = Buffer.from(red.text);
      cut = red.redacted;
    } else if (hardSecrets(src.toString('latin1')).length) {
      throw new Error(`evidence ${e.path} holds a key or a token: refused, never bundled`);
    }
    for (const k of cut) redacted.add(k);
    const to = join(into, 'evidence', e.path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, out);
    files.push({ path: `evidence/${e.path}`, sha256: sha256(out), source: e.sha256, redacted: cut });
  }
  writeFileSync(join(into, 'report.json'), `${JSON.stringify(r, null, 1)}\n`);
  const manifest = {
    format: 'web-scumm-field-bundle',
    schema: 1,
    passId: r.passId,
    commit: r.commit,
    candidateRun: r.candidateRun,
    report: sha256(readFileSync(join(into, 'report.json'))),
    files,
  };
  writeFileSync(join(into, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  return { files: ['report.json', 'bundle-manifest.json', ...files.map((f) => f.path)], redacted: [...redacted] };
}

const flag = (args: string[], k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

export function main(args: string[]): number {
  const [cmd] = args;
  if (cmd === 'init') {
    const release = flag(args, 'release');
    const run = flag(args, 'candidate');
    if (!release || !run) throw new Error('field:init --release=<x.y.z> --candidate=<run id>');
    const dir = resolve(flag(args, 'dir') ?? `.cache/field/${release}`);
    mkdirSync(dir, { recursive: true });
    let manifestFile = flag(args, 'manifest');
    if (!manifestFile) {
      const tmp = mkdtempSync(join(tmpdir(), 'field-manifest-'));
      const r = spawnSync('gh', ['run', 'download', run, '-n', 'candidate-manifest', '-D', tmp], { stdio: 'inherit' });
      if (r.status !== 0)
        throw new Error(`the manifest of run ${run} could not be downloaded (--manifest= to give it)`);
      manifestFile = join(tmp, MANIFEST);
    }
    const m = readManifest(manifestFile);
    if (m.candidateRunId !== run) throw new Error(`the manifest is run ${m.candidateRunId}'s, not ${run}'s`);
    writeFileSync(join(dir, MANIFEST), readFileSync(manifestFile));
    let made = 0;
    for (const id of PASS_IDS) {
      const f = join(dir, `${id}.json`);
      if (existsSync(f) && !args.includes('--force')) continue;
      writeFileSync(f, `${JSON.stringify(blankReport(id, release, m), null, 1)}\n`);
      made++;
    }
    console.log(`✔  ${dir}: ${made} report(s) written at not-run, bound to ${m.sha.slice(0, 7)} (run ${run})`);
    return 0;
  }
  if (cmd === 'check') {
    const dir = resolve(flag(args, 'dir') ?? '.');
    const require = (flag(args, 'require') ?? '').split(',').filter(Boolean);
    const { problems, reports } = checkDir(dir, require);
    for (const p of problems) console.error(`  ✖ ${p}`);
    const passed = reports.filter((r) => r.status === 'passed').length;
    if (problems.length) {
      console.error(`✖  field:check: ${problems.length} problem(s) in ${dir}`);
      return 1;
    }
    console.log(`✔  field:check: ${reports.length} reports agree with their candidate; ${passed} passed`);
    return 0;
  }
  if (cmd === 'report') {
    const dir = resolve(flag(args, 'dir') ?? '.');
    const out = flag(args, 'out');
    if (!out) throw new Error('field:report --dir=<folder> --out=<sheet.md>');
    const { problems, reports } = checkDir(dir);
    if (problems.length) {
      for (const p of problems) console.error(`  ✖ ${p}`);
      console.error('✖  field:report: the reports do not check (npm run field:check); nothing written');
      return 1;
    }
    const m = readManifest(join(dir, MANIFEST));
    const release = reports[0]?.release ?? 'unknown';
    writeFileSync(
      out,
      writePasses(existsSync(out) ? readFileSync(out, 'utf8') : null, renderPasses(reports, m), release),
    );
    console.log(`✔  ${out}: the people's passes written from ${reports.length} reports`);
    return 0;
  }
  if (cmd === 'bundle') {
    const report = flag(args, 'report');
    const out = flag(args, 'out');
    if (!report || !out) throw new Error('field:bundle --report=<report.json> --out=<bundle.tar.gz>');
    const stage = mkdtempSync(join(tmpdir(), 'field-bundle-'));
    try {
      const { files, redacted } = stageBundle(resolve(report), stage);
      const r = spawnSync('tar', ['-czf', resolve(out), '-C', stage, '.'], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('tar failed');
      console.log(`✔  ${out}: ${files.length} files${redacted.length ? `, redacted: ${redacted.join(', ')}` : ''}`);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
    return 0;
  }
  console.error('npm run field:<init|check|report|bundle> -- … (tools/field/field.ts)');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`✖  ${(e as Error).message}`);
    process.exit(1);
  }
}
