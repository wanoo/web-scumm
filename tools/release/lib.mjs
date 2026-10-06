// Shared helpers of the release tooling (4.1.8): `gh` and `git` as functions, a PID file per long command (so an
// interrupted run is stopped by its own PID, never by a pattern), and a poll loop with a deadline.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO = process.env.WEB_SCUMM_REPO ?? 'wanoo/web-scumm';

/** Runs a command and returns its trimmed stdout; throws with stderr when it fails (unless `ok` lists the code). */
export function run(cmd, args, { ok = [0], input } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (!ok.includes(r.status ?? -1)) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}\n${r.stderr || r.stdout}`);
  return (r.stdout ?? '').trim();
}

/** `gh … -R <repo>` parsed as JSON (`--json` must be among the args). */
export const ghJson = (args, opts) => JSON.parse(run('gh', [...args, '-R', REPO], opts) || 'null');
export const gh = (args, opts) => run('gh', [...args, '-R', REPO], opts);
export const git = (args, opts) => run('git', args, opts);

/** The PID of this command, written where `npm run ship` says (`SHIP_PIDS`, default `.cache/pids/`). */
export function writePid(name) {
  const dir = process.env.SHIP_PIDS ?? join('.cache', 'pids');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.pid`);
  writeFileSync(file, `${process.pid}\n`);
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The time, for the log lines. */
export const now = () => new Date().toISOString().slice(11, 19);
export const say = (s) => console.log(`${now()}  ${s}`);

/**
 * Polls `probe` every `everyMs` until it returns a value other than `undefined`, or the deadline passes (then throws).
 * `probe` may return a promise.
 */
export async function until(probe, { everyMs = 60_000, deadlineMs = 90 * 60_000, what = 'the condition' } = {}) {
  const end = Date.now() + deadlineMs;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`gave up waiting for ${what} after ${Math.round(deadlineMs / 60_000)} min`);
    await sleep(everyMs);
  }
}

/** The run id in a check's link (`…/actions/runs/<id>/job/<job>`), or null. */
export const runIdOf = (link) => link?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;

/** `vX.Y.Z[-pre]` → `X.Y.Z[-pre]`; `X.Y.Z` → the same; anything else throws. */
export function versionOf(tagOrVersion) {
  const v = tagOrVersion.replace(/^v/, '');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(v))
    throw new Error(`not a SemVer version: ${tagOrVersion}`);
  return v;
}

/** Whether a version is a pre-release (`4.1.8-rc.1`). */
export const isPrerelease = (version) => version.includes('-');
