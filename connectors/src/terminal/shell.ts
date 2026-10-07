// The virtual shell of the terminal connectors (4.1.9, docs/dev/threat-models/telnet.md and ssh.md). Not a shell:
// a line is lower-cased, split on spaces and looked up whole among the commands the game declares
// (`reality.connectors.<telnet|ssh>.commands`), beside a few of the terminal's own (`help`, `clear`, `exit`, and
// `ls`, `cd`, `pwd`, `cat` on the virtual disk). Nothing typed reaches a process, a path or an interpreter of the host,
// and nothing typed is printed back. A session is first bound to a player: a pairing code, a resume word, or (SSH) the
// key or code it authenticated with.
import { randomBytes } from 'node:crypto';
import { TERMINAL_BUILTINS } from '../../../src/engine/tools/validate-events';
import { type ConnectorContext, dedupeKey } from '../sdk';
import { VirtualDisk } from './vfs';

/** A terminal as the game declares it. */
interface TerminalDecl {
  banner?: string;
  prompt?: string;
  commands: { says: string; reply: string; signal?: string }[];
  files?: Record<string, string>;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Resume words (`R` + 4 + `-` + 4): a session bound once may be resumed for 30 minutes by the same player. */
export class ResumeWords {
  private m = new Map<string, { playerId: string; until: number }>();
  constructor(
    private ttlMs = 30 * 60_000,
    private now: () => number = Date.now,
  ) {}
  issue(playerId: string): string {
    const t = this.now();
    if (this.m.size >= 10_000) for (const [k, v] of this.m) if (v.until < t) this.m.delete(k);
    if (this.m.size >= 10_000) this.m.delete(this.m.keys().next().value as string);
    const c = [...randomBytes(8)].map((x) => ALPHABET[x % ALPHABET.length]).join('');
    const word = `R${c.slice(0, 4)}-${c.slice(4)}`;
    this.m.set(word, { playerId, until: t + this.ttlMs });
    return word;
  }
  take(word: string): string | null {
    const e = this.m.get(word.toUpperCase());
    return e && e.until > this.now() ? e.playerId : null;
  }
}

export interface ShellOptions {
  connector: 'telnet' | 'ssh';
  ctx: ConnectorContext;
  decl: TerminalDecl;
  sessionId: string;
  resume: ResumeWords;
  write: (text: string) => void;
  close: (why: string) => void;
  /** Already bound by the transport (SSH authentication). */
  playerId?: string;
  /** Wrong codes before the session is closed. */
  maxTries?: number;
  /** A wrong code, counted for the client's address across connections: true when the address has no try left. */
  failed?: () => boolean;
}

const CODE = /^[A-Z0-9]{8}$/;
const RESUME = /^R[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** A pairing code or a resume word typed (or given as a password) → the player, or why not. */
export async function bindPlayer(
  ctx: ConnectorContext,
  resume: ResumeWords,
  typed: string,
): Promise<{ playerId: string; word?: string } | { refusal: string }> {
  const t = typed.trim().toUpperCase();
  if (RESUME.test(t)) {
    const p = resume.take(t);
    return p ? { playerId: p } : { refusal: 'unknown or expired resume word' };
  }
  if (!CODE.test(t)) return { refusal: 'not a pairing code' };
  const r = await ctx.pair(t);
  if (!r.ok) return { refusal: r.refusal };
  return { playerId: r.playerId, word: resume.issue(r.playerId) };
}

export class VirtualShell {
  private playerId: string | null;
  private tries = 0;
  private lineNo = 0;
  private disk: VirtualDisk | null;
  private busy: Promise<void> = Promise.resolve();
  closed = false;

  constructor(private o: ShellOptions) {
    this.playerId = o.playerId ?? null;
    this.disk = o.decl.files ? new VirtualDisk(o.decl.files) : null;
  }

  private say(text: string): void {
    if (!this.closed) this.o.write(`${text.replace(/\r?\n/g, '\r\n')}\r\n`);
  }
  private prompt(): void {
    if (!this.closed) this.o.write(this.playerId ? (this.o.decl.prompt ?? '> ') : 'Pairing code: ');
  }

  get bound(): boolean {
    return this.playerId !== null;
  }

  start(): void {
    if (this.o.decl.banner) this.say(this.o.decl.banner);
    if (!this.playerId) this.say('Type the pairing code your game shows (pause menu, World link), or a resume word.');
    this.prompt();
  }

  /** One line typed (already printable, at most the line limit). Lines are handled one at a time, in order. */
  line(text: string): Promise<void> {
    this.busy = this.busy.then(() => this.handle(text)).catch(() => this.o.close('error'));
    return this.busy;
  }

  private async handle(text: string): Promise<void> {
    if (this.closed) return;
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 16);
    if (!this.playerId) {
      if (!words.length) return this.prompt();
      const r = await bindPlayer(this.o.ctx, this.o.resume, text);
      if ('refusal' in r) {
        this.o.ctx.reject('pairing', { connector: this.o.connector });
        const spent = this.o.failed?.() ?? false;
        if (++this.tries >= (this.o.maxTries ?? 3) || spent) {
          this.say('Too many wrong codes. Goodbye.');
          return this.o.close('pairing');
        }
        this.say('That code does not work. Try again.');
        return this.prompt();
      }
      this.playerId = r.playerId;
      this.say(r.word ? `Linked. Resume word, for 30 minutes: ${r.word}` : 'Linked again.');
      this.say('Type help to see what this terminal knows.');
      return this.prompt();
    }
    this.lineNo++;
    const [cmd, ...args] = words;
    if (!cmd) return this.prompt();
    if (cmd === 'exit' || cmd === 'quit') {
      this.say('Goodbye.');
      return this.o.close('exit');
    }
    if (cmd === 'help') {
      const own = this.disk ? ['ls', 'cd', 'pwd', 'cat', 'clear', 'exit'] : ['clear', 'exit'];
      this.say([...this.o.decl.commands.map((c) => c.says), ...own].join('\n'));
      return this.prompt();
    }
    if (cmd === 'clear') {
      this.o.write('\x1b[2J\x1b[H');
      return this.prompt();
    }
    if (this.disk && TERMINAL_BUILTINS.includes(cmd)) {
      // Arguments are taken from the line as typed (paths keep their case), never interpreted beyond a path.
      const raw = text.trim().split(/\s+/).slice(1);
      const out =
        cmd === 'pwd'
          ? this.disk.pwd()
          : cmd === 'cd'
            ? this.disk.cd(raw[0])
            : cmd === 'ls'
              ? this.disk.ls(raw[0])
              : this.disk.cat(raw[0]);
      if (out) this.say(out);
      return this.prompt();
    }
    const says = [cmd, ...args].join(' ');
    const c = this.o.decl.commands.find((x) => x.says === says);
    if (!c) {
      this.say('Unknown command. Type help.');
      return this.prompt();
    }
    this.say(c.reply);
    if (c.signal) {
      const r = await this.o.ctx.propose({
        source: this.o.connector,
        kind: c.signal,
        playerId: this.playerId,
        sessionId: this.o.sessionId,
        dedupeKey: dedupeKey(this.o.connector, `${this.o.sessionId}:${this.lineNo}`),
        payload: { command: this.o.decl.commands.indexOf(c), line: this.lineNo },
        receivedAt: new Date().toISOString(),
      });
      if (!r.ok) this.say(`(the world did not answer: ${r.refusal})`);
    }
    this.prompt();
  }
}
