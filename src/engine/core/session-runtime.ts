// The session: what each input recorded (entries, the answers given while it ran, digests), fed back by a replay.
// Its owner since 4.1.5 (`Engine.sessions`): the feed, the open entries and the clock's origin live here, where
// 4.1.0 kept them on the Engine for these functions; the Engine's methods of the same name forward here.
import { stateDigest } from './diff';
import type { GameDef, GameState, Id, Session, SessionEntry } from './types';
import type { Presenter } from './ports';
import { SESSION_MAX } from './engine-shared';

/** What the session reads from its engine: the game, the state, the clock, the randomness, and whom it asks. */
export interface SessionHost {
  readonly game: GameDef;
  readonly state: GameState;
  clock: (() => number) | null;
  random: () => number;
  readonly ui: Pick<Presenter, 'choose' | 'openMap'>;
}

/** An entry being answered: its recorded twin when replaying, and how far into its picks, maps and draws it is. */
export interface OpenEntry {
  entry: SessionEntry;
  src?: SessionEntry;
  pi: number;
  mi: number;
  ri: number;
  steps: number;
}

export class SessionLog {
  /**
   * The session: the player's inputs since the game started or a save was loaded, with the answers given on the way
   * (`SessionEntry`). Always recorded: exported with a save, it is the bug report `replay()` reproduces.
   */
  session: Session | null = null;
  /** Store a digest of the state after every input (the browser app does; the solver has no use for it). */
  digestOn = false;
  /** Replay: the recorded entries to take the answers from, in order (`feedSession`). */
  feed: SessionEntry[] | null = null;
  /** The open entries (an input can resume a pending one: the tutorial step the intro waits for). */
  open: OpenEntry[] = [];
  /** The clock's value when the session began: its entries are dated from it. */
  t0 = 0;

  constructor(private host: SessionHost) {}

  /** The entry being answered now. */
  get cur(): OpenEntry | undefined {
    return this.open.length ? this.open[this.open.length - 1] : undefined;
  }

  /** Opens an entry of the session (and takes its recorded twin when replaying). */
  begin(entry: SessionEntry) {
    if (!this.open.length && this.session && this.session.log.length >= SESSION_MAX) this.newSession({ kind: 'load' });
    this.session ??= this.newSession({ kind: 'load' });
    if (this.host.clock) entry.t = Math.round(this.host.clock() - this.t0);
    this.session.log.push(entry);
    this.open.push({ entry, src: this.feed?.shift(), pi: 0, mi: 0, ri: 0, steps: 0 });
  }

  /** A fresh session from the current state; the clock, when set, dates it and its entries. */
  newSession(start: Session['start']): Session {
    const { host } = this;
    this.t0 = host.clock?.() ?? 0;
    this.session = {
      v: host.game.saveVersion,
      start,
      base: structuredClone(host.state),
      log: [],
      ...(host.clock ? { at: host.clock() } : {}),
    };
    return this.session;
  }

  end() {
    const o = this.open.pop();
    if (o && this.digestOn) o.entry.digest = stateDigest(this.host.state);
  }

  /** Records what answered (a rule, a topic, a listener, a script step: the puzzle graph's ids). */
  ran(id: string) {
    const o = this.cur;
    if (o) (o.entry.ran ??= []).push(id);
  }

  /** Replays a session: the engine takes the recorded answers instead of asking the presenter. */
  feedSession(s: Session) {
    this.feed = [...s.log];
  }

  /** A choice, recorded (and fed back when replaying). */
  async choose(options: { text: string; seen?: boolean; global?: boolean }[], who?: Id): Promise<number> {
    const o = this.cur;
    const fed = o?.src?.picks?.[o.pi];
    const i = fed !== undefined ? (o!.pi++, fed) : await this.host.ui.choose(options, who);
    if (o) (o.entry.picks ??= []).push(i);
    return i;
  }

  /** The map's answer, recorded. */
  async pickPlace(): Promise<Id | null> {
    const o = this.cur;
    const fed = o?.src?.maps?.[o.mi];
    const p = fed !== undefined ? (o!.mi++, fed) : await this.host.ui.openMap(this.host.state);
    if (o) (o.entry.maps ??= []).push(p);
    return p;
  }

  /** A random draw, recorded. */
  rand(): number {
    const o = this.cur;
    const fed = o?.src?.rnd?.[o.ri];
    const r = fed !== undefined ? (o!.ri++, fed) : this.host.random();
    if (o) (o.entry.rnd ??= []).push(r);
    return r;
  }
}
