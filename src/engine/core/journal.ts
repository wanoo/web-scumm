// The semantic journal (4.1.11 "Viewport", ADR 0011): what happened in the game, in ids, numbered by the core. The
// command handlers (core/command-handlers.ts), a room's entry (core/movement.ts) and the engine's lifecycle (a new
// session, a load, the autosave that follows an input) emit it; a painter, a menu or the presenter never do (D21). It
// is deterministic: replaying a session yields the same events (tests/journal.test.ts), which is what the dev panel
// lists, `npm run replay` compares, and the speedrun splits of 4.1.14 will read. It is not a bus for the interface:
// a kind it does not know is refused.
import type { Id, Value } from './types';

/**
 * One thing that happened in the game, numbered (`seq`, from 1, contiguous). An item handed between players
 * (`transfer`) is lost by one and acquired by the other, each with its `player`; `flagChanged` with `value: null` is a
 * flag removed (`unset`), apart from one set to `false`; `playerSwitched` is the player taking another character. `objectiveCompleted` is an objective completed (4.1.12,
 * core/objectives.ts: once, the first time its `done` holds after a transition). `slot` is reserved for a save or a load named by its slot: nothing
 * sets it yet (a slot is not part of a session, so a replay could not reproduce it).
 * @public
 */
export type SemanticEvent =
  | { seq: number; kind: 'sessionStarted'; session: string }
  | { seq: number; kind: 'roomEntered'; room: Id; from?: Id }
  | { seq: number; kind: 'itemAcquired' | 'itemLost'; item: Id; player?: Id }
  | { seq: number; kind: 'flagChanged'; flag: Id; value: Value | null }
  | { seq: number; kind: 'playerSwitched'; player: Id }
  | { seq: number; kind: 'objectiveCompleted'; objective: Id }
  | { seq: number; kind: 'endingReached'; ending: Id }
  | { seq: number; kind: 'saveMade' | 'loadMade'; slot?: string };

/** An event as the core emits it: the journal numbers it. */
export type SemanticInput = SemanticEvent extends infer E ? (E extends SemanticEvent ? Omit<E, 'seq'> : never) : never;

/** Every kind the journal accepts, in the order of the contract. */
export const SEMANTIC_KINDS = [
  'sessionStarted',
  'roomEntered',
  'itemAcquired',
  'itemLost',
  'flagChanged',
  'playerSwitched',
  'objectiveCompleted',
  'endingReached',
  'saveMade',
  'loadMade',
] as const satisfies readonly SemanticEvent['kind'][];
const KNOWN = new Set<string>(SEMANTIC_KINDS);

/**
 * What a host reads of the journal (`Engine.journal`): the last sequence number, a subscription, the events after a
 * sequence (within the window the journal keeps).
 * @public
 */
export interface SemanticJournal {
  /** The sequence number of the last event (0: none yet). */
  readonly seq: number;
  /** Called with every new event, in order; returns the unsubscribe. */
  subscribe(f: (e: SemanticEvent) => void): () => void;
  /** The events numbered after `seq`, oldest first (only those the journal still keeps). */
  since(seq: number): SemanticEvent[];
}

/** The core's journal: a bounded window of the latest events (the solver plays millions of actions on one engine). */
export class Journal implements SemanticJournal {
  private events: SemanticEvent[] = [];
  private subs = new Set<(e: SemanticEvent) => void>();
  private last = 0;
  /** Something semantic happened since the last `saveMade`. */
  private pending = false;

  constructor(readonly capacity = 10000) {}

  get seq() {
    return this.last;
  }
  /** The sequence number of the oldest event kept (seq + 1 when none is). */
  get first() {
    return this.window()[0]?.seq ?? this.last + 1;
  }

  emit(input: SemanticInput): SemanticEvent {
    if (!KNOWN.has(input.kind)) throw new Error(`unknown semantic event: ${String(input.kind)}`);
    const e = { seq: ++this.last, ...input } as SemanticEvent;
    this.events.push(e);
    // Dropped in chunks: a splice per event would make a long run quadratic.
    if (this.events.length > this.capacity + (this.capacity >> 2))
      this.events.splice(0, this.events.length - this.capacity);
    if (input.kind !== 'saveMade' && input.kind !== 'loadMade' && input.kind !== 'sessionStarted') this.pending = true;
    for (const f of this.subs) f(e);
    return e;
  }

  /** The autosave after an input: journalled when something semantic happened since the last one, else nothing. */
  saved() {
    if (!this.pending) return;
    this.pending = false;
    this.emit({ kind: 'saveMade' });
  }

  subscribe(f: (e: SemanticEvent) => void): () => void {
    this.subs.add(f);
    return () => {
      this.subs.delete(f);
    };
  }

  since(seq: number): SemanticEvent[] {
    return this.window().filter((e) => e.seq > seq);
  }

  /** The events kept: the last `capacity` (the array holds up to a quarter more between two drops). */
  private window(): SemanticEvent[] {
    return this.events.length > this.capacity ? this.events.slice(-this.capacity) : this.events;
  }
}

/** Whether a value read from a file is an event of a known kind (a session file is data, not the engine's word). */
export function isSemanticEvent(x: unknown): x is SemanticEvent {
  return !!x && typeof x === 'object' && KNOWN.has((x as { kind?: string }).kind ?? '');
}

/** The first index where two journals differ, sequence numbers aside; -1 when they are the same. */
export function journalDiff(a: readonly SemanticEvent[], b: readonly SemanticEvent[]): number {
  const strip = ({ seq: _, ...rest }: SemanticEvent) => JSON.stringify(rest, Object.keys(rest).sort());
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i],
      y = b[i];
    if (!x || !y || strip(x) !== strip(y)) return i;
  }
  return -1;
}

/** One line for an event (the dev panel, `npm run replay`). */
export function describeEvent(e: SemanticEvent): string {
  switch (e.kind) {
    case 'sessionStarted':
      return `session ${e.session}`;
    case 'roomEntered':
      return `${e.from ? `${e.from} → ` : ''}${e.room}`;
    case 'itemAcquired':
      return `+ ${e.item}${e.player ? ` (${e.player})` : ''}`;
    case 'itemLost':
      return `− ${e.item}${e.player ? ` (${e.player})` : ''}`;
    case 'playerSwitched':
      return `→ ${e.player}`;
    case 'flagChanged':
      return `${e.flag} = ${JSON.stringify(e.value)}`;
    case 'objectiveCompleted':
      return `objective ${e.objective}`;
    case 'endingReached':
      return `ending ${e.ending}`;
    default:
      return e.slot ? `slot ${e.slot}` : '';
  }
}
