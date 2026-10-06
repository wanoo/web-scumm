// The Studio's simulated Bridge (4.1.1, plan §8): a development key signs signals as the Bridge would, and a port
// delivers them to the same RealityClient a real Bridge feeds, so the simulator tests verification, the session, the
// save and the deduplication, never a shortcut to `Engine.emit`. Faults on demand: a delay, a duplicate, the order
// reversed, a bad signature, an expired signal, the connection cut then resumed. No network.
import type { WorldSignalPort } from '../core/ports';
import type { GameDef } from '../core/types';
import { b64url, CLOCK_SKEW_MS, importBridgeKey, signSignal, type Keyring, type WorldSignalV1 } from './protocol';

export interface Fault {
  /** Deliver it this many milliseconds later. */
  delayMs?: number;
  /** Deliver it twice. */
  duplicate?: boolean;
  /** One byte of the payload changed after signing. */
  badSignature?: boolean;
  /** Already expired when it arrives. */
  expired?: boolean;
}

export interface SimulatedDelivery {
  sequence: number;
  signal: string;
  fault: string;
  at: number;
}

export class SignalSimulator {
  readonly playerId: string;
  readonly history: SimulatedDelivery[] = [];
  private queue: string[] = [];
  private held: string[] = [];
  private wake: (() => void) | null = null;
  private cutOff = false;
  private sequence = 0;
  private acked = 0;

  private constructor(
    private game: GameDef,
    private key: CryptoKey,
    readonly keyring: Keyring,
    playerId: string,
    private now: () => number,
  ) {
    this.playerId = playerId;
  }

  static async create(
    game: GameDef,
    o: { playerId?: string; now?: () => number; after?: number } = {},
  ): Promise<SignalSimulator> {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const raw = b64url.encode(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    const sim = new SignalSimulator(
      game,
      kp.privateKey,
      [await importBridgeKey('studio', raw)],
      o.playerId ?? 'p-studio',
      o.now ?? Date.now,
    );
    sim.sequence = o.after ?? 0;
    sim.acked = o.after ?? 0;
    return sim;
  }

  /** The signals the game declares (the Studio's buttons). */
  get signals(): string[] {
    return this.game.reality?.signals.map((s) => s.id) ?? [];
  }
  get acknowledged(): number {
    return this.acked;
  }

  /** Signs a signal as the Bridge would, with the faults asked for, and queues it (or holds it while cut). */
  async inject(signal: string, f: Fault = {}): Promise<void> {
    const def = this.game.reality?.signals.find((s) => s.id === signal);
    const seq = ++this.sequence;
    const payload: WorldSignalV1 = {
      format: 'web-scumm-world-signal',
      schema: 1,
      id: `studio-${seq}`,
      sequence: seq,
      gameId: this.game.id,
      playerId: this.playerId,
      signal,
      source: def?.source ?? 'studio',
      receivedAt: this.now(),
      dedupeKey: `studio:${seq}`,
      policyVersion: 'studio',
      ...(f.expired ? { expiresAt: this.now() - CLOCK_SKEW_MS - 1 } : {}),
    };
    let jws = await signSignal(payload, this.key, 'studio');
    if (f.badSignature) {
      const [h, p, s] = jws.split('.') as [string, string, string];
      jws = `${h}.${p.slice(0, -2)}${p.at(-2) === 'A' ? 'B' : 'A'}${p.at(-1)}.${s}`;
    }
    const fault = Object.entries(f)
      .filter(([, v]) => v)
      .map(([k, v]) => (k === 'delayMs' ? `delay ${v} ms` : k))
      .join(', ');
    this.history.push({ sequence: seq, signal, fault: fault || 'none', at: this.now() });
    const push = () => {
      for (const j of f.duplicate ? [jws, jws] : [jws]) (this.cutOff ? this.held : this.queue).push(j);
      this.wake?.();
    };
    if (f.delayMs) setTimeout(push, f.delayMs);
    else push();
  }

  /** The signals waiting, delivered in the reverse order. */
  reverse(): void {
    this.queue.reverse();
  }
  /** The connection cut: what arrives is held until `resume`. */
  cut(): void {
    this.cutOff = true;
  }
  resume(): void {
    this.cutOff = false;
    this.queue.push(...this.held.splice(0));
    this.wake?.();
  }

  /** The port a RealityClient reads, as from a Bridge. */
  port(): WorldSignalPort {
    let closed = false;
    return {
      connect: ({ signal }) => {
        const self = this;
        return (async function* () {
          while (!closed && !signal?.aborted) {
            const next = self.queue.shift();
            if (next !== undefined) {
              yield next;
              continue;
            }
            await new Promise<void>((ok) => {
              self.wake = ok;
              signal?.addEventListener('abort', () => ok(), { once: true });
            });
            self.wake = null;
          }
        })();
      },
      acknowledge: async ({ through }) => {
        this.acked = Math.max(this.acked, through);
      },
      close: async () => {
        closed = true;
        this.wake?.();
      },
    };
  }
}
