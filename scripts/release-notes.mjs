#!/usr/bin/env node
// node scripts/release-notes.mjs v3.1.0 [CHANGELOG.md]: prints the CHANGELOG section of that version (the release
// workflow uses it as the GitHub release notes). Exit 1 when the version has no section.
import { readFileSync } from 'node:fs';

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

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const tag = process.argv[2];
  if (!tag) { console.error('usage: node scripts/release-notes.mjs <tag> [CHANGELOG.md]'); process.exit(2); }
  const notes = releaseNotes(readFileSync(process.argv[3] ?? 'CHANGELOG.md', 'utf8'), tag);
  if (notes === null) { console.error(`no "## ${tag.replace(/^v/, '')}" section in the changelog`); process.exit(1); }
  process.stdout.write(notes);
}
