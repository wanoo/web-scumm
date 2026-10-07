// npm run changes -- --check [--base origin/main] | --assemble [--date YYYY-MM-DD] (4.1.9, lot 0 "cadence"): the
// CHANGELOG and the LOG written as fragments per branch, assembled on main. A branch that changes the code writes
// `changes/<slug>.md` (its CHANGELOG bullets under `### Breaking`, `### Fixed` or `### Changes`) and, when it has a
// LOG entry, `changes/<slug>.log.md` (first line `## <title>`, then the entry's body, its `→ next:` line last).
// `--check` fails a pull request that touches src/, bridge/, tools/, scripts/, cli/ or connectors/ without a fragment
// (or a direct CHANGELOG edit: a release branch). `--assemble` folds every fragment into CHANGELOG.md's `Unreleased`
// and numbers the LOG entries after the last one, in the order the fragments reached main (their first commit's
// date), then removes them. Two branches no longer conflict on the CHANGELOG, the LOG or their entry numbers.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './game';

export const SECTIONS = ['Breaking', 'Fixed', 'Changes'] as const;
export type Section = (typeof SECTIONS)[number];
/** A path under one of these folders is code: it needs a fragment, or a CHANGELOG edit. */
export const CODE_ROOTS = ['src/', 'bridge/', 'tools/', 'scripts/', 'cli/', 'connectors/', 'games/'];

export interface Fragment {
  slug: string;
  /** The CHANGELOG part: `### Section` headings and their bullets, as written. */
  changelog: string;
  /** The LOG part, or nothing: the first line is `## <title>`, the rest the body. */
  log?: string;
  /** ISO date of the fragment's first commit (the order of assembly). */
  date: string;
}

/** The sections of a fragment: `{ Fixed: '- …\n', Changes: '- …\n' }`, each the bullets under its heading. */
export function sectionsOf(text: string): Partial<Record<Section, string>> {
  const out: Partial<Record<Section, string>> = {};
  let current: Section | undefined;
  for (const line of text.split('\n')) {
    const m = /^### (Breaking|Fixed|Changes)\s*$/.exec(line);
    if (m) {
      current = m[1] as Section;
      out[current] ??= '';
      continue;
    }
    if (current !== undefined && line.trim()) out[current] += `${line}\n`;
  }
  return out;
}

/**
 * The CHANGELOG with the fragments' bullets added to `## Unreleased`, each under its `### Section` (created in the
 * order Breaking, Fixed, Changes when absent), the fragments in the order given. Nothing else of the page moves.
 */
export function mergeChangelog(changelog: string, fragments: readonly Pick<Fragment, 'changelog'>[]): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const block = lines.slice(start + 1, end);
  const bySection: Record<Section, string[]> = { Breaking: [], Fixed: [], Changes: [] };
  const other: string[] = [];
  let current: Section | undefined;
  for (const l of block) {
    const m = /^### (Breaking|Fixed|Changes)\s*$/.exec(l);
    if (m) {
      current = m[1] as Section;
      continue;
    }
    if (current) bySection[current].push(l);
    else other.push(l);
  }
  for (const f of fragments)
    for (const [s, text] of Object.entries(sectionsOf(f.changelog)) as [Section, string][]) {
      const bullets = text.trimEnd().split('\n');
      const target = bySection[s];
      while (target.length && target[target.length - 1]!.trim() === '') target.pop();
      if (target.length) target.push('');
      target.push(...bullets);
    }
  const out: string[] = [
    ...other
      .join('\n')
      .replace(/\n+$/, '')
      .split('\n')
      .filter((l, i, a) => !(i === 0 && l === '' && a.length === 1)),
  ];
  for (const s of SECTIONS) {
    const body = bySection[s];
    while (body.length && body[body.length - 1]!.trim() === '') body.pop();
    while (body.length && body[0]!.trim() === '') body.shift();
    if (!body.length) continue;
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(`### ${s}`, '', ...body);
  }
  const head = lines.slice(0, start + 1);
  const tail = lines.slice(end);
  return [...head, '', ...out, '', ...tail].join('\n').replace(/\n{3,}/g, '\n\n');
}

/** The number of the last `## #n ·` entry of the LOG. */
export function lastLogNumber(log: string): number {
  let n = 0;
  for (const m of log.matchAll(/^## #(\d+) ·/gm)) n = Math.max(n, Number(m[1]));
  return n;
}

/** The LOG with the entries appended, numbered from the last one, each as `## #n · date · Claude · proposal · title`. */
export function appendLog(log: string, entries: readonly { title: string; body: string; date: string }[]): string {
  let n = lastLogNumber(log);
  let out = log.replace(/\n+$/, '');
  for (const e of entries) {
    n++;
    const day = e.date.slice(0, 10);
    out += `\n\n## #${n} · ${day} · Claude · proposal · ${e.title.trim()}\n\n${e.body.trim()}\n`;
  }
  return `${out.replace(/\n+$/, '')}\n`;
}

/** The title and body of a `.log.md` fragment (first line `## <title>`). */
export function logEntryOf(text: string): { title: string; body: string } {
  const [first = '', ...rest] = text.trimStart().split('\n');
  const m = /^## (.+)$/.exec(first);
  if (!m) throw new Error('a .log.md fragment starts with "## <title>"');
  return { title: m[1]!, body: rest.join('\n').trim() };
}

/** Whether a pull request that changed these files must carry a fragment (code changed, no fragment, no CHANGELOG edit). */
export function needsFragment(changed: readonly string[]): boolean {
  const code = changed.some((f) => CODE_ROOTS.some((r) => f.startsWith(r)));
  const fragment = changed.some((f) => /^changes\/[^/]+\.md$/.test(f) && f !== 'changes/README.md');
  const direct = changed.includes('CHANGELOG.md');
  return code && !fragment && !direct;
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** The fragments on disk, with the date of their first commit (or the file's mtime when uncommitted). */
export function readFragments(): Fragment[] {
  const dir = resolve(ROOT, 'changes');
  if (!existsSync(dir)) return [];
  const out: Fragment[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name.endsWith('.log.md') || name === 'README.md') continue;
    const slug = name.slice(0, -3);
    const file = resolve(dir, name);
    let date = '';
    try {
      date = git('log', '--diff-filter=A', '--format=%cI', '--', `changes/${name}`).split('\n').pop() ?? '';
    } catch {
      /* no git: the mtime below */
    }
    if (!date) date = statSync(file).mtime.toISOString();
    const logFile = resolve(dir, `${slug}.log.md`);
    out.push({
      slug,
      changelog: readFileSync(file, 'utf8'),
      log: existsSync(logFile) ? readFileSync(logFile, 'utf8') : undefined,
      date,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
}

if (process.argv[1]?.endsWith('changes.ts')) {
  const args = process.argv.slice(2);
  const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  if (args.includes('--check')) {
    const base = opt('base') ?? 'origin/main';
    const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    if (needsFragment(changed)) {
      console.error(
        `✖  this branch changes the code and carries no fragment: write changes/<slug>.md (### Fixed | ### Changes | ### Breaking, then the bullets) and, for a LOG entry, changes/<slug>.log.md (## <title>, then the body). docs/dev/plans/README.md says how.`,
      );
      process.exit(1);
    }
    console.log(
      `✔  ${changed.length} file(s) changed against ${base}: a fragment or a CHANGELOG edit is there, or no code moved`,
    );
    process.exit(0);
  }
  if (args.includes('--assemble')) {
    const fragments = readFragments();
    if (!fragments.length) {
      console.log('✔  no fragment to assemble');
      process.exit(0);
    }
    const changelogFile = resolve(ROOT, 'CHANGELOG.md');
    writeFileSync(changelogFile, mergeChangelog(readFileSync(changelogFile, 'utf8'), fragments));
    const withLog = fragments.filter((f) => f.log);
    if (withLog.length) {
      const logFile = resolve(ROOT, 'docs/dev/LOG.md');
      writeFileSync(
        logFile,
        appendLog(
          readFileSync(logFile, 'utf8'),
          withLog.map((f) => ({ ...logEntryOf(f.log!), date: opt('date') ?? f.date })),
        ),
      );
    }
    for (const f of fragments) {
      unlinkSync(resolve(ROOT, 'changes', `${f.slug}.md`));
      if (f.log) unlinkSync(resolve(ROOT, 'changes', `${f.slug}.log.md`));
    }
    console.log(
      `✔  ${fragments.length} fragment(s) assembled into CHANGELOG.md${withLog.length ? ` and ${withLog.length} LOG entr${withLog.length > 1 ? 'ies' : 'y'} (#${lastLogNumber(readFileSync(resolve(ROOT, 'docs/dev/LOG.md'), 'utf8')) - withLog.length + 1}+)` : ''}: ${fragments.map((f) => f.slug).join(', ')}`,
    );
    process.exit(0);
  }
  console.error('usage: npm run changes -- --check [--base=origin/main] | --assemble [--date=YYYY-MM-DD]');
  process.exit(2);
}
