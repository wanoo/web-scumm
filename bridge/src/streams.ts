// The open event streams of one Bridge instance (4.1.10, D20): each holds its player's cursor and reads the store
// after it, page by page, when woken: by this instance's own acceptance, by the store's `watch` (Postgres NOTIFY, a
// short poll on SQLite) when another instance accepted it, and by a slow timer that covers a lost wake-up. The store
// is the source of truth: a wake-up only says "read now". One read at a time per stream, so a stream's signals go
// out in order and once each; a stream whose link was revoked or expired meanwhile is ended instead of fed.

/** One open stream: its player, the last sequence it sent, and how it sends and ends. */
export interface Stream {
  playerId: string;
  cursor: number;
  on: (seq: number, jws: string) => void;
  close: (why: 'revoked' | 'expired') => void;
  /** The read in progress, if any; `again` asks it for one more pass (a wake-up arrived while it read). */
  reading?: Promise<void>;
  again?: boolean;
}

/** What the streams read through: the Bridge's journal for a player, already signed for delivery. */
export interface StreamSource {
  /** The signals after `after`, at most `limit`; a `jws` of null is a row set aside (quarantined): skipped. */
  page(playerId: string, after: number, limit: number): Promise<{ sequence: number; jws: string | null }[]>;
  /** Why a player's streams must end now, if they must. */
  ends(playerId: string): Promise<'revoked' | 'expired' | undefined>;
}

export class Streams {
  private open = new Set<Stream>();

  constructor(
    private source: StreamSource,
    private pageSize: () => number,
    /** A read that failed: said, never thrown (a wake-up runs from a timer, a store's callback, a request). */
    private onError: (e: unknown) => void = () => {},
  ) {}

  get size(): number {
    return this.open.size;
  }
  count(playerId: string): number {
    let n = 0;
    for (const s of this.open) if (s.playerId === playerId) n++;
    return n;
  }
  /** The players with a stream on this instance (the slow timer wakes them). */
  players(): Set<string> {
    return new Set([...this.open].map((s) => s.playerId));
  }
  add(s: Stream): () => void {
    this.open.add(s);
    return () => this.open.delete(s);
  }
  end(s: Stream, why: 'revoked' | 'expired'): void {
    if (this.open.delete(s)) s.close(why);
  }
  endAll(playerId: string, why: 'revoked' | 'expired'): void {
    for (const s of [...this.open]) if (s.playerId === playerId) this.end(s, why);
  }

  /** Reads the store for every stream of a player; resolves once each has sent what was there. */
  wake(playerId: string): Promise<void> {
    return Promise.all([...this.open].filter((s) => s.playerId === playerId).map((s) => this.read(s))).then(() => {});
  }

  /** One stream's read, serialised: a wake-up during a read makes it read once more, never twice at once. */
  read(s: Stream): Promise<void> {
    if (s.reading) {
      s.again = true;
      return s.reading;
    }
    s.reading = (async () => {
      try {
        do {
          s.again = false;
          await this.drain(s);
        } while (s.again && this.open.has(s));
      } catch (e) {
        // The cursor stays where the last signal sent left it: the next read starts there.
        this.onError(e);
      } finally {
        s.reading = undefined;
      }
    })();
    return s.reading;
  }

  private async drain(s: Stream): Promise<void> {
    for (;;) {
      if (!this.open.has(s)) return;
      const size = this.pageSize();
      const rows = await this.source.page(s.playerId, s.cursor, size);
      if (!rows.length) return;
      // The link is checked again before anything goes out: revoked or expired since the stream opened, it ends.
      const why = await this.source.ends(s.playerId);
      if (why) return this.end(s, why);
      for (const r of rows) {
        if (!this.open.has(s)) return;
        if (r.sequence <= s.cursor) continue;
        if (r.jws !== null) s.on(r.sequence, r.jws);
        s.cursor = r.sequence;
      }
      if (rows.length < size) return;
    }
  }
}
