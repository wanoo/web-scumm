#!/usr/bin/env node
// node tools/release/ancestry.mjs <tag|version> <sha> (4.1.16): the stable tag just below a new tag must be an
// ancestor of the commit it is put on. v4.1.14 was tagged on a side branch that main never merged, so v4.1.15 did not
// descend from it (merged back on 4.1.16). `ship tag` refuses before tagging; release.yml refuses before publishing.
// A pre-release is held to the same rule; the previous tag is always a stable one (rc tags are not a line).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { versionOf } from './lib.mjs';

const parts = (v) => v.split('-')[0].split('.').map(Number);
const below = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
};

/** The highest stable tag (`vX.Y.Z`, no pre-release) strictly below `version`'s X.Y.Z, or null. */
export function previousStable(version, tags) {
  const v = versionOf(version);
  let best = null;
  for (const t of tags) {
    if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(t)) continue;
    const tv = t.slice(1);
    if (below(tv, v) && (!best || below(best.slice(1), tv))) best = t;
  }
  return best;
}

const gitIn = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** `{ ok, previous, reason }` for tagging `version` on `sha` in the repository at `cwd`. */
export function checkAncestry(version, sha, { cwd = process.cwd() } = {}) {
  const tags = gitIn(cwd, ['tag', '-l', 'v*']).stdout.split('\n').filter(Boolean);
  const previous = previousStable(version, tags);
  if (!previous) return { ok: true, previous: null, reason: 'no stable tag below it' };
  const r = gitIn(cwd, ['merge-base', '--is-ancestor', `${previous}^{commit}`, sha]);
  if (r.status === 0) return { ok: true, previous, reason: `${previous} is an ancestor` };
  if (r.status === 1) return { ok: false, previous, reason: `${previous} is not an ancestor of ${sha.slice(0, 12)}` };
  return { ok: false, previous, reason: `git merge-base failed: ${(r.stderr || '').trim()}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [tag, sha] = process.argv.slice(2);
  if (!tag || !sha) {
    console.error('usage: node tools/release/ancestry.mjs <tag|version> <sha>');
    process.exit(2);
  }
  const r = checkAncestry(tag, sha);
  console.log(`${r.ok ? '✔' : '✖'} ${tag}: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
}
