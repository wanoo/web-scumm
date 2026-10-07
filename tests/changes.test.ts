// The CHANGELOG and LOG fragments (4.1.9, lot 0, tools/changes.ts): a branch writes changes/<slug>.md and the
// assembly on main folds them in order, under the right section, numbering the LOG entries after the last one.
import { describe, expect, it } from 'vitest';
import { appendLog, lastLogNumber, logEntryOf, mergeChangelog, needsFragment, sectionsOf } from '../tools/changes';

const changelog = `# Changelog

## Unreleased

### Fixed

- **An old fix** (4.1.9).

### Changes

- **An old change** (4.1.9).

## 4.1.8 — 2026-10-07

- older
`;

describe('fragments of the CHANGELOG', () => {
  it('reads the sections of a fragment, in any order, ignoring blank lines', () => {
    expect(sectionsOf('### Changes\n\n- a\n- b\n\n### Fixed\n- c\n')).toEqual({
      Changes: '- a\n- b\n',
      Fixed: '- c\n',
    });
    expect(sectionsOf('- no heading\n')).toEqual({});
  });
  it('adds the bullets under their section of Unreleased, in the order given, and leaves the older releases alone', () => {
    const out = mergeChangelog(changelog, [
      { changelog: '### Changes\n- **first** (4.1.9).\n' },
      { changelog: '### Fixed\n- **second fix** (4.1.9).\n### Changes\n- **second** (4.1.9).\n' },
    ]);
    const unreleased = out.slice(out.indexOf('## Unreleased'), out.indexOf('## 4.1.8'));
    expect(unreleased.indexOf('An old fix')).toBeLessThan(unreleased.indexOf('second fix'));
    expect(unreleased.indexOf('### Fixed')).toBeLessThan(unreleased.indexOf('### Changes'));
    expect(unreleased.indexOf('An old change')).toBeLessThan(unreleased.indexOf('**first**'));
    expect(unreleased.indexOf('**first**')).toBeLessThan(unreleased.indexOf('**second**'));
    expect(out.endsWith('## 4.1.8 — 2026-10-07\n\n- older\n')).toBe(true);
    expect(out).not.toMatch(/\n{3,}/);
  });
  it('creates a missing section where it belongs: Breaking before Fixed before Changes', () => {
    const out = mergeChangelog('# C\n\n## Unreleased\n\n## 4.1.8 — d\n', [
      { changelog: '### Changes\n- c\n' },
      { changelog: '### Breaking\n- b\n' },
    ]);
    expect(out).toBe('# C\n\n## Unreleased\n\n### Breaking\n\n- b\n\n### Changes\n\n- c\n\n## 4.1.8 — d\n');
  });
  it('refuses a CHANGELOG without an Unreleased section', () => {
    expect(() => mergeChangelog('# C\n\n## 4.1.8\n', [{ changelog: '### Fixed\n- x\n' }])).toThrow(/Unreleased/);
  });
});

describe('fragments of the LOG', () => {
  const log =
    '# Exchange log (v3)\n\n## #116 · 2026-10-07 · Claude · proposal · a title\n\n- body\n\n→ next: Claude · x\n';
  it('numbers after the last entry, dates each with its fragment, keeps the → next line last', () => {
    expect(lastLogNumber(log)).toBe(116);
    const out = appendLog(log, [
      {
        title: '`feature/419-cadence`: fragments',
        body: '- one\n\n→ next: Claude · `feature/419-connector-sdk`',
        date: '2026-10-08T10:00:00+02:00',
      },
      { title: 'second', body: '- two', date: '2026-10-09' },
    ]);
    expect(out).toContain(
      '\n## #117 · 2026-10-08 · Claude · proposal · `feature/419-cadence`: fragments\n\n- one\n\n→ next: Claude · `feature/419-connector-sdk`\n',
    );
    expect(out).toContain('\n## #118 · 2026-10-09 · Claude · proposal · second\n\n- two\n');
    expect(lastLogNumber(out)).toBe(118);
    expect(out.endsWith('- two\n')).toBe(true);
  });
  it('reads a .log.md fragment: the title on the first line, the body after', () => {
    expect(logEntryOf('## t\n\n- a\n- b\n')).toEqual({ title: 't', body: '- a\n- b' });
    expect(() => logEntryOf('- no title\n')).toThrow(/## <title>/);
  });
});

describe('the check of a pull request', () => {
  it('asks a fragment of a branch that changes the code without one, not of a docs branch nor of a release that edits the CHANGELOG', () => {
    expect(needsFragment(['src/engine/core/engine.ts', 'tests/x.test.ts'])).toBe(true);
    expect(needsFragment(['src/engine/core/engine.ts', 'changes/fix-x.md'])).toBe(false);
    expect(needsFragment(['src/engine/core/engine.ts', 'CHANGELOG.md'])).toBe(false);
    expect(needsFragment(['docs/en/README.md', 'docs/dev/LOG.md'])).toBe(false);
    expect(needsFragment(['src/x.ts', 'changes/README.md'])).toBe(true);
  });
});
