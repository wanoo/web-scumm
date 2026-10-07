// A minimal IMAP4rev1 client (4.1.9, docs/dev/threat-models/email.md): the seven commands the email connector needs
// (LOGIN, SELECT, UID SEARCH, UID FETCH, UID STORE, EXPUNGE, LOGOUT) over TLS, and nothing else. Written here rather
// than taken from a library (ADR 0008): the usual client brings eight runtime packages (a logger, a SOCKS client,
// charset tables) for what is, for this connector, a few hundred lines. Every read is bounded: a line at most 8 KB, a
// literal at most `maxLiteral`, a command answered within `timeoutMs`, else the connection is closed.
import { connect as netConnect } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';

export interface ImapOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox?: string;
  /** TLS from the first byte (993). `false` only for a test server on 127.0.0.1. */
  tls?: boolean;
  maxLiteral: number;
  timeoutMs?: number;
}

interface Response {
  status: 'OK' | 'NO' | 'BAD';
  untagged: { line: string; literals: Buffer[] }[];
}

const MAX_LINE = 8192;
/** One response line with its literals' markers joined: a chain of `{0}` cannot grow it past this. */
const MAX_JOINED_LINE = 64 * 1024;
/** Untagged responses, literals and bytes (lines and literals) one command may collect. */
const MAX_UNTAGGED = 1000;
const MAX_LITERALS = 64;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** An IMAP quoted string; a credential with CR, LF or NUL is refused, never sent. */
function quote(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error('a credential with a line break');
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

export class ImapClient {
  private buf: Buffer = Buffer.alloc(0);
  private literalLeft = -1;
  private current: { line: string; literals: Buffer[] } | null = null;
  private untagged: { line: string; literals: Buffer[] }[] = [];
  private pending: { tag: string; done: (r: Response) => void; fail: (e: Error) => void } | null = null;
  private greeted: ((ok: boolean) => void) | null = null;
  private n = 0;
  private dead: Error | null = null;
  /** Literals and bytes received for the command in flight (reset at its tagged answer). */
  private literalCount = 0;
  private responseBytes = 0;
  /** Literal bytes received for the command in flight: at most twice `maxLiteral` in all. */
  private literalBytes = 0;

  private constructor(
    private socket: Duplex,
    private o: ImapOptions,
  ) {
    socket.on('data', (d: Buffer) => this.onData(d));
    socket.on('error', (e) => this.die(e));
    socket.on('close', () => this.die(new Error('the IMAP server closed the connection')));
  }

  static async open(o: ImapOptions): Promise<ImapClient> {
    const socket =
      o.tls === false
        ? netConnect({ host: o.host, port: o.port })
        : tlsConnect({ host: o.host, port: o.port, servername: o.host });
    const c = new ImapClient(socket, o);
    await c.greeting();
    const login = await c.command(`LOGIN ${quote(o.user)} ${quote(o.password)}`);
    if (login.status !== 'OK') throw c.fail('the IMAP server refused the login');
    const select = await c.command(`SELECT ${quote(o.mailbox ?? 'INBOX')}`);
    if (select.status !== 'OK') throw c.fail('no such mailbox');
    return c;
  }

  private fail(message: string): Error {
    const e = new Error(message);
    this.die(e);
    return e;
  }

  private die(e: Error): void {
    if (this.dead) return;
    this.dead = e;
    this.socket.destroy();
    this.greeted?.(false);
    this.pending?.fail(e);
    this.pending = null;
  }

  private greeting(): Promise<void> {
    return new Promise((ok, ko) => {
      const t = setTimeout(() => ko(this.fail('no greeting from the IMAP server')), this.o.timeoutMs ?? 30_000);
      this.greeted = (good) => {
        clearTimeout(t);
        this.greeted = null;
        if (good) ok();
        else ko(this.dead ?? new Error('the IMAP server refused the connection'));
      };
    });
  }

  private onData(d: Buffer): void {
    if (this.dead) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.literalLeft >= 0) {
        if (this.buf.length < this.literalLeft) return;
        this.current?.literals.push(Buffer.from(this.buf.subarray(0, this.literalLeft)));
        this.buf = this.buf.subarray(this.literalLeft);
        this.literalLeft = -1;
        continue;
      }
      const eol = this.buf.indexOf('\r\n');
      if (eol < 0) {
        if (this.buf.length > MAX_LINE) this.die(new Error('an IMAP line over 8 KB'));
        return;
      }
      if (eol > MAX_LINE) return this.die(new Error('an IMAP line over 8 KB'));
      const line = this.buf.subarray(0, eol).toString('latin1');
      this.buf = this.buf.subarray(eol + 2);
      this.current ??= { line: '', literals: [] };
      this.current.line += line;
      this.responseBytes += eol + 2;
      if (this.current.line.length > MAX_JOINED_LINE) return this.die(new Error('an IMAP response line over 64 KB'));
      if (this.responseBytes > MAX_RESPONSE_BYTES + 2 * this.o.maxLiteral)
        return this.die(new Error('an IMAP response over its size'));
      const lit = /\{(\d{1,10})\}$/.exec(line);
      if (lit) {
        const n = Number(lit[1]);
        this.literalBytes += n;
        if (++this.literalCount > MAX_LITERALS) return this.die(new Error('too many IMAP literals'));
        if (n > this.o.maxLiteral || this.literalBytes > 2 * this.o.maxLiteral)
          return this.die(new Error('an IMAP literal over the limit'));
        this.literalLeft = n;
        continue;
      }
      const done = this.current;
      this.current = null;
      this.onLine(done);
    }
  }

  private onLine(r: { line: string; literals: Buffer[] }): void {
    if (this.greeted) {
      this.greeted(/^\* (OK|PREAUTH)\b/i.test(r.line));
      return;
    }
    const p = this.pending;
    if (p && r.line.startsWith(`${p.tag} `)) {
      const status = /^\S+ (OK|NO|BAD)\b/i.exec(r.line)?.[1]?.toUpperCase() as Response['status'] | undefined;
      this.pending = null;
      this.literalBytes = 0;
      this.literalCount = 0;
      this.responseBytes = 0;
      const untagged = this.untagged;
      this.untagged = [];
      p.done({ status: status ?? 'BAD', untagged });
      return;
    }
    if (r.line.startsWith('+')) return; // a continuation request: this client never sends a literal
    if (this.untagged.length >= MAX_UNTAGGED) return this.die(new Error('too many IMAP responses'));
    this.untagged.push(r);
  }

  private command(text: string): Promise<Response> {
    if (this.dead) return Promise.reject(this.dead);
    const tag = `w${++this.n}`;
    return new Promise((done, fail) => {
      const t = setTimeout(() => fail(this.fail('the IMAP server did not answer in time')), this.o.timeoutMs ?? 30_000);
      this.pending = {
        tag,
        done: (r) => {
          clearTimeout(t);
          done(r);
        },
        fail: (e) => {
          clearTimeout(t);
          fail(e);
        },
      };
      this.socket.write(`${tag} ${text}\r\n`);
    });
  }

  private async search(criteria: string): Promise<number[]> {
    const r = await this.command(`UID SEARCH ${criteria}`);
    if (r.status !== 'OK') return [];
    return r.untagged
      .filter((u) => /^\* SEARCH\b/i.test(u.line))
      .flatMap((u) => u.line.slice(8).trim().split(/\s+/))
      .filter((x) => /^\d{1,10}$/.test(x))
      .map(Number);
  }

  /** The UIDs of the messages not yet seen. */
  unseen(): Promise<number[]> {
    return this.search('UNSEEN');
  }

  /** The UIDs of the messages seen, not flagged, received before `date` (the retention sweep). */
  seenBefore(date: Date): Promise<number[]> {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
    return this.search(`SEEN UNFLAGGED BEFORE ${date.getUTCDate()}-${m}-${date.getUTCFullYear()}`);
  }

  /** A message's size as the server declares it (checked before its body is fetched). */
  async size(uid: number): Promise<number> {
    const r = await this.command(`UID FETCH ${uid} (RFC822.SIZE)`);
    const m = r.untagged.map((u) => /RFC822\.SIZE (\d{1,10})/i.exec(u.line)).find(Boolean);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  }

  /** The raw message, without marking it seen (BODY.PEEK). */
  async fetch(uid: number): Promise<Uint8Array | null> {
    const r = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    const lit = r.untagged.find((u) => /BODY\[\]/i.test(u.line) && u.literals.length)?.literals[0];
    return lit ? new Uint8Array(lit) : null;
  }

  async flag(uid: number, flags: string[]): Promise<void> {
    await this.command(`UID STORE ${uid} +FLAGS.SILENT (${flags.filter((f) => /^\\\w+$/.test(f)).join(' ')})`);
  }

  async expunge(): Promise<void> {
    await this.command('EXPUNGE');
  }

  async logout(): Promise<void> {
    try {
      if (!this.dead) await this.command('LOGOUT');
    } catch {
      /* closing anyway */
    }
    this.die(new Error('logged out'));
  }
}
