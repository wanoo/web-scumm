// The nightly corpus in shards (3.7.1): which seeds each job runs, and whether the shards put back together cover the
// seeds asked for, each once. Pure: tools/audit-corpus.ts runs and merges them.

/** Seeds `from`…`from + seeds - 1` of shard `i` of `n` over `total` seeds from 1: as even as can be, never past `total`. */
export function shardRange(total: number, i: number, n: number): { from: number; seeds: number } {
  const lo = Math.floor((i * total) / n), hi = Math.floor(((i + 1) * total) / n);
  return { from: lo + 1, seeds: hi - lo };
}

/** What is wrong with these shards as a cover of seeds 1…`total` (or of their own span): gaps and overlaps. */
export function shardProblems(shards: { from: number; seeds: number }[], total?: number): string[] {
  const s = [...shards].filter((x) => x.seeds > 0).sort((a, b) => a.from - b.from);
  const out: string[] = [];
  let next = total !== undefined ? 1 : (s[0]?.from ?? 1);
  for (const x of s) {
    if (x.from > next) out.push(`seeds ${next}–${x.from - 1}: no shard ran them`);
    if (x.from < next) out.push(`seeds ${x.from}–${Math.min(next, x.from + x.seeds) - 1}: run by more than one shard`);
    next = Math.max(next, x.from + x.seeds);
  }
  if (total !== undefined && next <= total) out.push(`seeds ${next}–${total}: no shard ran them`);
  if (total !== undefined && next > total + 1) out.push(`seeds ${total + 1}–${next - 1}: past the ${total} asked for`);
  return out;
}
