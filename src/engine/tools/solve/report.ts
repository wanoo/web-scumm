// What a search returns and how it reads: the result, its profile, the path as labels and as session entries, the profile in text.
import type { ExitCode, SolveStatus } from '../status';
import type { Action } from '../../core/engine';
import type { GameDef, GameState, Id, SessionEntry } from '../../core/types';
import type { SearchNode } from './model';

/** What the solver measured: where the states come from, what the search cost (`npm run solve -- --profile`). */
export interface SolveProfile {
  ms: number;
  states: number;
  /** Engine runs (one per candidate action per expanded state). */
  tries: number;
  /** Tries that changed nothing (a fallback line, decor): cost time, not states. */
  noops: number;
  /** Candidate actions not even run: no written rule could answer them. */
  skipped: number;
  /** Actions not run because an independent one was tried before them on the way (`por: 'sleep'`). */
  slept: number;
  /** States reached but left to a commuting order (`por: 'stubborn'`). */
  postponed: number;
  /** Tries that landed on a state already seen. */
  hashHits: number;
  maxQueue: number;
  branching: {
    avg: number;
    max: number;
    worst?: { room: string; inventory: string[]; tries: number; effective: number; byVerb: Record<string, number> };
  };
  /** Per room (summed over its expansions): candidate use/give pairs, how many a written rule answered, how many could only fall to the fallback line. */
  fallbackByRoom: Record<string, { candidates: number; rules: number; fallback: number }>;
  /** The dimensions of the state that split it most: how many states would merge if that one were dropped. */
  dims: { key: string; split: number; values: number }[];
  perRoom: Record<string, number>;
  /** Times each rule, topic, listener or script step answered a try that changed the state (puzzle graph ids). */
  perAction: Record<string, number>;
  /** Times each one answered a try at all, whether or not the state changed: reachability reads this, not `perAction`. */
  attempted: Record<string, number>;
  /** Flags never unset or lowered, items never lost: once gained, kept (what dominance pruning could use). */
  monotonic: { flags: string[]; items: string[] };
  /** Boolean dimensions that evolve independently: their combinations multiply the states (a checkpoint between them helps). */
  independent: { dims: string[]; combos: number; product: number }[];
  /**
   * Where the search's time went, in ms: listing the tries of a state (`tries`), building engines (`engine`), copying
   * states (`clone`), running the engine on a try (`run`), turning states into hashes (`hash`), the queue (`queue`),
   * the rest of the loop (`other`), and after the loop the softlock classification (`classify`).
   */
  timing: Record<'tries' | 'engine' | 'clone' | 'run' | 'hash' | 'queue' | 'other' | 'classify', number>;
  /** Positions of the playable characters among the states: distinct (active, room per character) combinations. */
  positions: number;
  /** The canonical character (`canonicalPlayers`): whether it applied, switches folded into the next action, switches kept explicit. */
  canonical: { applied: boolean; folded: number; explicit: number; reason?: string };
  /** Mobility regions: whether they applied, macro moves offered, the largest region, why they were turned off. */
  mobility: { applied: boolean; moves: number; largest: number; reason?: string };
  /**
   * The no-op memo (`memo`): runs that wrote nothing, kept with what they read (`stored`); tries skipped because the
   * same action already wrote nothing on the same values (`hits`); hits run anyway and found identical (`verified`);
   * no-op runs not kept because they wrote something back or read something the memo cannot value (`refused`).
   */
  memo: { applied: boolean; stored: number; hits: number; verified: number; refused: number; reason?: string };
  /** Witness dominance: states not explored because one already seen had as much progress. */
  dominance?: { applied: boolean; pruned: number; reason?: string };
  /** The canonical owner: the items pooled, the hand-overs played, why it is off. */
  ownership?: { applied: boolean; items: Id[]; handovers: number; reason?: string };
  /** Proof workers (`workers`): how many expanded, the batch, and why this thread expanded instead when it did. */
  workers?: { workers: number; batch: number; reason?: string };
  /** Why the search stopped early: the state budget (`maxStates`) or the time (`timeLimitMs`). */
  stoppedBy?: 'states' | 'time';
}

/**
 * The verdict of a search: its status, exit code and headline, the path found, the softlocks and the search's
 * statistics.
 * @public
 */
export interface SolveResult {
  /** Honest outcome of the requested search. `solved` in witness mode means that at least one path exists. */
  status: SolveStatus;
  /** The status as an exit code and a sentence (`src/engine/tools/status.ts`): what every tool prints. */
  exit: ExitCode;
  headline: string;
  /** Search contract used for this result. */
  mode: 'witness' | 'prove';
  /** A game with `reality` (4.1.1): the world the verdict holds in (`realityLabel`). */
  reality?: string;
  /** The game reaches the sealed ending or the ending. */
  finished: boolean;
  /** Path found to the ending (or to the last explored state). Not necessarily the shortest. */
  path: string[];
  /** The same path as session entries: `replay()` plays it, the e2e harness taps it. */
  steps: SessionEntry[];
  states: number;
  truncated: boolean;
  flagsReached: string[];
  /**
   * The flags the search keys its states on (3.6): those that can still matter to the goal. A dead flag is left out of
   * the states, so whether it shows in `flagsReached` depends on which of two merged states was kept.
   */
  liveFlags: string[];
  unlockedReached: string[];
  roomsReached: string[];
  /** Game items that never trigger a written reaction (neither gained nor used). */
  unusedItems: string[];
  /** Items obtained that are never used in a rule. */
  itemsNeverUsed: string[];
  /** States with no action that changes anything (other than the ending). */
  deadEnds: { path: string[]; room: string; inventory: string[] }[];
  /** Reachable states that cannot reach the goal (only complete in `prove` mode). */
  softlocks: { path: string[]; room: string; inventory: string[] }[];
  /** Modelling assumptions made by the solver. */
  assumptions: string[];
  errors: string[];
  /** Invariants that became true (index in `game.invariants`), with the path that broke them. */
  broken: { invariant: number; path: string[] }[];
  /** Proof mode: how many reachable states cannot reach the goal any more (`softlocks` holds at most 20 samples). */
  softlockCount: number;
  /** Proof mode: the softlocks grouped by the step that lost the game (the first action from a safe state into an unsafe one). */
  softlockCauses: { action: string; room: Id; count: number; sample: string[] }[];
  /** Proof mode with a `goal`: every reachable state where the goal holds (a chapter's boundary; `proveChapters` starts the next chapter from each). */
  boundaries: GameState[];
  profile: SolveProfile;
}

/** The labelled path to a node, rebuilt from its parents. */
export function pathOf(n: SearchNode): string[] {
  const parts: string[][] = [];
  for (let x: SearchNode | undefined = n; x; x = x.prev) parts.push(x.tail);
  return parts.reverse().flat();
}

/** The session entries to a node, rebuilt from its parents. */
export function stepsOf(n: SearchNode): SessionEntry[] {
  const parts: SessionEntry[][] = [];
  for (let x: SearchNode | undefined = n; x; x = x.prev) parts.push(x.tailSteps);
  return parts.reverse().flat();
}

export function label(game: GameDef, a: Action): string {
  const v = game.verbs.find((x) => x.id === a.verb);
  return a.b ? `${v?.label ?? a.verb} ${a.a} ${v?.join ?? '→'} ${a.b}` : `${v?.label ?? a.verb} ${a.a}`;
}

/** What each abstraction of the search did: one line each, the same in the text profile, the Studio and the tools. */
function abstractionLines(p: SolveProfile): string[] {
  const off = (r?: string) => `off${r ? ` (${r})` : ''}`;
  return [
    `  canonical character   ${p.canonical.applied ? `${p.canonical.folded} switches folded, ${p.canonical.explicit} kept explicit` : off(p.canonical.reason)}`,
    `  mobility regions      ${p.mobility.applied ? `${p.mobility.moves} macro moves, largest region ${p.mobility.largest} rooms` : off(p.mobility.reason)}`,
    `  no-op memo            ${p.memo.applied ? `${p.memo.hits} runs skipped (${p.memo.verified} of them run anyway and identical), ${p.memo.stored} kept, ${p.memo.refused} refused` : off(p.memo.reason)}`,
    ...(p.dominance?.applied || p.dominance?.pruned
      ? [
          `  witness dominance     ${p.dominance.applied ? `${p.dominance.pruned} states not explored` : off(p.dominance.reason)}`,
        ]
      : []),
    ...(p.ownership
      ? [
          `  canonical owner       ${p.ownership.applied ? `${p.ownership.items.length} item(s) pooled, ${p.ownership.handovers} hand-overs played` : off(p.ownership.reason)}`,
        ]
      : []),
    ...(p.workers && p.workers.batch > 1
      ? [
          `  workers               ${p.workers.workers} expanding batches of ${p.workers.batch}${p.workers.reason ? ` (${p.workers.reason})` : ''}; times below are summed over them`,
        ]
      : []),
    ...(p.stoppedBy
      ? [`  stopped by            ${p.stoppedBy === 'time' ? 'the time limit (--time)' : 'the state budget (--max)'}`]
      : []),
  ];
}

/** The profile as text (`npm run solve -- --profile`, the Studio, the `solve` tool). */
export function profileText(p: SolveProfile, game?: GameDef): string {
  const out: string[] = [];
  const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '0%');
  const name = (key: string) => {
    if (!key.includes(':')) return key;
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (!game) return key;
    if (kind === 'item') return `item ${game.items[id]?.name ?? id}`;
    if (kind === 'place') return `place ${game.map?.places[id]?.name ?? id}`;
    return `${kind} ${id}`;
  };
  out.push(
    'SOLVER PROFILE',
    `  states explored       ${p.states}`,
    `  engine runs           ${p.tries}  (${p.noops} tries changed nothing${p.memo.hits > p.memo.verified ? `, ${p.memo.hits - p.memo.verified} of them not run: the no-op memo knew` : ''}; ${p.hashHits} landed on a known state)`,
    `  actions not run       ${p.skipped}  (no rule could answer them)${p.slept ? `, ${p.slept} asleep (an independent one came first)` : ''}${p.postponed ? `, ${p.postponed} states left to a commuting order` : ''}`,
    `  max queue             ${p.maxQueue}`,
    `  time                  ${(p.ms / 1000).toFixed(1)} s`,
    `  actions per state     ${p.branching.avg.toFixed(1)} on average, ${p.branching.max} at most${
      p.branching.worst
        ? ` (${p.branching.worst.room}, ${p.branching.worst.inventory.length} items in the bag: ${Object.entries(
            p.branching.worst.byVerb,
          )
            .map(([v, n]) => `${n} ${v}`)
            .join(', ')} changed something)`
        : ''
    }`,
  );
  out.push('', 'Abstractions (what each one did, or why it is off):', ...abstractionLines(p));
  if (p.dims.length) {
    out.push('', 'What splits the states (states that would merge without it):');
    for (const d of p.dims.filter((x) => x.split > 0).slice(0, 15))
      out.push(`  ${String(d.split).padStart(6)}  ${name(d.key)}  (${d.values} values)`);
  }
  const rooms = Object.entries(p.perRoom).sort((a, b) => b[1] - a[1]);
  if (rooms.length)
    out.push(
      '',
      'States by room:',
      ...rooms.slice(0, 12).map(([r, n]) => `  ${String(n).padStart(6)}  ${r}  (${pct(n, p.states)})`),
    );
  const acts = Object.entries(p.perAction).sort((a, b) => b[1] - a[1]);
  if (acts.length)
    out.push(
      '',
      'What answered most (rules, topics, listeners, script steps):',
      ...acts.slice(0, 12).map(([a, n]) => `  ${String(n).padStart(6)}  ${a}`),
    );
  const fbs = Object.entries(p.fallbackByRoom)
    .filter(([, f]) => f.candidates)
    .sort((a, b) => b[1].fallback - a[1].fallback);
  if (fbs.length)
    out.push(
      '',
      'Use / give combinations per room (over its expansions):',
      ...fbs
        .slice(0, 12)
        .map(
          ([r, f]) =>
            `  ${r}: ${f.candidates} candidates, ${f.rules} answered by a rule, ${f.fallback} could only fall back (${pct(f.fallback, f.candidates)} useless)`,
        ),
    );
  if (p.independent.length) {
    out.push(
      '',
      'Independent dimensions (their combinations multiply the states; a checkpoint between them would cut it):',
    );
    for (const g of p.independent)
      out.push(`  ⚠ ${g.dims.map(name).join(', ')}: ${g.combos} of ${g.product} combinations seen`);
  }
  out.push(
    '',
    `Monotonic (never lost once gained): ${p.monotonic.flags.length} flags, ${p.monotonic.items.length} items${p.monotonic.items.length ? ` (${p.monotonic.items.slice(0, 8).join(', ')}${p.monotonic.items.length > 8 ? '…' : ''})` : ''}`,
  );
  return out.join('\n');
}
