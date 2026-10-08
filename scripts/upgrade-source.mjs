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
