// The run's tape (4.1.14 "Time Attack", ADR 0016): every session entry as one link of the run's chain, with what
// happened while it ran. The live recorder and the verifier attach the same tape to their engine, so a link is derived
// the same way on the player's phone and on the machine that replays it: the entry (as it closed), its draws, the
// semantic events from its beginning to the next entry's, and the run clock's readings when the next entry began.
// A link is handed out once its entry closed and the next one began (or the run was sealed), in the log's order.
import type { SemanticEvent, SemanticInput } from './journal';
import type { SessionListener } from './session-runtime';
import type { SessionEntry } from './types';
import type { Engine } from './engine';

/** One link of the run: the data a hash of the chain covers (bigints as decimal strings). */
export interface TapeLink {
  /** The entry's position in the run (from 0, across sessions and chunks). */
  index: number;
  /** The entry as it closed. */
  entry: SessionEntry;
  /** The semantic events from its beginning to the next entry's, without their sequence numbers. */
  events: SemanticInput[];
  logicalSteps: string;
  logicalTime: string;
  activeTime: string;
}

interface Open {
  entry: SessionEntry;
  closed: boolean;
  /** The journal's sequence when this entry began (the first link: when the tape started). */
  from: number;
  /** Set when the next entry began (or at the seal): the events' end and the clock's readings. */
  to?: { seq: number; steps: bigint; time: bigint; active: bigint };
}

const strip = ({ seq: _, ...e }: SemanticEvent): SemanticInput => e as SemanticInput;

/** Records an engine's entries as links, in order. `detach()` stops it; `seal()` hands out the last link. */
export class RunTape {
  private pending: Open[] = [];
  private next = 0;
  private events: SemanticEvent[] = [];
  private muted = false;
  private offJournal: () => void;
  private listener: SessionListener;
  /** The first index not yet handed out. */
  private emitted = 0;
  /** The entry that began last (its readings end when the next begins). */
  private last: Open | null = null;
  /** The journal's sequence when the tape started: the first link's events start after it. */
  private readonly origin: number;

  constructor(
    private eng: Engine,
    private onLink: (l: TapeLink) => void,
    /** The index of the first entry this tape sees (a resumed run continues its numbering). */
    first = 0,
  ) {
    this.next = first;
    this.emitted = first;
    this.origin = eng.journal.seq;
    this.offJournal = eng.journal.subscribe((e) => {
      if (!this.muted) this.events.push(e);
    });
    this.listener = {
      begin: (entry) => this.begin(entry),
      end: (entry) => this.end(entry),
    };
    eng.sessions.listeners.add(this.listener);
  }

  /** The index the next entry will take. */
  get size(): number {
    return this.next;
  }

  /** Runs `f` with the journal unheard (a resumed run's own load: nothing a replay would see). */
  async mute<T>(f: () => Promise<T>): Promise<T> {
    this.muted = true;
    try {
      return await f();
    } finally {
      this.muted = false;
    }
  }

  private mark() {
    const c = this.eng.runClock;
    return { seq: this.eng.journal.seq, steps: c.logicalSteps(), time: c.logicalTime(), active: c.activeTime() };
  }

  private begin(entry: SessionEntry) {
    const m = this.mark();
    if (this.last && !this.last.to) this.last.to = m;
    // The first link takes every event since the tape started (a new game's `sessionStarted`).
    this.last = { entry, closed: false, from: this.last ? m.seq : this.origin };
    this.pending.push(this.last);
    this.next++;
    this.flush();
  }

  private end(entry: SessionEntry) {
    const o = this.pending.find((p) => p.entry === entry);
    if (o) o.closed = true;
    this.flush();
  }

  private flush() {
    while (this.pending.length) {
      const o = this.pending[0]!;
      if (!o.closed || !o.to) return;
      this.pending.shift();
      const { to } = o;
      const events = this.events.filter((e) => e.seq > o.from && e.seq <= to.seq).map(strip);
      this.events = this.events.filter((e) => e.seq > to.seq);
      this.onLink({
        index: this.emitted++,
        entry: structuredClone(o.entry),
        events,
        logicalSteps: to.steps.toString(),
        logicalTime: to.time.toString(),
        activeTime: to.active.toString(),
      });
    }
  }

  /** Ends the run here: the last entries' readings are taken now and handed out (an open entry is closed as is). */
  seal(): void {
    const m = this.mark();
    for (const o of this.pending) {
      o.closed = true;
      if (!o.to) o.to = m;
    }
    this.flush();
  }

  detach(): void {
    this.offJournal();
    this.eng.sessions.listeners.delete(this.listener);
  }
}
