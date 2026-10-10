// Lines out of a byte stream, for the virtual terminals (4.1.9): Telnet (the client echoes) and SSH (a pty: the server
// echoes what is typed, handles backspace, Ctrl-C, Ctrl-D and swallows escape sequences). A line is at most `maxLine`
// bytes: beyond, it is discarded whole and reported, never cut and run. Control characters never reach a line.

export interface LineEvents {
  line: (text: string) => void;
  /** A line passed the limit: it is dropped up to its end. */
  tooLong: () => void;
  /** Ctrl-C (pty): the line is dropped. */
  cancel?: () => void;
  /** Ctrl-D on an empty line (pty). */
  eof?: () => void;
  /** What the server writes back while the line is typed (pty only). */
  echo?: (s: string) => void;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

/** The printable part of a line: no C0/C1 control, no bidirectional override, no zero-width character. */
export function printable(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c < 0xa0) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e)) continue;
    if ((c >= 0x2066 && c <= 0x2069) || c === 0xfeff) continue;
    out += ch;
  }
  return out;
}

export class LineAssembler {
  private bytes: number[] = [];
  private overflow = false;
  private lastCr = false;
  private escape = 0;

  constructor(
    private maxLine: number,
    private on: LineEvents,
    /** A pty: the server echoes and edits. */
    private pty = false,
  ) {}

  push(chunk: Uint8Array): void {
    for (const b of chunk) this.byte(b);
  }

  private end(): void {
    if (this.overflow) this.on.tooLong();
    else this.on.line(printable(decoder.decode(new Uint8Array(this.bytes))));
    this.bytes = [];
    this.overflow = false;
  }

  private byte(b: number): void {
    // An escape sequence (arrow keys, function keys): swallowed, at most 16 bytes.
    if (this.escape > 0) {
      this.escape = b >= 0x40 && b <= 0x7e && this.escape > 1 ? 0 : this.escape + 1;
      if (this.escape > 16) this.escape = 0;
      return;
    }
    if (b === 0x1b) {
      this.escape = 1;
      return;
    }
    if (b === 0x0a && this.lastCr) {
      this.lastCr = false;
      return;
    }
    if (b === 0x00 && this.lastCr) return;
    this.lastCr = b === 0x0d;
    if (b === 0x0d || b === 0x0a) {
      if (this.pty) this.on.echo?.('\r\n');
      return this.end();
    }
    if (this.pty) {
      if (b === 0x03) {
        this.bytes = [];
        this.overflow = false;
        this.on.echo?.('^C\r\n');
        return this.on.cancel?.();
      }
      if (b === 0x04 && this.bytes.length === 0) return this.on.eof?.();
      if (b === 0x7f || b === 0x08) {
        if (this.bytes.length) {
          // Back over one UTF-8 character: continuation bytes, then the byte that leads them (4.1.18: the lead byte
          // was left behind). On an empty array `pop` gives undefined, and `undefined & 0xc0` is 0: the loop ends.
          let gone: number;
          do gone = this.bytes.pop()!;
          while ((gone & 0xc0) === 0x80);
          // Only a character that was shown takes a column back (4.1.19): never one of the prompt's.
          if (gone !== undefined) this.on.echo?.('\b \b');
        }
        return;
      }
    }
    if (b < 0x20 || b === 0x7f) return;
    // UTF-8 kept well formed (4.1.19): a continuation byte that continues nothing, or a byte that never leads one,
    // is dropped, so the buffer holds whole characters and their beginnings only (a character split across two network
    // chunks is still whole: this state is the buffer itself).
    if ((b & 0xc0) === 0x80 ? !this.continues() : b >= 0xf8 || b === 0xc0 || b === 0xc1) return;
    if (this.overflow) return;
    if (this.bytes.length >= this.maxLine) {
      this.overflow = true;
      this.bytes = [];
      return;
    }
    this.bytes.push(b);
    if (this.pty && b < 0x80) this.on.echo?.(String.fromCharCode(b));
    else if (this.pty && (b & 0xc0) !== 0x80) this.on.echo?.('·');
  }

  /** Whether the buffer ends inside a character, waiting for a continuation byte. */
  private continues(): boolean {
    let k = this.bytes.length - 1;
    while (k >= 0 && (this.bytes[k]! & 0xc0) === 0x80) k--;
    if (k < 0) return false;
    const lead = this.bytes[k]!;
    const need = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0;
    return this.bytes.length - 1 - k < need;
  }
}
