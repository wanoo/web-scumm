// The reading guides name real files (4.1.0 "Clarity"): every path quoted in ARCHITECTURE.md and CODE_TOUR.md (both
// languages), in BOUNDARIES.md and in the ADRs exists, so the tour cannot drift from the code it walks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOCS = [
  'docs/en/ARCHITECTURE.md',
  'docs/fr/ARCHITECTURE.md',
  'docs/en/CODE_TOUR.md',
  'docs/fr/CODE_TOUR.md',
  'src/engine/BOUNDARIES.md',
  'CONTRIBUTING.md',
  ...readdirSync('docs/dev/adr').map((f) => `docs/dev/adr/${f}`),
];

/** The paths a document quotes: `a/b.ts`, `a/b/`, with an optional `:line`; globs and placeholders are skipped. */
export function quotedPaths(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/`([\w@.-]+(?:\/[\w@.*<>-]*)+(?:\.\w+)?)(?::\d+)?`/g)) {
    const p = m[1]!;
    if (/[*<>]/.test(p) || p.startsWith('web-scumm/') || p.startsWith('@')) continue;
    out.add(p);
  }
  return [...out];
}
/**
 * A path as written, or relative to src/engine or src/engine/tools (the docs say `core/engine.ts`,
 * `solve/abstractions.ts`), a module without its extension (`tools/replay`), or an installed package (`zod/mini`).
 */
const exists = (p: string) =>
  ['', 'src/engine/', 'src/engine/tools/'].some((b) => existsSync(`${b}${p}`) || existsSync(`${b}${p}.ts`)) ||
  existsSync(`node_modules/${p}`);

describe('the reading guides', () => {
  it.each(DOCS)('%s quotes only paths that exist', (doc) => {
    const missing = quotedPaths(readFileSync(doc, 'utf8')).filter((p) => !exists(p));
    expect(missing).toEqual([]);
  });

  it('reads the paths it checks', () => {
    expect(
      quotedPaths('see `src/engine/core/engine.ts:12`, `dom/app.ts`, `scripts/e2e*.mjs`, `web-scumm/content`'),
    ).toEqual(['src/engine/core/engine.ts', 'dom/app.ts']);
  });
});
