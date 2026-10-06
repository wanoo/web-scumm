// The README's "Releases" section names the version package.json is at (3.7.1): the ROADMAP's criterion "the
// README's Releases table updated" at each release, checked instead of remembered.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;

describe('the README names the current release', () => {
  for (const [file, label] of [
    ['README.md', 'Current release:'],
    ['README.fr.md', 'Release actuelle :'],
  ] as const) {
    it(file, () => {
      const line = readFileSync(file, 'utf8')
        .split('\n')
        .find((l) => l.startsWith(label));
      expect(line, `${file}: no "${label}" line`).toBeDefined();
      expect(line).toContain(`[v${version} `);
      expect(line).toContain(`/releases/tag/v${version})`);
    });
  }
});
