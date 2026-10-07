// npm run changes -- --check [--base origin/main] | --assemble [--date YYYY-MM-DD] (4.1.9, lot 0 "cadence"): the
// CHANGELOG and the LOG written as fragments per branch, assembled on main. A branch that changes the code writes
// `changes/<slug>.md` (its CHANGELOG bullets under `### Breaking`, `### Fixed` or `### Changes`) and, when it has a
// LOG entry, `changes/<slug>.log.md` (first line `## <title>`, then the entry's body, its `→ next:` line last).
// `--check` fails a pull request that touches src/, bridge/, tools/, scripts/, cli/, connectors/ or games/ without a
// fragment (or a direct CHANGELOG edit: a release branch). `--assemble` folds every fragment into CHANGELOG.md's
// `Unreleased` and numbers the LOG entries after the last one, in the order the fragments reached main (their first
// commit's date: a rebase reorders them), then removes them. Two branches no longer conflict on the CHANGELOG, the LOG
// or their entry numbers. Only the `Unreleased` block is rewritten: the rest of the page is byte for byte the same.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './game';

export const SECTIONS = ['Breaking', 'Fixed', 'Changes'] as const;
export type Section = (typeof SECTIONS)[number];
/** A path under one of these folders is code (the bundled games included): it needs a fragment, or a CHANGELOG edit. */
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

const isSection = (s: string): s is Section => (SECTIONS as readonly string[]).includes(s);

/**
 * The sections of a fragment: `{ Fixed: '- …', Changes: '- …' }`, each the text under its heading, blank lines inside
 * kept, the ends trimmed. A heading the CHANGELOG does not use (`### Added`), or text before the first heading, is an
 * error: nothing is filed silently.
 */
export function sectionsOf(text: string): Partial<Record<Section, string>> {
  const out: Partial<Record<Section, string[]>> = {};
  let current: Section | undefined;
  for (const line of text.split('\n')) {
    const m = /^### (.+?)\s*$/.exec(line);
    if (m) {
      if (!isSection(m[1]!))
        throw new Error(`a fragment's heading is one of ### ${SECTIONS.join(' | ### ')}, not "### ${m[1]}"`);
      current = m[1];
      out[current] ??= [];
      continue;
    }
    if (current === undefined) {
      if (line.trim())
        throw new Error(
          `a fragment starts with its heading (### ${SECTIONS.join(' | ### ')}), not with "${line.slice(0, 40)}"`,
        );
      continue;
    }
    out[current]!.push(line);
  }
  const trimmed: Partial<Record<Section, string>> = {};
  for (const [s, lines] of Object.entries(out) as [Section, string[]][]) {
    const body = lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (body) trimmed[s] = body;
  }
  return trimmed;
}

/**
 * The CHANGELOG with the fragments' bullets added to `## Unreleased`, each under its `### Section` (created in the
 * order Breaking, Fixed, Changes when absent), the fragments in the order given. Only the `Unreleased` block is
 * rebuilt; a heading it holds that is not one of the three is an error.
 */
export function mergeChangelog(changelog: string, fragments: readonly Pick<Fragment, 'changelog'>[]): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
  if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" section');
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const bySection: Record<Section, string[]> = { Breaking: [], Fixed: [], Changes: [] };
  const intro: string[] = [];
  let current: Section | undefined;
  for (const l of lines.slice(start + 1, end)) {
    const m = /^### (.+?)\s*$/.exec(l);
    if (m) {
      if (!isSection(m[1]!))
        throw new Error(
          `Unreleased holds "### ${m[1]}", which the fragments cannot extend: ### ${SECTIONS.join(', ### ')} only`,
        );
      current = m[1];
      continue;
    }
    (current ? bySection[current] : intro).push(l);
  }
  const trim = (a: string[]) => {
    while (a.length && a[0]!.trim() === '') a.shift();
    while (a.length && a[a.length - 1]!.trim() === '') a.pop();
    return a;
  };
  for (const f of fragments)
    for (const [s, text] of Object.entries(sectionsOf(f.changelog)) as [Section, string][]) {
      const target = trim(bySection[s]);
      if (target.length) target.push('');
      target.push(...text.split('\n'));
    }
  const block: string[] = [];
  const introLines = trim(intro);
  if (introLines.length) block.push('', ...introLines);
  for (const s of SECTIONS) {
    const body = trim(bySection[s]);
    if (body.length) block.push('', `### ${s}`, '', ...body);
  }
  block.push('');
  return [...lines.slice(0, start + 1), ...block, ...lines.slice(end)].join('\n');
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
    out += `\n\n## #${n} · ${e.date.slice(0, 10)} · Claude · proposal · ${e.title.trim()}\n\n${e.body.trim()}\n`;
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

/**
 * Whether a pull request that changed these files must carry a fragment: code moved (CODE_ROOTS), no `changes/<slug>.md`
 * (a `.log.md` alone is not one), and no direct CHANGELOG edit (a release branch's).
 */
export function needsFragment(changed: readonly string[]): boolean {
  const code = changed.some((f) => CODE_ROOTS.some((r) => f.startsWith(r)));
  const fragment = changed.some(
    (f) => /^changes\/[^/]+\.md$/.test(f) && !f.endsWith('.log.md') && f !== 'changes/README.md',
  );
  const direct = changed.includes('CHANGELOG.md');
  return code && !fragment && !direct;
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** Today, or the file's time, as a local `YYYY-MM-DD` (the LOG's dates are the maintainer's days). */
const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The fragments on disk, with the date of their first commit (or the file's local day when uncommitted), oldest first. */
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
      /* no git: the file's day below */
    }
    if (!date) date = localDay(statSync(file).mtime);
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
    // The three-dot diff needs the merge base (a full history); a shallow checkout falls back to the two-dot one.
    let changed: string[];
    try {
      git('merge-base', base, 'HEAD');
      changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
    } catch {
      changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
    }
    if (needsFragment(changed)) {
      console.error(
        `✖  this branch changes the code and carries no fragment: write changes/<slug>.md (### Fixed | ### Changes | ### Breaking, then the bullets) and, for a LOG entry, changes/<slug>.log.md (## <title>, then the body). changes/README.md says how.`,
      );
      process.exit(1);
    }
    console.log(
      `✔  ${changed.length} file(s) changed against ${base}: a fragment or a CHANGELOG edit is there, or no code moved`,
    );
    process.exit(0);
  }
  if (args.includes('--assemble')) {
    if (git('rev-parse', '--is-shallow-repository') === 'true') {
      console.error(
        '✖  --assemble needs the full history (a shallow clone dates every fragment at its boundary): git fetch --unshallow',
      );
      process.exit(1);
    }
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
    const last = lastLogNumber(readFileSync(resolve(ROOT, 'docs/dev/LOG.md'), 'utf8'));
    console.log(
      `✔  ${fragments.length} fragment(s) assembled into CHANGELOG.md${withLog.length ? ` and ${withLog.length} LOG entr${withLog.length > 1 ? 'ies' : 'y'} (#${last - withLog.length + 1}…#${last})` : ''}: ${fragments.map((f) => `${f.slug} (${f.date.slice(0, 10)})`).join(', ')}`,
    );
    process.exit(0);
  }
  console.error('usage: npm run changes -- --check [--base=origin/main] | --assemble [--date=YYYY-MM-DD]');
  process.exit(2);
}
