// The limits of one terminal session (4.1.9): bytes per second, lines per minute, a line's length, the time to pair,
// the time between two lines, the session's length, and the connections a server holds. Shared by Telnet and SSH.

export interface TerminalLimits {
  maxLine: number;
  bytesPerSecond: number;
  linesPerMinute: number;
  sessionMs: number;
  /** Without a complete line for this long, the connection is closed (slowloris). */
  idleMs: number;
  /** Not bound to a player after this long: closed. */
  pairMs: number;
  maxConnections: number;
  /** Connections one address may hold at once. */
  perAddress: number;
  /** Wrong codes or passwords one address may give in `triesWindowMs`, across reconnections; then it is refused. */
  triesPerAddress: number;
  triesWindowMs: number;
}

export const TERMINAL_LIMITS: TerminalLimits = {
  maxLine: 512,
  bytesPerSecond: 64 * 1024,
  linesPerMinute: 100,
  sessionMs: 30 * 60_000,
  idleMs: 60_000,
  pairMs: 20_000,
  maxConnections: 20,
  perAddress: 3,
  triesPerAddress: 6,
  triesWindowMs: 10 * 60_000,
};

/**
 * What a server knows of each client address (in memory, bounded): its open connections and its recent wrong codes.
 * A few idle sockets from one address cannot lock everyone out, and reconnecting does not reset the count of tries.
 */
export class AddressGate {
  private open = new Map<string, number>();
  private wrong = new Map<string, number[]>();
  constructor(
    private l: TerminalLimits,
    private now: () => number = Date.now,
  ) {}
  private recent(ip: string): number[] {
    const t = this.now();
    const xs = (this.wrong.get(ip) ?? []).filter((x) => x > t - this.l.triesWindowMs);
    if (xs.length) this.wrong.set(ip, xs);
    else this.wrong.delete(ip);
    return xs;
  }
  /** Whether this address may open one more connection (then counted until `leave`). */
  enter(ip: string): boolean {
    const n = this.open.get(ip) ?? 0;
    if (n >= this.l.perAddress || this.recent(ip).length >= this.l.triesPerAddress) return false;
    this.open.set(ip, n + 1);
    return true;
  }
  leave(ip: string): void {
    const n = (this.open.get(ip) ?? 1) - 1;
    if (n > 0) this.open.set(ip, n);
    else this.open.delete(ip);
  }
  /** A wrong code from this address; true when it has none left in the window. */
  failed(ip: string): boolean {
    if (this.wrong.size > 10_000) for (const k of [...this.wrong.keys()]) this.recent(k);
    const xs = this.recent(ip);
    xs.push(this.now());
    this.wrong.set(ip, xs);
    return xs.length >= this.l.triesPerAddress;
  }
}

export class SessionGuard {
  private second = { at: 0, bytes: 0 };
  private lines: number[] = [];
  private idle: NodeJS.Timeout | undefined;
  private pair: NodeJS.Timeout | undefined;
  private life: NodeJS.Timeout;

  constructor(
    private l: TerminalLimits,
    private expire: (why: 'idle' | 'pairing-time' | 'session-time') => void,
    private now: () => number = Date.now,
  ) {
    this.life = setTimeout(() => expire('session-time'), l.sessionMs);
    this.pair = setTimeout(() => expire('pairing-time'), l.pairMs);
    this.touch();
  }

  /** Bytes received: false when the second's budget is spent (the connection is then closed). */
  bytes(n: number): boolean {
    const t = this.now();
    if (t - this.second.at >= 1000) this.second = { at: t, bytes: 0 };
    this.second.bytes += n;
    return this.second.bytes <= this.l.bytesPerSecond;
  }

  /** A complete line: false when the minute's budget is spent (the line is dropped). */
  line(): boolean {
    this.touch();
    const t = this.now();
    this.lines = this.lines.filter((x) => x > t - 60_000);
    if (this.lines.length >= this.l.linesPerMinute) return false;
    this.lines.push(t);
    return true;
  }

  touch(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.expire('idle'), this.l.idleMs);
  }

  bound(): void {
    clearTimeout(this.pair);
    this.pair = undefined;
  }

  dispose(): void {
    clearTimeout(this.idle);
    clearTimeout(this.pair);
    clearTimeout(this.life);
  }
}
