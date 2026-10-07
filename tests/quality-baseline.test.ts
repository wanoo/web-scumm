import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { differences, metricsOf, withMetrics } from '../tools/quality-baseline';

// The baseline of 4.1.0 "Clarity" (tools/quality-baseline.ts): what a behaviour-preserving change must not move.
const base = () => JSON.parse(readFileSync('tests/quality-baseline.json', 'utf8'));

describe('quality baseline', () => {
  it("writes the READMEs' figures between their markers, and both READMEs carry them", () => {
    const b = { ...base(), tests: { files: 1, declarations: 1234 }, bundle: { initialJsKB: 99 } };
    expect(
      withMetrics(
        'a <!-- metric:tests -->1<!-- /metric --> b <!-- metric:initialJsKB -->2<!-- /metric -->',
        metricsOf(b),
      ),
    ).toBe('a <!-- metric:tests -->1234<!-- /metric --> b <!-- metric:initialJsKB -->99<!-- /metric -->');
    expect(withMetrics('<!-- metric:other -->x<!-- /metric -->', metricsOf(b))).toBe(
      '<!-- metric:other -->x<!-- /metric -->',
    );
    for (const r of ['README.md', 'README.fr.md']) {
      const page = readFileSync(r, 'utf8');
      expect(page).toContain('<!-- metric:tests -->');
      expect(page).toContain('<!-- metric:initialJsKB -->');
      expect(page).toContain('<!-- metric:referenceStates -->');
      expect(withMetrics(page, metricsOf(base()))).toBe(page); // the figures are the baseline's
    }
  });
  it('names nothing when nothing moved', () => {
    expect(differences(base(), base())).toEqual([]);
  });

  it('names the game and the part that moved: a digest, a verdict, a proof size', () => {
    const got = base();
    got.games.demo.witness.digests = 'x';
    got.games['por.trap-3'].proof.softlocks += 1;
    got.games.reference.proof.status = 'truncated';
    const d = differences(base(), got);
    expect(d.some((l) => l.startsWith('demo witness.digests'))).toBe(true);
    expect(d.some((l) => l.startsWith('por.trap-3 proof.softlocks'))).toBe(true);
    expect(d).toContain('reference proof.status: solved → truncated');
  });

  it('holds the golden saves, the public surface, the number of tests and the first visit', () => {
    const got = base();
    got.saves['demo-4.0.0.json'].ended = false;
    got.surface.api = 'changed';
    got.tests.declarations -= 1;
    got.bundle = { initialJsKB: (got.bundle?.initialJsKB ?? 100) + 1 };
    const d = differences(base(), got);
    expect(d).toHaveLength(4);
    // More tests and a smaller first visit are not differences.
    const better = base();
    better.tests.declarations += 5;
    better.bundle = { initialJsKB: (better.bundle?.initialJsKB ?? 100) - 3 };
    expect(differences(base(), better)).toEqual([]);
  });

  it('measures a softlock: the trap fixture is proved with its losing step', () => {
    expect(base().games['por.trap-3'].proof.softlocks).toBeGreaterThan(0);
  });
});
