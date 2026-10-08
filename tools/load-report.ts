// npx tsx tools/load-report.ts <report.json> --store=sqlite|postgres [--commit=<sha>] (4.1.17, plan §4.1): a load report
// is evidence only when it is there, complete and of the backend the job names. The 4.1.16 nightly's SQLite row never
// opened SQLite (an empty BRIDGE_STORE) and left no report, and nothing failed for the missing file; this does.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The store `bridge:load` measures: `--store=`, else BRIDGE_STORE, else SQLite. An empty value is no value (`||`, not
 * `??`: the 4.1.16 nightly passed "" and the tool kept it).
 */
export function loadSpec(argv: string[], env: NodeJS.ProcessEnv): string {
  const spec = argv.find((a) => a.startsWith('--store='))?.slice('--store='.length) || env.BRIDGE_STORE || 'sqlite';
  if (spec !== 'sqlite' && !/^postgres(ql)?:\/\//.test(spec))
    throw new Error(`bridge:load measures sqlite or postgres://…, not "${spec}"`);
  return spec;
}

/** What is wrong with a `bridge:load` report for `store` (and `commit`, when given); [] when nothing is. */
export function checkLoadReport(report: unknown, want: { store: string; commit?: string }): string[] {
  if (!report || typeof report !== 'object') return ['not a report'];
  const r = report as Record<string, unknown>;
  const bad: string[] = [];
  if (r.store !== want.store) bad.push(`the report measured ${String(r.store)}, not ${want.store}`);
  if (want.commit && r.commit !== want.commit) bad.push(`the report is of ${String(r.commit)}, not ${want.commit}`);
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : Number.NaN);
  for (const k of ['instances', 'players', 'proposals', 'seconds', 'rows', 'gaps'])
    if (!Number.isFinite(n(k))) bad.push(`${k}: missing`);
  if (Number.isFinite(n('proposals')) && n('proposals') <= 0) bad.push('no proposal was sent');
  if (Number.isFinite(n('rows')) && n('rows') !== n('proposals'))
    bad.push(`${n('rows')} rows for ${n('proposals')} proposals`);
  if (n('gaps') !== 0 && Number.isFinite(n('gaps'))) bad.push(`${n('gaps')} players with a gap in their sequence`);
  const statuses = (r.statuses ?? {}) as Record<string, number>;
  if ((statuses['202'] ?? 0) !== n('proposals'))
    bad.push(`${statuses['202'] ?? 0} proposals accepted of ${n('proposals')}`);
  const streams = r.streams as { followed?: number; complete?: number } | undefined;
  if (!streams || streams.complete !== streams.followed) bad.push('a followed stream is incomplete');
  if (!(r.machine as { node?: string } | undefined)?.node) bad.push('machine: missing');
  return bad;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const store = flag('store');
  if (!file || !store) {
    console.error('usage: npx tsx tools/load-report.ts <report.json> --store=sqlite|postgres [--commit=<sha>]');
    process.exit(2);
  }
  const commit = flag('commit');
  const bad = existsSync(file)
    ? checkLoadReport(JSON.parse(readFileSync(file, 'utf8')), { store, ...(commit ? { commit } : {}) })
    : [`${file}: no report (a load run that leaves none measured nothing)`];
  for (const b of bad) console.error(`✖  ${b}`);
  if (!bad.length) console.log(`✔  ${file}: ${store}, complete`);
  process.exit(bad.length ? 1 : 0);
}
