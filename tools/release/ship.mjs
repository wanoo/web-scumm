#!/usr/bin/env node
// npm run ship -- <command> …: the release chain as commands (4.1.8), the logic the 4.1.2 → 4.1.7 releases were run
// with, kept in the repository instead of a session's scratchpad. Each command is idempotent and says what it waits for.
//
//   ship checks <pr>             wait for the pull request's checks; re-run a failed job once; exit 1 if it fails again
//   ship merge <pr>              `checks`, then merge (merge commit, the only method the ruleset allows); prints the SHA
//   ship main <sha>              wait for the `ci` run of main on that SHA to be green (re-run once)
//   ship tag <version> <sha>     `main`, then an annotated tag v<version> on the SHA, pushed; then `watch`
//   ship watch <version>         wait for the tag's `ci` run, then for the `release` run; exit by its conclusion
//   ship verify <version>        download the release, check the SHA-256 sums and every provenance attestation
//   ship chain <pr> <version>    merge → tag → watch → verify
//
// A pre-release version (`4.1.8-rc.1`) is tagged the same way; release.yml marks it a pre-release on GitHub.
// Every command writes its PID to `.cache/pids/ship-<command>.pid` (`SHIP_PIDS` to choose the folder): stop that
// PID, not a pattern.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gh, ghJson, git, isPrerelease, REPO, run, runIdOf, say, until, versionOf, writePid } from './lib.mjs';

const [command, ...rest] = process.argv.slice(2);

const RERUN_ONCE = new Set();
/** Re-runs the failed jobs of a run once; false when it was already re-run (the second failure is final). */
function rerunOnce(runId, why) {
  if (RERUN_ONCE.has(runId)) return false;
  RERUN_ONCE.add(runId);
  say(`${why}: re-running the failed jobs of run ${runId} once`);
  gh(['run', 'rerun', String(runId), '--failed']);
  return true;
}

/** `gh pr checks --json`: the state of every check; exit code 8 means pending, 1 means a failure (both fine here). */
const prChecks = (pr) =>
  JSON.parse(
    run('gh', ['pr', 'checks', String(pr), '--json', 'name,state,bucket,link,workflow', '-R', REPO], {
      ok: [0, 1, 8],
    }) || '[]',
  );

async function checks(pr) {
  say(`waiting for the checks of #${pr}`);
  return until(
    () => {
      const list = prChecks(pr);
      const pending = list.filter((c) => c.bucket === 'pending');
      const failed = list.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel');
      if (failed.length) {
        const runs = [...new Set(failed.map((c) => runIdOf(c.link)).filter(Boolean))];
        const retried = runs.map((id) => rerunOnce(id, `${failed.map((c) => c.name).join(', ')} ${failed[0].bucket}`));
        if (retried.some(Boolean)) return undefined;
        throw new Error(`checks failed again on #${pr}: ${failed.map((c) => `${c.name} (${c.link})`).join(', ')}`);
      }
      if (pending.length) {
        say(`${list.length - pending.length}/${list.length} done, pending: ${pending.map((c) => c.name).join(', ')}`);
        return undefined;
      }
      say(`all ${list.length} checks pass on #${pr}`);
      return list;
    },
    { what: `the checks of #${pr}` },
  );
}

async function merge(pr) {
  const view = ghJson(['pr', 'view', String(pr), '--json', 'number,title,headRefName,state,mergeCommit,isDraft']);
  if (view.state === 'MERGED') {
    say(`#${pr} is already merged at ${view.mergeCommit.oid}`);
    console.log(view.mergeCommit.oid);
    return view.mergeCommit.oid;
  }
  if (view.isDraft) throw new Error(`#${pr} is a draft`);
  await checks(pr);
  const subject = `Merge ${view.headRefName}: ${view.title}`;
  const trailers = ['Agent: Claude', process.env.SHIP_TRAILERS ?? ''].filter(Boolean).join('\n');
  say(`merging #${pr} (${view.headRefName})`);
  gh(['pr', 'merge', String(pr), '--merge', '--subject', subject, '--body', trailers]);
  const after = await until(
    () => {
      const v = ghJson(['pr', 'view', String(pr), '--json', 'state,mergeCommit']);
      return v.state === 'MERGED' && v.mergeCommit?.oid ? v.mergeCommit.oid : undefined;
    },
    { everyMs: 10_000, deadlineMs: 5 * 60_000, what: `the merge of #${pr}` },
  );
  say(`merged: ${after}`);
  console.log(after);
  return after;
}

/** The `ci` run on a SHA with a given event/branch, as soon as GitHub lists it. */
const findRun = (workflow, sha, branch) =>
  ghJson([
    'run',
    'list',
    '--workflow',
    workflow,
    ...(branch ? ['--branch', branch] : []),
    '--limit',
    '40',
    '--json',
    'databaseId,headSha,status,conclusion,event,headBranch',
  ]).find((r) => r.headSha === sha);

async function waitRun(workflow, sha, branch, what) {
  say(`waiting for the ${workflow} run of ${sha.slice(0, 7)}${branch ? ` on ${branch}` : ''}`);
  return until(
    () => {
      const r = findRun(workflow, sha, branch);
      if (!r) return undefined;
      if (r.status !== 'completed') return undefined;
      if (r.conclusion === 'success') {
        say(`${workflow} run ${r.databaseId}: success`);
        return r;
      }
      if (r.conclusion === 'skipped') return r; // release.yml skips for a main push: the caller decides
      if (
        ['failure', 'cancelled', 'timed_out'].includes(r.conclusion) &&
        rerunOnce(r.databaseId, `${workflow} ${r.conclusion}`)
      )
        return undefined;
      throw new Error(
        `${workflow} run ${r.databaseId} on ${sha.slice(0, 7)}: ${r.conclusion} (https://github.com/${REPO}/actions/runs/${r.databaseId})`,
      );
    },
    { what },
  );
}

async function main(sha) {
  const r = await waitRun('ci', sha, 'main', `ci on main for ${sha.slice(0, 7)}`);
  if (r.conclusion !== 'success') throw new Error(`ci on main for ${sha.slice(0, 7)}: ${r.conclusion}`);
  return r;
}

async function tag(versionArg, sha) {
  const version = versionOf(versionArg);
  const name = `v${version}`;
  const full = git(['rev-parse', `${sha}^{commit}`]);
  const existing = git(['ls-remote', '--tags', 'origin', `refs/tags/${name}`]);
  if (existing) {
    const at = existing.split(/\s/)[0];
    const pointsTo = git(['rev-parse', `${at}^{commit}`], { ok: [0, 128] }) || at;
    if (pointsTo !== full)
      throw new Error(
        `${name} exists on origin at ${pointsTo.slice(0, 7)}, not ${full.slice(0, 7)}: a tag is never moved`,
      );
    say(`${name} already on origin at ${full.slice(0, 7)}`);
  } else {
    await main(full);
    say(`tagging ${name} on ${full.slice(0, 7)}${isPrerelease(version) ? ' (pre-release)' : ''}`);
    git(['tag', '-a', name, full, '-m', version]);
    git(['push', 'origin', `refs/tags/${name}`]);
  }
  return watch(version);
}

async function watch(versionArg) {
  const version = versionOf(versionArg);
  const name = `v${version}`;
  const sha =
    git(['rev-parse', `${name}^{commit}`], { ok: [0, 128] }) ||
    git(['ls-remote', '--tags', 'origin', `refs/tags/${name}^{}`]).split(/\s/)[0];
  if (!sha) throw new Error(`${name}: not a tag here nor on origin`);
  await waitRun('ci', sha, name, `ci on ${name}`);
  const rel = await until(
    () => {
      const r = ghJson([
        'run',
        'list',
        '--workflow',
        'release',
        '--limit',
        '40',
        '--json',
        'databaseId,headSha,status,conclusion,headBranch',
      ]).find((x) => x.headSha === sha && x.headBranch === name && x.conclusion !== 'skipped');
      if (!r || r.status !== 'completed') return undefined;
      return r;
    },
    { what: `the release run of ${name}`, deadlineMs: 120 * 60_000 },
  );
  if (rel.conclusion !== 'success')
    throw new Error(
      `release run ${rel.databaseId} of ${name}: ${rel.conclusion} (https://github.com/${REPO}/actions/runs/${rel.databaseId})`,
    );
  say(`release ${name} published by run ${rel.databaseId}`);
  return verify(version);
}

async function verify(versionArg) {
  const version = versionOf(versionArg);
  const name = `v${version}`;
  const dir = join('.cache', 'release', name);
  mkdirSync(dir, { recursive: true });
  say(`downloading ${name} into ${dir}`);
  gh(['release', 'download', name, '-D', dir, '--clobber']);
  const files = readdirSync(dir);
  const sums = files.find((f) => f.endsWith('-SHA256SUMS'));
  if (!sums) throw new Error(`${name}: no SHA256SUMS among ${files.join(', ')}`);
  const check = run('shasum', ['-a', '256', '-c', sums], { ok: [0, 1] });
  console.log(
    check
      .split('\n')
      .map((l) => `   ${l}`)
      .join('\n'),
  );
  if (/FAILED/.test(check)) throw new Error(`${name}: a checksum failed`);
  let attested = 0;
  for (const f of files) {
    run('gh', ['attestation', 'verify', join(dir, f), '--repo', REPO]);
    attested++;
  }
  say(`${name}: ${files.length} files, sums ok, ${attested} attestations verified`);
  if (!existsSync(join(dir, `web-scumm-${version}.tgz`))) throw new Error(`${name}: web-scumm-${version}.tgz missing`);
  return { files, attested };
}

async function chain(pr, version) {
  const sha = await merge(pr);
  return tag(version, sha);
}

const COMMANDS = { checks, merge, main, tag, watch, verify, chain };
if (!command || !(command in COMMANDS)) {
  console.error(
    `usage: npm run ship -- <${Object.keys(COMMANDS).join('|')}> …  (see the header of tools/release/ship.mjs)`,
  );
  process.exit(2);
}
writePid(`ship-${command}`);
COMMANDS[command](...rest).then(
  () => process.exit(0),
  (e) => {
    console.error(`✖  ship ${command}: ${e.message}`);
    process.exit(1);
  },
);
