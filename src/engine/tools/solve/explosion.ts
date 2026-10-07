// The explosion profile (4.1.13, `npm run solve -- --profile`, docs/dev/PROOF-PROFILE.md): the states a search
// reached, attributed to the dimensions of the matrix's sheet. Each state's (dimension, value) pairs fall in one of
// five families: where the characters stand (positions), what they hold (inventories), the flags and counters a
// dialogue writes, those a script or an event writes, and the others. For each family: how many distinct values it
// took over the states, and how many states would merge if it were dropped (what it multiplies). The three other
// dimensions of the sheet are counts of what never became a state: symmetries folded (the canonical character, the
// symmetric items), actions without effect (no-ops, the memo's skips), and permutations of independent actions (a
// transition landing on a state already seen, an order postponed by the reduction).
import { cmdLists, eachCmd } from '../../core/cmds';
import type { GameDef } from '../../core/types';
import type { Dims } from './abstractions';
import type { SolveProfile } from './report';

type Family = 'positions' | 'inventories' | 'dialogues' | 'scripts' | 'flags';

export interface Explosion {
  /** States the families were measured on (the first 50 000 a large search stored). */
  measured: number;
  families: { family: Family; dims: number; values: number; split: number }[];
  symmetries: { folded: number; classes: number };
  noops: { tries: number; memoSkipped: number };
  permutations: { landedOnKnown: number; postponed: number };
}

/** The flags a dialogue writes, and those a script or an event writes (from where the commands live). */
function writers(game: GameDef) {
  const talk = new Set<string>(),
    script = new Set<string>();
  for (const { list, path } of cmdLists(game)) {
    const into = path.includes('talk.') ? talk : path.includes('scripts.') || path.includes('events[') ? script : null;
    if (!into) continue;
    eachCmd(list, (c) => {
      if (typeof c === 'string') return;
      if ('set' in c) into.add(Array.isArray(c.set) ? c.set[0] : c.set);
      else if ('unset' in c) into.add(c.unset);
      else if ('inc' in c) into.add(c.inc);
    });
  }
  return { talk, script };
}

/** The pairs of one state that belong to a family; a position (`pos:` / `player:`) splits into its room and its bag. */
function project(d: Dims, keep: (f: Family) => boolean, familyOf: (k: string) => Family): string {
  const out: string[] = [];
  for (const [k, v] of d) {
    if (k.startsWith('pos:') || k.startsWith('player:')) {
      const i = v.indexOf(' ');
      const room = i < 0 ? v : v.slice(0, i),
        bag = i < 0 ? '' : v.slice(i + 1);
      out.push(`${k}=${keep('positions') ? room : ''}|${keep('inventories') ? bag : ''}`);
    } else if (keep(familyOf(k))) out.push(`${k}=${v}`);
  }
  return out.join('\u0001');
}

export function explosion(all: Dims[], game: GameDef, p: SolveProfile): Explosion {
  const { talk, script } = writers(game);
  const familyOf = (k: string): Family => {
    if (k === 'room' || k === 'active' || k.startsWith('where:')) return 'positions';
    if (k.startsWith('item:') || k.startsWith('used:') || k.startsWith('pool:')) return 'inventories';
    if (k.startsWith('script:') || k.startsWith('seen:event.') || k === 'reality') return 'scripts';
    if (k.startsWith('flag:')) {
      const f = k.slice(5);
      return talk.has(f) ? 'dialogues' : script.has(f) ? 'scripts' : 'flags';
    }
    return 'flags';
  };
  const families: Family[] = ['positions', 'inventories', 'flags', 'dialogues', 'scripts'];
  const rows = families.map((family) => {
    const keys = new Set<string>();
    const both = family === 'positions' || family === 'inventories';
    for (const d of all)
      for (const [k] of d)
        if (k.startsWith('pos:') || k.startsWith('player:') ? both : familyOf(k) === family) keys.add(k);
    const without = new Set(all.map((d) => project(d, (f) => f !== family, familyOf)));
    const only = new Set(all.map((d) => project(d, (f) => f === family, familyOf)));
    return { family, dims: keys.size, values: only.size, split: all.length - without.size };
  });
  return {
    measured: all.length,
    families: rows,
    symmetries: { folded: p.canonical.folded, classes: p.symmetry?.classes.length ?? 0 },
    noops: { tries: p.noops, memoSkipped: Math.max(0, p.memo.hits - p.memo.verified) },
    permutations: { landedOnKnown: p.hashHits, postponed: p.postponed },
  };
}

/** The explosion profile as text (the solver's `--profile`, PROOF-PROFILE.md). */
export function explosionText(x: Explosion): string[] {
  const out = [`Explosion: what multiplies the ${x.measured} states measured (states that would merge without it)`];
  for (const r of x.families)
    out.push(
      `  ${r.family.padEnd(12)} ${String(r.split).padStart(8)}  (${r.values} distinct values over ${r.dims} dimension(s))`,
    );
  out.push(
    `  symmetries   ${x.symmetries.folded} character switches folded, ${x.symmetries.classes} class(es) of symmetric items`,
    `  no-ops       ${x.noops.tries} tries changed nothing (${x.noops.memoSkipped} of them not even run: the memo knew)`,
    `  permutations ${x.permutations.landedOnKnown} transitions landed on a state already seen${x.permutations.postponed ? `, ${x.permutations.postponed} postponed by the reduction` : ''}`,
  );
  return out;
}
