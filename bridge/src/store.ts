// What the Bridge keeps (4.1.1): pairings, players, the signals it accepted (its journal, per player, in sequence),
// the acknowledgements, and revocations. Behind an interface: `MemoryBridgeStore` for the tests, `JsonlBridgeStore`
// for a reference server (an append-only JSON-lines file, fsync'd before a write is reported done, replayed at start).
// No secret is stored in clear: a player's capability is kept as its SHA-256.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  linkSync,
  truncateSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod/mini';
import { WorldSignalV1Schema, type WorldSignalV1 } from '../../src/engine/reality/protocol';

export interface Pairing {
  code: string;
  gameId: string;
  expiresAt: number;
  /** Set when a connector confirmed the code. */
  playerId?: string;
  /** The capability handed to the player once, when it fetches the confirmed pairing (then forgotten in clear). */
  capability?: string;
}
export interface Player {
  playerId: string;
  gameId: string;
  capabilityHash: string;
  capabilityExpiresAt: number;
  /** When the link was made (4.1.2): a capability lives at most `capabilityMaxMs` from it, renewals included. */
  issuedAt?: number;
  revoked?: boolean;
}
export interface JournalEntry {
  playerId: string;
  sequence: number;
  id: string;
  dedupeKey: string;
  jws: string;
  at: number;
  /** The key that signed `jws` (4.1.2); absent in a 4.1.1 journal line. */
  kid?: string;
  /**
   * The payload as signed (4.1.2): after a rotation the Bridge signs it again with its current key at delivery, so a
   * signal waiting for a player never outlives the key that first signed it. Absent in a 4.1.1 line: delivered as is.
   */
  payload?: WorldSignalV1;
}

export type BridgeEvent =
  | { t: 'pairing'; p: Pairing }
  | { t: 'player'; p: Player }
  | { t: 'signal'; e: JournalEntry }
  | { t: 'ack'; playerId: string; through: number }
  | { t: 'revoke-token'; id: string }
  /** Deletes everything about a player (its link, journal, acknowledgements, pairing). */
  | { t: 'forget'; playerId: string };

const ident = z.string().check(z.minLength(1), z.maxLength(256));
const time = z.int().check(z.nonnegative());
const PairingSchema = z.object({
  code: ident,
  gameId: ident,
  expiresAt: time,
  playerId: z.optional(ident),
  capability: z.optional(z.string()),
});
const PlayerSchema = z.object({
  playerId: ident,
  gameId: ident,
  capabilityHash: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  capabilityExpiresAt: time,
  issuedAt: z.optional(time),
  revoked: z.optional(z.boolean()),
});
const JournalEntrySchema = z.object({
  playerId: ident,
  sequence: z.int().check(z.positive()),
  id: ident,
  dedupeKey: ident,
  jws: z.string().check(z.minLength(1), z.maxLength(64 * 1024)),
  at: time,
  kid: z.optional(ident),
  payload: z.optional(WorldSignalV1Schema),
});
/**
 * Every line of the journal, whole (4.1.8): a line that is JSON but not an event of this shape is corruption too,
 * and the Bridge refuses to start on it rather than build its state from half-read lines.
 * @public
 */
export const BridgeEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('pairing'), p: PairingSchema }),
  z.object({ t: z.literal('player'), p: PlayerSchema }),
  z.object({ t: z.literal('signal'), e: JournalEntrySchema }),
  z.object({ t: z.literal('ack'), playerId: ident, through: time }),
  z.object({ t: z.literal('revoke-token'), id: ident }),
  z.object({ t: z.literal('forget'), playerId: ident }),
]);

export interface BridgeStore {
  pairing(code: string): Pairing | undefined;
  player(playerId: string): Player | undefined;
  playerByCapability(hash: string): Player | undefined;
  /** The journal of a player after a sequence. */
  signals(playerId: string, after: number): JournalEntry[];
  bySequenceKey(playerId: string, dedupeKey: string): JournalEntry | undefined;
  lastSequence(playerId: string): number;
  acked(playerId: string): number;
  tokenRevoked(id: string): boolean;
  revokedTokens(): ReadonlySet<string>;
  /** Records an event durably (the reference store: appended and fsync'd) before returning. */
  write(e: BridgeEvent): void;
}

/** The state both stores build from their events. */
export class MemoryBridgeStore implements BridgeStore {
  protected pairings = new Map<string, Pairing>();
  protected players = new Map<string, Player>();
  protected journal = new Map<string, JournalEntry[]>();
  protected acks = new Map<string, number>();
  protected revoked = new Set<string>();

  pairing(code: string) {
    return this.pairings.get(code);
  }
  player(playerId: string) {
    return this.players.get(playerId);
  }
  playerByCapability(hash: string) {
    for (const p of this.players.values()) if (p.capabilityHash === hash) return p;
    return undefined;
  }
  signals(playerId: string, after: number) {
    return (this.journal.get(playerId) ?? []).filter((e) => e.sequence > after);
  }
  bySequenceKey(playerId: string, dedupeKey: string) {
    return (this.journal.get(playerId) ?? []).find((e) => e.dedupeKey === dedupeKey);
  }
  lastSequence(playerId: string) {
    return this.journal.get(playerId)?.at(-1)?.sequence ?? 0;
  }
  acked(playerId: string) {
    return this.acks.get(playerId) ?? 0;
  }
  tokenRevoked(id: string) {
    return this.revoked.has(id);
  }
  revokedTokens() {
    return this.revoked;
  }
  write(e: BridgeEvent): void {
    this.apply(e);
  }
  protected apply(e: BridgeEvent): void {
    if (e.t === 'pairing') this.pairings.set(e.p.code, { ...e.p });
    else if (e.t === 'player') this.players.set(e.p.playerId, { ...e.p });
    else if (e.t === 'signal') {
      const j = this.journal.get(e.e.playerId) ?? [];
      j.push({ ...e.e });
      this.journal.set(e.e.playerId, j);
    } else if (e.t === 'ack') this.acks.set(e.playerId, Math.max(this.acked(e.playerId), e.through));
    else if (e.t === 'revoke-token') this.revoked.add(e.id);
    else {
      this.players.delete(e.playerId);
      this.journal.delete(e.playerId);
      this.acks.delete(e.playerId);
      for (const [c, p] of this.pairings) if (p.playerId === e.playerId) this.pairings.delete(c);
    }
  }
}

/** Whether an event is about a player (its link, its journal, its acknowledgements, its pairing). */
export function aboutPlayer(e: BridgeEvent, playerId: string): boolean {
  if (e.t === 'pairing') return e.p.playerId === playerId;
  if (e.t === 'player') return e.p.playerId === playerId;
  if (e.t === 'signal') return e.e.playerId === playerId;
  if (e.t === 'revoke-token') return false;
  return e.playerId === playerId;
}

function parseLine(line: string, n: number): BridgeEvent {
  let j: unknown;
  try {
    j = JSON.parse(line);
  } catch (err) {
    throw new Error(`journal line ${n} is not an event (${err instanceof Error ? err.message : 'unreadable'})`);
  }
  const r = BridgeEventSchema.safeParse(j);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new Error(
      `journal line ${n} is not an event (${issue ? `${issue.path.join('.') || 't'}: ${issue.message}` : 'invalid'})`,
    );
  }
  return r.data as BridgeEvent;
}

/**
 * One process per journal (4.1.8): a second Bridge on the same file would interleave its appends with the first's
 * and read a state the other is changing. The lock is `<journal>.lock` holding the owner's pid; a lock whose pid is
 * no longer alive (a crash) is taken over and said; a live owner makes the second start refuse.
 */
export class JournalLock {
  readonly file: string;
  private held = false;
  constructor(
    journal: string,
    private o: { pid?: number; alive?: (pid: number) => boolean; onTakeover?: (pid: number) => void } = {},
  ) {
    this.file = `${journal}.lock`;
  }
  acquire(): void {
    const pid = this.o.pid ?? process.pid;
    const alive =
      this.o.alive ??
      ((p: number) => {
        try {
          process.kill(p, 0);
          return true;
        } catch (e) {
          return (e as NodeJS.ErrnoException).code === 'EPERM';
        }
      });
    mkdirSync(dirname(this.file), { recursive: true });
    // The lock is created with its content in one step: the pid written to a private file (fsync'd), then `link`ed
    // under the lock's name (atomic: EEXIST when another process got there first; the file system must hold hard
    // links, which the usual ones do). A reader never sees an empty lock being written, so an empty or unreadable
    // lock is not "a crash": it is a file to look at by hand. A take-over is a `rename` over the lock (atomic too, no
    // moment without a lock), checked by reading the lock back.
    const tmp = `${this.file}.${pid}.${process.hrtime.bigint()}`;
    const gone = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const fd = openSync(tmp, 'w');
        try {
          writeSync(fd, `${pid}\n`);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        try {
          linkSync(tmp, this.file);
          this.held = true;
          HELD.add(this);
          return;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        }
        let text: string;
        try {
          text = readFileSync(this.file, 'utf8').trim();
        } catch (e) {
          if (gone(e)) continue; // released between our link and our read: try the link again
          throw e;
        }
        if (!/^\d+$/.test(text))
          throw new Error(
            `${this.file} holds "${text.slice(0, 40)}", not a process id: look at it, then delete it by hand`,
          );
        const owner = Number(text);
        if (owner !== pid && alive(owner))
          throw new Error(`journal in use by process ${owner} (${this.file}): one Bridge per journal`);
        // Our own earlier lock (the same process opens the journal again: a test, a restart in place) is simply
        // replaced; a lock left by a process that is gone is taken over, and said.
        if (owner !== pid) this.o.onTakeover?.(owner);
        renameSync(tmp, this.file);
        let holds: string;
        try {
          holds = readFileSync(this.file, 'utf8').trim();
        } catch (e) {
          if (gone(e)) continue;
          throw e;
        }
        if (holds !== String(pid)) continue; // another starter took over at the same instant: once more
        this.held = true;
        HELD.add(this);
        return;
      }
      throw new Error(`could not take ${this.file}: another process keeps taking it`);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* linked or renamed away already */
      }
    }
  }
  release(): void {
    if (!this.held) return;
    this.held = false;
    HELD.delete(this);
    try {
      unlinkSync(this.file);
    } catch {
      /* already gone */
    }
  }
}

/** The locks this process holds, released when it exits normally (`serve` releases on SIGINT and SIGTERM too). */
const HELD = new Set<JournalLock>();
process.once('exit', () => {
  for (const l of HELD) l.release();
});

/** What `inspectJournal` says of a file: its lines, what they hold, and whether its end was cut by a crash. */
export interface JournalReport {
  lines: number;
  players: number;
  signals: number;
  /** A last line without its newline that does not parse: a write a crash cut short (`JsonlBridgeStore` drops it). */
  torn: boolean;
  /** A complete line that does not parse: corruption; the Bridge refuses to start on it. */
  corrupt?: string;
}

/** Reads a journal without changing it (the `doctor` command). */
export function inspectJournal(file: string): JournalReport {
  const r: JournalReport = { lines: 0, players: 0, signals: 0, torn: false };
  if (!existsSync(file)) return r;
  const { complete, tail } = splitLines(readFileSync(file, 'utf8'));
  const players = new Set<string>();
  for (const [i, line] of complete.entries()) {
    r.lines++;
    try {
      const e = parseLine(line, i + 1);
      if (e.t === 'player') players.add(e.p.playerId);
      else if (e.t === 'signal') r.signals++;
      else if (e.t === 'forget') players.delete(e.playerId);
    } catch (err) {
      r.corrupt ??= err instanceof Error ? err.message : String(err);
    }
  }
  r.players = players.size;
  if (tail) {
    try {
      parseLine(tail, complete.length + 1);
      r.lines++;
    } catch {
      r.torn = true;
    }
  }
  return r;
}

/** The complete lines of a journal (each ended by a newline) and the fragment after the last newline, if any. */
function splitLines(text: string): { complete: string[]; tail: string } {
  const lines = text.split('\n');
  const tail = lines.pop() ?? '';
  return { complete: lines.filter((l) => l.trim()), tail: tail.trim() ? tail : '' };
}

/**
 * A JSON-lines journal: every event appended and fsync'd, the whole file replayed when the Bridge starts. A last line
 * cut short by a crash (no newline, not JSON) is dropped and reported, never a reason not to start; any other line
 * that does not parse is corruption, and the Bridge refuses to start on it rather than guess.
 */
export class JsonlBridgeStore extends MemoryBridgeStore {
  private lock: JournalLock | undefined;
  constructor(
    private file: string,
    private o: { onRepair?: (what: string) => void; lock?: boolean | JournalLock } = {},
  ) {
    super();
    mkdirSync(dirname(file), { recursive: true });
    // One process per journal (4.1.8); `lock: false` for a read-only tool (`doctor`). `compact` writes: it locks.
    if (o.lock !== false) {
      this.lock =
        o.lock instanceof JournalLock
          ? o.lock
          : new JournalLock(file, {
              onTakeover: (pid) => o.onRepair?.(`a lock left by process ${pid} was taken over`),
            });
      this.lock.acquire();
    }
    if (!existsSync(file)) return;
    const text = readFileSync(file, 'utf8');
    const { complete, tail } = splitLines(text);
    // The pairing's capability is never written: a restart forgets an unclaimed one (the player pairs again).
    for (const [i, line] of complete.entries()) this.apply(parseLine(line, i + 1));
    if (!tail) return;
    try {
      this.apply(parseLine(tail, complete.length + 1));
    } catch {
      truncateSync(file, Buffer.byteLength(text) - Buffer.byteLength(tail));
      this.o.onRepair?.(`a last line cut short by a crash (${Buffer.byteLength(tail)} bytes) was dropped`);
    }
  }

  /** Releases the journal's lock; the store is not written after it. */
  close(): void {
    this.lock?.release();
  }

  override write(e: BridgeEvent): void {
    // Forgetting a player rewrites the journal without any line about it (atomically: a new file, fsync'd, renamed),
    // so the deletion is real, not a tombstone over data still on disk. Each line is read, never matched as text.
    if (e.t === 'forget') {
      const { complete } = splitLines(readFileSync(this.file, 'utf8'));
      this.rewrite(complete.filter((l, i) => !aboutPlayer(parseLine(l, i + 1), e.playerId)));
      this.apply(e);
      return;
    }
    const stored = e.t === 'pairing' ? { t: e.t, p: { ...e.p, capability: undefined } } : e;
    const fd = openSync(this.file, 'a');
    try {
      writeSync(fd, `${JSON.stringify(stored)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.apply(e);
  }

  /**
   * Rewrites the journal from what the Bridge holds, dropping what nobody needs any more: pairings past their time,
   * earlier versions of a player's line, and the signals acknowledged and older than `retentionMs` (a player's last
   * signal always stays: the next sequence is counted from it). Returns the line counts.
   */
  compact(o: { now?: number; retentionMs?: number } = {}): { before: number; after: number } {
    const now = o.now ?? Date.now();
    const retention = o.retentionMs ?? 90 * 24 * 3_600_000;
    const before = splitLines(existsSync(this.file) ? readFileSync(this.file, 'utf8') : '').complete.length;
    const events: BridgeEvent[] = [];
    for (const p of this.pairings.values())
      if (p.expiresAt >= now) events.push({ t: 'pairing', p: { ...p, capability: undefined } });
    for (const p of this.players.values()) events.push({ t: 'player', p });
    for (const id of this.revoked) events.push({ t: 'revoke-token', id });
    for (const [playerId, j] of this.journal) {
      const acked = this.acked(playerId);
      const kept = j.filter((e, i) => i === j.length - 1 || e.sequence > acked || e.at >= now - retention);
      for (const e of kept) events.push({ t: 'signal', e });
      this.journal.set(playerId, kept);
      if (acked) events.push({ t: 'ack', playerId, through: acked });
    }
    this.rewrite(events.map((e) => JSON.stringify(e)));
    return { before, after: events.length };
  }

  /** A new file with these lines, fsync'd, renamed over the journal, the directory fsync'd where the system allows. */
  private rewrite(lines: string[]): void {
    const tmp = `${this.file}.tmp`;
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, lines.map((l) => `${l}\n`).join(''));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.file);
    try {
      const dir = openSync(dirname(this.file), 'r');
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    } catch {
      /* a directory cannot be opened for fsync on every system (Windows): the rename itself is still atomic */
    }
  }
}
