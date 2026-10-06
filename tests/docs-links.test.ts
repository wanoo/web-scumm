// Every relative link in the READMEs and the docs points at a file that exists (4.1.7): a moved page or a renamed
// image breaks nothing silently. External links are not fetched; anchors are not checked.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pages = [
  'README.md',
  'README.fr.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  ...['docs/en', 'docs/fr'].flatMap((d) => readdirSync(d).map((f) => `${d}/${f}`)),
];

/** The targets of `[text](target)` and `<img src="target">`, without their anchor. */
const links = (md: string): string[] =>
  [...md.matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)]
    .map((m) => (m[1] ?? m[2])!)
    .filter((t) => !/^(https?:|mailto:|#|data:)/.test(t))
    .map((t) => t.split('#')[0]!)
    .filter(Boolean);

describe('the documentation links to files that exist', () => {
  for (const page of pages)
    it(page, () => {
      const missing = links(readFileSync(page, 'utf8')).filter((t) => !existsSync(resolve(dirname(page), t)));
      expect(missing).toEqual([]);
    });
});
