// What the Bridge keeps (4.1.1): pairings, players, the signals it accepted (its journal, per player, in sequence),
// the acknowledgements, and revocations. Behind an interface: `MemoryBridgeStore` for the tests, `JsonlBridgeStore`
// for a reference server (an append-only JSON-lines file, fsync'd before a write is reported done, replayed at start).
// No secret is stored in clear: a player's capability is kept as its SHA-256.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorldSignalV1 } from '../../src/engine/reality/protocol';

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

/** A JSON-lines journal: every event appended and fsync'd, the whole file replayed when the Bridge starts. */
export class JsonlBridgeStore extends MemoryBridgeStore {
  constructor(private file: string) {
    super();
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file))
      for (const line of readFileSync(file, 'utf8').split('\n'))
        if (line.trim()) {
          // The pairing's capability is never written: a restart forgets an unclaimed one (the player pairs again).
          this.apply(JSON.parse(line) as BridgeEvent);
        }
  }
  override write(e: BridgeEvent): void {
    // Forgetting a player rewrites the journal without any line about it (atomically: a new file, fsync'd, renamed),
    // so the deletion is real, not a tombstone over data still on disk.
    if (e.t === 'forget') {
      const kept = readFileSync(this.file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.includes(JSON.stringify(e.playerId)));
      const tmp = `${this.file}.tmp`;
      const fd = openSync(tmp, 'w');
      try {
        writeSync(fd, kept.map((l) => `${l}\n`).join(''));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.file);
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
}
