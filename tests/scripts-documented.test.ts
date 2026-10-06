// Every npm script has a line in docs/en/TOOLS.md and docs/fr/TOOLS.md (4.1.7): a script nobody documents is a
// script nobody can find.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scripts = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>);

describe('every npm script is documented', () => {
  for (const page of ['docs/en/TOOLS.md', 'docs/fr/TOOLS.md'])
    it(page, () => {
      const md = readFileSync(page, 'utf8');
      const missing = scripts.filter((s) => !new RegExp(`(npm run (-s )?|npm |\`|, )${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|\`)`).test(md));
      expect(missing).toEqual([]);
    });
});
