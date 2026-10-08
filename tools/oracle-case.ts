// npx tsx tools/oracle-case.ts --case="<id>" --out=<file>   one case of the solver's oracle, written in full
// npx tsx tools/oracle-case.ts --diff <before.json> <after.json>   what differs between two such files, by meaning
// (4.1.17, plan §5.1). The oracle (tests/solver-oracle.test.ts) keeps digests only: when one moves, this says which
// field, the first session entry that differs, the flags added, removed or reordered, the first reachable state that
// differs, and the engine, Node and options of each side. Run the case on each commit to compare (the tool is copied
// into an older checkout when it predates it); a fixture is written again only with a decision in the LOG.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

interface CaseFile {
  case: string;
  commit: string;
  engine: string;
  node: string;
  opts: Record<string, unknown>;
  signature: Record<string, unknown>;
  steps: unknown[];
  path: unknown[];
  flagsReached: string[];
  roomsReached: string[];
  reachable: string[];
}

/** The meaningful difference of two case files, as lines; [] when they agree. */
export function diffCases(a: CaseFile, b: CaseFile): string[] {
  const out: string[] = [];
  out.push(`before: ${a.case} on ${a.commit.slice(0, 12)} (engine ${a.engine}, Node ${a.node})`);
  out.push(`after:  ${b.case} on ${b.commit.slice(0, 12)} (engine ${b.engine}, Node ${b.node})`);
  const opts = JSON.stringify(a.opts) !== JSON.stringify(b.opts);
  if (opts) out.push(`options: ${JSON.stringify(a.opts)} → ${JSON.stringify(b.opts)}`);
  const fields = Object.keys({ ...a.signature, ...b.signature }).filter(
    (k) => JSON.stringify(a.signature[k]) !== JSON.stringify(b.signature[k]),
  );
  // Two runs with other options are not the same case, whatever their digests say.
  if (!fields.length) return opts ? out : [];
  out.push(`fields that differ: ${fields.join(', ')}`);
  const n = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++)
    if (JSON.stringify(a.steps[i]) !== JSON.stringify(b.steps[i])) {
      out.push(`first session entry that differs: #${i} of ${a.steps.length} → ${b.steps.length}`);
      out.push(`  before: ${JSON.stringify(a.steps[i])}`);
      out.push(`  after:  ${JSON.stringify(b.steps[i])}`);
      const keys = (x: unknown) => Object.keys((x ?? {}) as object);
      const added = keys(b.steps[i]).filter((k) => !keys(a.steps[i]).includes(k));
      const gone = keys(a.steps[i]).filter((k) => !keys(b.steps[i]).includes(k));
      if (added.length || gone.length)
        out.push(`  keys added: ${added.join(', ') || '—'}; removed: ${gone.join(', ') || '—'}`);
      break;
    }
  const fa = new Set(a.flagsReached);
  const fb = new Set(b.flagsReached);
  const added = b.flagsReached.filter((f) => !fa.has(f));
  const removed = a.flagsReached.filter((f) => !fb.has(f));
  if (added.length) out.push(`flags added: ${added.join(', ')}`);
  if (removed.length) out.push(`flags removed: ${removed.join(', ')}`);
  if (!added.length && !removed.length && JSON.stringify(a.flagsReached) !== JSON.stringify(b.flagsReached))
    out.push('flags reordered');
  const ra = [...a.reachable].sort();
  const rb = [...b.reachable].sort();
  const found = ra.findIndex((x, i) => x !== rb[i]);
  // One list a prefix of the other: the first state only the longer has.
  const k = found >= 0 ? found : Math.min(ra.length, rb.length);
  if (found >= 0 || ra.length !== rb.length)
    out.push(`reachable: ${ra.length} → ${rb.length} states; first that differs: ${ra[k] ?? '—'} → ${rb[k] ?? '—'}`);
  else out.push(`reachable: the same ${ra.length} states`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  if (args[0] === '--diff') {
    if (args.length < 3) {
      console.error('usage: npx tsx tools/oracle-case.ts --diff <before.json> <after.json>');
      process.exit(2);
    }
    const [a, b] = args.slice(1).map((f) => JSON.parse(readFileSync(f, 'utf8')) as CaseFile);
    const lines = diffCases(a!, b!);
    console.log(lines.length ? lines.join('\n') : '✔  the two runs agree on every field the oracle compares');
    process.exit(lines.length ? 1 : 0);
  }
  const id = args.find((x) => x.startsWith('--case='))?.slice(7);
  const out = args.find((x) => x.startsWith('--out='))?.slice(6);
  if (!id || !out) {
    console.error('usage: npx tsx tools/oracle-case.ts --case="<id>" --out=<file>  |  --diff <before> <after>');
    process.exit(2);
  }
  const { execFileSync } = await import('node:child_process');
  const { solve } = await import('../src/engine/tools/solve');
  const { oracleCases, signature } = await import('../tests/gen/oracle');
  const c = oracleCases().find((x) => x.id === id);
  if (!c) throw new Error(`no oracle case "${id}"`);
  const r = await solve(structuredClone(c.game), c.layouts, { ...c.opts, keepReachable: true });
  const { commands: _, ...opts } = c.opts as Record<string, unknown>;
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const file: CaseFile = {
    case: id,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    engine: pkg.version,
    node: process.version,
    opts,
    signature: signature(r),
    steps: r.steps,
    path: r.path,
    flagsReached: r.flagsReached,
    roomsReached: r.roomsReached,
    reachable: r.reachable ?? [],
  };
  writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`✔  ${id}: ${r.status}, ${r.states} states, written to ${out}`);
}
