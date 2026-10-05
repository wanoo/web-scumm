#!/usr/bin/env node
// node scripts/release-notes.mjs v3.1.0 [CHANGELOG.md]: prints the CHANGELOG section of that version (the release
// workflow uses it as the GitHub release notes), then what was checked by hand (docs/dev/passes/<version>.md, D12: a
// release ships on its automated gates and says which manual pass was not done). Exit 1 when the version has no section.
import { existsSync, readFileSync } from 'node:fs';

/** The body of the `## <version> …` section, without its heading. */
export function releaseNotes(changelog, tag) {
  const version = tag.replace(/^v/, '');
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim() + '\n';
}

/** The manual passes of a release, from its sheet (`docs/dev/passes/<version>.md`), or the statement that none was made. */
export function manualPasses(sheet) {
  const head = '### Manual passes (D12: reported, not blocking)\n\n';
  if (!sheet) return `${head}None recorded for this release: the screen reader, Safari offline, a real phone, playtesters, recorded voices, listening and a signed tag were not checked by hand (docs/en/FIELD.md, docs/dev/passes/TEMPLATE.md).\n`;
  const rows = sheet.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1);
  const todo = rows.filter((r) => /\|\s*not done\s*\|/i.test(r)).length;
  return `${head}${rows.length - todo} of ${rows.length} done.\n\n| Pass | Status | Who, when | Device, OS, browser, versions | What failed |\n|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const tag = process.argv[2];
  if (!tag) { console.error('usage: node scripts/release-notes.mjs <tag> [CHANGELOG.md]'); process.exit(2); }
  const notes = releaseNotes(readFileSync(process.argv[3] ?? 'CHANGELOG.md', 'utf8'), tag);
  if (notes === null) { console.error(`no "## ${tag.replace(/^v/, '')}" section in the changelog`); process.exit(1); }
  const sheet = `docs/dev/passes/${tag.replace(/^v/, '')}.md`;
  process.stdout.write(`${notes}\n${manualPasses(existsSync(sheet) ? readFileSync(sheet, 'utf8') : null)}`);
}
