// `upgrade-check --from=…` (4.1.17, the 4.1.16 handout): `--from=v4.1.15` built `vv4.1.15` and the asset name
// `web-scumm-v4.1.15.tgz`; a pre-release asked for a tarball no release carries. The three forms, without the network.
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script without declarations
import { upgradeSource } from '../scripts/upgrade-source.mjs';

const none = () => false;

describe('upgrade-check --from', () => {
  it('takes a version with or without its v, and a pre-release by its tarball', () => {
    const want = { kind: 'release', tag: 'v4.1.15', asset: 'web-scumm-4.1.15.tgz', version: '4.1.15' };
    expect(upgradeSource('4.1.15', none)).toEqual(want);
    expect(upgradeSource('v4.1.15', none)).toEqual(want);
    expect(upgradeSource('v4.1.16-rc.2', none)).toEqual({
      kind: 'release',
      tag: 'v4.1.16-rc.2',
      asset: 'web-scumm-4.1.16.tgz',
      version: '4.1.16-rc.2',
    });
  });

  it('takes previous, and a tarball that exists', () => {
    expect(upgradeSource('previous', none)).toEqual({ kind: 'previous' });
    expect(upgradeSource('/tmp/web-scumm-4.1.15.tgz', () => true)).toEqual({
      kind: 'tgz',
      path: '/tmp/web-scumm-4.1.15.tgz',
    });
  });

  it('refuses the rest', () => {
    expect(() => upgradeSource(undefined, none)).toThrow(/required/);
    expect(() => upgradeSource('web-scumm-4.1.15.tgz', none)).toThrow(/no such tarball/);
    expect(() => upgradeSource('latest', none)).toThrow(/not a version/);
    expect(() => upgradeSource('4.1', none)).toThrow(/not a version/);
  });
});
