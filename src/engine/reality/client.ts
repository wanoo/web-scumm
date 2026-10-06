// The player's side of the Reality Bridge (4.1.1, plan §3.3 and §4.2): read signed signals from a port, verify each,
// hand it to the engine, wait for the save to be durable, then acknowledge. That order is the contract: a crash
// anywhere before the acknowledgement makes the Bridge deliver again, and the engine recognises what it applied, so a
// signal is delivered at least once and applied at most once. No DOM here: the browser wraps it (connection status,
// one tab at a time); the tests drive it with a fake port and a memory store.
import type { Engine } from '../core/engine';
import type { SaveStore, WorldSignalPort } from '../core/ports';
import type { ExternalEntry } from '../core/types';
import { verifySignal, type Keyring, type RefusalCode } from './protocol';

export interface RealityClientOptions {
  engine: Engine;
  store: SaveStore;
  port: WorldSignalPort;
  keyring: Keyring;
  /**
   * The Bridge's keys again (`GET /v1/keys`), asked once per delivery when a signal names a key the keyring does not
   * hold or holds outside its window: the Bridge rotated while this link was open (4.1.2).
   */
  refreshKeys?: () => Promise<Keyring>;
  playerId: string;
  now?: () => number;
  /** How long to wait before trying a signal again while the engine is busy (ms). */
  retryMs?: number;
  /** A refusal, for the status line and the diagnostics (never the payload). */
  onRefused?: (code: RefusalCode, reason: string) => void;
  onApplied?: (x: ExternalEntry) => void;
  /**
   * The game in progress is bound to another player than this link (a save imported from elsewhere, a save from
   * before an unlink): the client stops, applies nothing and acknowledges nothing. `saved` is the save's player.
   */
  onMismatch?: (saved: string) => void;
}

/** Refusals of a signal the Bridge did sign that will never become valid: recorded as skipped, so the cursor moves on. */
const FINAL: Partial<Record<RefusalCode, ExternalEntry['skipped']>> = { expired: 'expired', signal: 'signal' };

export class RealityClient {
  private stopped = false;
  private ctrl = new AbortController();
  readonly refused: Record<string, number> = {};
  private keyring: Keyring;

  constructor(private o: RealityClientOptions) {
    this.keyring = o.keyring;
  }

  private get signals(): Set<string> {
    return new Set(this.o.engine.game.reality?.signals.map((s) => s.id) ?? []);
  }

  /** Reads the port until it ends or `stop()`. */
  /** A game in progress: on the title screen there is no state yet to apply a signal to, so the link waits. */
  private async ready(): Promise<void> {
    while (!this.o.engine.state && !this.stopped) await new Promise((ok) => setTimeout(ok, this.o.retryMs ?? 250));
  }

  /**
   * Whether the game in progress belongs to another player than this link. Checked before any acknowledgement and
   * before any signal is handed to the engine: a loaded save names its player (`GameState.reality.playerId`), and
   * acknowledging its cursor for someone else would settle signals that save never applied.
   */
  private mismatch(): boolean {
    const bound = this.o.engine.state.reality?.playerId;
    if (!bound || bound === this.o.playerId) return false;
    this.o.onMismatch?.(bound);
    return true;
  }

  async run(): Promise<void> {
    await this.ready();
    if (this.stopped) return;
    if (this.mismatch()) return;
    const after = this.o.engine.state.reality?.cursor ?? 0;
    // What the loaded game holds was saved: acknowledge it first. A crash after a save and before its acknowledgement
    // leaves the Bridge waiting, and connecting after the cursor would never deliver that signal again to settle it.
    if (after > 0) await this.o.port.acknowledge({ playerId: this.o.playerId, through: after });
    for await (const jws of this.o.port.connect({
      gameId: this.o.engine.game.id,
      playerId: this.o.playerId,
      after,
      signal: this.ctrl.signal,
    })) {
      if (this.stopped) break;
      await this.handle(jws);
    }
  }

  /** One signed signal: verified, applied (or recognised), saved, acknowledged. Returns what happened to it. */
  async handle(jws: string): Promise<'applied' | 'duplicate' | 'skipped' | 'refused'> {
    await this.ready();
    const now = this.o.now?.() ?? Date.now();
    const expectation = { gameId: this.o.engine.game.id, playerId: this.o.playerId, signals: this.signals, now };
    let v = await verifySignal(jws, this.keyring, expectation);
    if (!v.ok && (v.code === 'key' || v.code === 'key-window') && this.o.refreshKeys) {
      // A key this keyring does not know, or knows outside its window: the Bridge may have rotated; ask once.
      try {
        this.keyring = await this.o.refreshKeys();
        v = await verifySignal(jws, this.keyring, expectation);
      } catch {
        /* the keys could not be fetched: the refusal stands, the next delivery asks again */
      }
    }
    let entry: ExternalEntry;
    if (v.ok) {
      const s = v.signal;
      entry = {
        id: s.id,
        sequence: s.sequence,
        signal: s.signal,
        source: s.source,
        receivedAt: s.receivedAt,
        playerId: this.o.playerId,
        ...(s.evidenceHash ? { evidenceHash: s.evidenceHash } : {}),
      };
    } else {
      this.refused[v.code] = (this.refused[v.code] ?? 0) + 1;
      this.o.onRefused?.(v.code, v.reason);
      const skipped = FINAL[v.code];
      // Only a refusal that comes after the signature was checked can be recorded: its id and sequence are the Bridge's.
      if (!skipped) return 'refused';
      const payload = JSON.parse(new TextDecoder().decode(base64urlPayload(jws))) as ExternalEntry;
      entry = {
        id: payload.id,
        sequence: payload.sequence,
        signal: payload.signal,
        source: payload.source,
        receivedAt: payload.receivedAt,
        playerId: this.o.playerId,
        skipped,
      };
    }
    let r = await this.o.engine.receive(entry);
    while (r === 'busy' && !this.stopped) {
      await new Promise((ok) => setTimeout(ok, this.o.retryMs ?? 250));
      r = await this.o.engine.receive(entry);
    }
    if (r === 'mismatch') {
      // Another save was loaded under this link meanwhile: nothing applied, nothing acknowledged, the link stops.
      this.mismatch();
      await this.stop();
      return 'refused';
    }
    if (r === 'unknown' || r === 'overflow' || r === 'busy') return 'refused';
    // Durable before acknowledged: a crash between the two makes the Bridge deliver it again, and it is a duplicate.
    await this.o.store.whenIdle?.();
    if (this.mismatch()) return 'refused';
    const through = this.o.engine.state.reality?.cursor ?? 0;
    if (through > 0) await this.o.port.acknowledge({ playerId: this.o.playerId, through });
    if (r === 'applied') this.o.onApplied?.(entry);
    return r === 'applied' ? (entry.skipped ? 'skipped' : 'applied') : 'duplicate';
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ctrl.abort();
    await this.o.port.close();
  }
}

/** The payload bytes of a JWS whose signature was already checked. */
function base64urlPayload(jws: string): Uint8Array {
  const p = jws.split('.')[1] ?? '';
  const bin = atob(p.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
