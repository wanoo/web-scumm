// npx tsx tools/coverage-ratchet.ts [--summary=.cache/coverage/coverage-summary.json] (4.1.3): the coverage floors of
// vite.config.ts against what `npm run test:coverage` measured. Vitest already fails a floor that is not met; this says
// the other direction, so a floor never silently stays far below what the tests reach: a global measure or a listed
// file three points or more above its floor is a ratchet to make, printed as a warning (`--strict` fails on it). On
// GitHub Actions each one is also an annotation (4.1.9): `::warning::` on a pull request, `::error::` under `--strict`
// (main, a tag, the nightly, release-check), so a pull request shows the ratchet to make without failing on it.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './game';
import { flushExit } from './flush';

const args = process.argv.slice(2);
const file = resolve(
  ROOT,
  args.find((a) => a.startsWith('--summary='))?.slice(10) ?? '.cache/coverage/coverage-summary.json',
);
const strict = args.includes('--strict');
const MARGIN = 3;

type Metric = { pct: number };
type Entry = Record<'lines' | 'statements' | 'functions' | 'branches', Metric>;

if (!existsSync(file)) {
  console.error(`✖  ${file}: no coverage summary (npm run test:coverage first)`);
  await flushExit(2);
}
const summary = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Entry>;
const config = (await import('../vite.config')).default as {
  test?: { coverage?: { thresholds?: Record<string, number | Record<string, number>> } };
};
const thresholds = config.test?.coverage?.thresholds ?? {};
const slack: string[] = [];
const say = (where: string, metric: string, floor: number, got: number) => {
  if (got - floor >= MARGIN) slack.push(`${where} ${metric}: floor ${floor}, measured ${got.toFixed(2)}`);
};
for (const [k, v] of Object.entries(thresholds)) {
  if (typeof v === 'number') {
    const got = summary.total?.[k as keyof Entry]?.pct;
    if (got !== undefined) say('total', k, v, got);
    continue;
  }
  const entry = Object.entries(summary).find(([path]) => path.endsWith(`/${k}`) || path === k)?.[1];
  if (!entry) continue;
  for (const [metric, floor] of Object.entries(v)) {
    const got = entry[metric as keyof Entry]?.pct;
    if (got !== undefined) say(k, metric, floor, got);
  }
}
for (const line of slack) console.log(`  ⚠ ${line}`);
if (process.env.GITHUB_ACTIONS === 'true')
  for (const line of slack)
    console.log(`::${strict ? 'error' : 'warning'} title=coverage ratchet::${line}: raise it in vite.config.ts`);
console.log(
  slack.length
    ? `${strict ? '✖' : '⚠'}  ${slack.length} floor(s) at least ${MARGIN} points below what the tests reach: raise them in vite.config.ts`
    : '✔  every coverage floor is within three points of what the tests reach',
);
await flushExit(strict && slack.length ? 1 : 0);
