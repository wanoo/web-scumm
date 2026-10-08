#!/usr/bin/env node
// node tools/release/candidate.mjs <command> … (4.1.17, docs/dev/PLAN-4.1.17-STABILIZATION.md §4.2): the candidate a
// tag stands on. `candidate.yml`, started by hand on one SHA, runs every heavy family as its own job; its terminal job
// `candidate-gate` judges them all and writes `candidate-manifest.json` — the SHA it tested, its own run id, and the
// SHA-256 of every file it produced for the release. A tag names that run (`candidate-run: <id>` in its annotation,
// written by `ship tag --candidate=<id>`); release.yml downloads the files of that very run and checks every sum
// before it publishes them. Several runs may exist for one SHA: the tag names one, never "the last green".
//
//   gate                                   judge the jobs (`NEEDS`: the JSON of `toJSON(needs)`); a job not `success` fails
//   manifest --sha= --run= --dir= --out=   write the manifest of every file under --dir
//   check <manifest> --sha= --run= --dir=  the manifest is this SHA's and this run's, and every file under --dir matches it
//   run-of <tag>                           the candidate run a local annotated tag names (empty when none)
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { versionOf } from './lib.mjs';

/** The first release whose tags must name a candidate run; older tags were published without one. */
export const FIRST = '4.1.17';

const parts = (v) => v.split('-')[0].split('.').map(Number);
const atLeast = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

/** Whether a tag of `version` (pre-releases included) must name its candidate run. */
export const requiresCandidate = (version) => atLeast(versionOf(version), FIRST);

/** The run id a tag's annotation names (`candidate-run: <digits>` on a line of its own), or null. */
export const candidateOf = (message) => message.match(/^candidate-run: (\d+)$/m)?.[1] ?? null;

/** A tag's annotation: the version, then the candidate run it stands on. */
export const tagMessage = (version, runId) => `${version}\n\ncandidate-run: ${runId}\n`;

/** The verdict of the jobs a gate needs: every one `success`; a skipped or cancelled job is a failure, said. */
export function judge(needs) {
  const rows = Object.entries(needs).map(([job, n]) => ({ job, result: n?.result ?? 'missing' }));
  const failed = rows.filter((r) => r.result !== 'success');
  return { ok: rows.length > 0 && failed.length === 0, rows, failed };
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Every file under `dir`, as paths relative to it (sorted, `/` separators). */
export function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** The manifest of a candidate run. */
export function buildManifest({ sha, runId, createdAt = new Date().toISOString(), dir }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full SHA: ${sha}`);
  if (!/^\d+$/.test(String(runId))) throw new Error(`not a run id: ${runId}`);
  return {
    format: 'web-scumm-candidate',
    schema: 1,
    sha,
    candidateRunId: String(runId),
    createdAt,
    artifacts: filesUnder(dir).map((name) => ({ name, sha256: sha256(join(dir, name)) })),
  };
}

/** What is wrong with a manifest for this SHA and run, the files under `dir` against it; [] when nothing is. */
export function checkManifest(manifest, { sha, runId, dir }) {
  const bad = [];
  if (manifest?.format !== 'web-scumm-candidate' || manifest.schema !== 1)
    return ['not a candidate manifest of schema 1'];
  if (manifest.sha !== sha) bad.push(`the candidate tested ${manifest.sha}, not ${sha}`);
  if (manifest.candidateRunId !== String(runId))
    bad.push(`the manifest is run ${manifest.candidateRunId}'s, not ${runId}'s`);
  if (!manifest.artifacts?.length) bad.push('the manifest lists no file');
  const present = new Set(filesUnder(dir));
  for (const a of manifest.artifacts ?? []) {
    if (!present.has(a.name)) bad.push(`${a.name}: missing`);
    else if (sha256(join(dir, a.name)) !== a.sha256) bad.push(`${a.name}: its SHA-256 differs from the candidate's`);
    present.delete(a.name);
  }
  for (const extra of present) bad.push(`${extra}: not in the manifest`);
  return bad;
}

const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (cmd === 'gate') {
    const r = judge(JSON.parse(process.env.NEEDS ?? '{}'));
    for (const row of r.rows) console.log(`${row.result === 'success' ? '✔' : '✖'} ${row.job}: ${row.result}`);
    if (!r.rows.length) console.error('✖  no job to judge');
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'manifest') {
    const m = buildManifest({ sha: flag('sha'), runId: flag('run'), dir: flag('dir') });
    writeFileSync(flag('out'), `${JSON.stringify(m, null, 1)}\n`);
    console.log(`✔  candidate ${m.candidateRunId} on ${m.sha.slice(0, 12)}: ${m.artifacts.length} files`);
  } else if (cmd === 'check' && arg) {
    const bad = checkManifest(JSON.parse(readFileSync(arg, 'utf8')), {
      sha: flag('sha'),
      runId: flag('run'),
      dir: flag('dir'),
    });
    for (const b of bad) console.error(`✖  ${b}`);
    if (!bad.length) console.log(`✔  every file is the candidate's (run ${flag('run')}, ${flag('sha')?.slice(0, 12)})`);
    process.exit(bad.length ? 1 : 0);
  } else if (cmd === 'run-of' && arg) {
    const r = spawnSync('git', ['for-each-ref', '--format=%(contents)', `refs/tags/${arg}`], { encoding: 'utf8' });
    console.log(candidateOf(r.stdout ?? '') ?? '');
  } else {
    console.error('usage: node tools/release/candidate.mjs <gate|manifest|check|run-of> … (see its header)');
    process.exit(2);
  }
}
