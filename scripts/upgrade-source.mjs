// Where `npm run upgrade-check -- --from=…` takes the older engine (4.1.17): `previous`, a path to a tarball, or a
// published version. A version may be written with or without its `v` (`--from=v4.1.15` built `vv4.1.15` and asked
// for `web-scumm-v4.1.15.tgz` before 4.1.17), and a pre-release's tarball carries package.json's version without the
// suffix (v4.1.16-rc.2 ships web-scumm-4.1.16.tgz).

/** `{ kind: 'previous' }`, `{ kind: 'tgz', path }` or `{ kind: 'release', tag, asset, version }`; throws otherwise. */
export function upgradeSource(from, exists) {
  if (!from) throw new Error('--from=<version | previous | web-scumm-x.y.z.tgz> is required');
  if (from === 'previous') return { kind: 'previous' };
  if (from.endsWith('.tgz') || exists(from)) {
    if (!exists(from)) throw new Error(`${from}: no such tarball`);
    return { kind: 'tgz', path: from };
  }
  const v = from.replace(/^v/, '');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(v))
    throw new Error(`--from=${from}: not a version, "previous" or a .tgz`);
  return { kind: 'release', tag: `v${v}`, asset: `web-scumm-${v.replace(/-.*$/, '')}.tgz`, version: v };
}

/**
 * The SHA-256 a release's sums file gives an asset (4.1.19: the older engine is checked against its release's own
 * `web-scumm-<tag>-SHA256SUMS`, never trusted because a URL answered). Throws when the file does not name it once.
 */
export function sumFor(sums, asset) {
  const found = String(sums)
    .split(/\r?\n/)
    .map((l) => /^([0-9a-f]{64}) [ *]?(.+)$/.exec(l.trim()))
    .filter((m) => m && m[2] === asset);
  if (found.length !== 1)
    throw new Error(`${asset}: ${found.length ? 'named twice' : 'not named'} in the release's sums`);
  return found[0][1];
}

/** The sums file of a release tag (`v4.1.16`, `v4.1.18-rc.1`). */
export const sumsAsset = (tag) => `web-scumm-${tag}-SHA256SUMS`;
