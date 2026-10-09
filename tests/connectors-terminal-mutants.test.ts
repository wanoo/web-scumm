// The line assembler and the virtual disk under their mutation set (4.1.18 PR 2, docs/dev/MUTANTS.md): each boundary
// of `printable`, the CR/LF/NUL handling, the escape cap, the pty echo and backspace, the line limit, and every path
// of the virtual disk pinned by a short test, so that no survivor of `connectors` is left unexplained here.
import { describe, expect, it } from 'vitest';
import { LineAssembler, printable } from '../connectors/src/terminal/line';
import { VirtualDisk } from '../connectors/src/terminal/vfs';

function run(input: string | number[], maxLine = 16, pty?: boolean) {
  const lines: string[] = [];
  const echo: string[] = [];
  const ev = { long: 0, cancel: 0 };
  const on = {
    line: (t: string) => lines.push(t),
    tooLong: () => ev.long++,
    cancel: () => ev.cancel++,
    echo: (s: string) => echo.push(s),
  };
  const l = pty === undefined ? new LineAssembler(maxLine, on) : new LineAssembler(maxLine, on, pty);
  l.push(typeof input === 'string' ? Buffer.from(input) : new Uint8Array(input));
  return { lines, echo: echo.join(''), ...ev };
}

describe('printable, at each boundary', () => {
  it('drops exactly the control, bidirectional and zero-width ranges', () => {
    const cp = (c: number) => printable(String.fromCodePoint(c));
    for (const c of [0x1f, 0x7f, 0x9f, 0x200b, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff]) expect(cp(c)).toBe('');
    for (const c of [0x20, 0x7e, 0xa0, 0x200a, 0x2010, 0x2029, 0x202f, 0x2065, 0x206a]) expect(cp(c)).not.toBe('');
  });
});

describe('line assembler', () => {
  it('starts with no pending CR, and forgets the CR once its LF is swallowed', () => {
    expect(run('\n').lines).toEqual(['']);
    expect(run('\r\n\n').lines).toEqual(['', '']);
  });

  it('swallows the NUL of a CR NUL, which keeps the CR pending', () => {
    expect(run('\r\0\n').lines).toEqual(['']);
  });

  it('ends an escape sequence on @ and ~, and gives up after 16 bytes', () => {
    expect(run('\x1b[@x\r').lines).toEqual(['x']);
    expect(run('\x1b[2~x\r').lines).toEqual(['x']);
    expect(run(`\x1b${'0'.repeat(20)}ab\r`, 32).lines).toEqual(['0000ab']);
  });

  it('refuses a line one byte over the limit, and control bytes do not count', () => {
    expect(run('abc\r', 3)).toMatchObject({ lines: ['abc'], long: 0 });
    expect(run('abcd\r', 3)).toMatchObject({ lines: [], long: 1 });
    expect(run('ab\x07\x07c\r', 3)).toMatchObject({ lines: ['abc'], long: 0 });
  });

  it('without a pty (the default): no echo, no editing, DEL and Ctrl-C are dropped', () => {
    const r = run('ab\x7f\x03cé\r');
    expect(r).toMatchObject({ lines: ['abcé'], echo: '', cancel: 0 });
    expect(run('ab\x7fc\r', 16, false)).toMatchObject({ lines: ['abc'], echo: '' });
  });

  it('with a pty: echoes ASCII, one dot per non-ASCII character, CR LF at the end', () => {
    expect(run('a€é\r', 16, true)).toMatchObject({ lines: ['a€é'], echo: 'a··\r\n' });
    expect(run([0x80], 16, true).echo).toBe('');
  });

  it('with a pty: backspace removes one whole UTF-8 character, and nothing on an empty line', () => {
    expect(run('\x7f\r', 16, true)).toMatchObject({ lines: [''], echo: '\r\n' });
    expect(run('aé\x7f\r', 16, true)).toMatchObject({ lines: ['a'], echo: 'a·\b \b\r\n' });
  });

  it('with a pty: nothing is echoed past the limit', () => {
    expect(run('abcd\r', 2, true)).toMatchObject({ long: 1, echo: 'ab\r\n' });
  });
});

describe('virtual disk', () => {
  const disk = () => new VirtualDisk({ 'top.txt': 'T', 'a/f.txt': 'F', '/': 'root?', '..': 'up?' });

  it('never makes a file of the root', () => {
    expect(disk().cat('/')).toBe('cat: is a directory');
    expect(disk().ls('/')).toBe('a/  top.txt');
  });

  it('resolves an absolute path from the root, not from the current directory', () => {
    const d = disk();
    expect(d.cd('a')).toBeNull();
    expect(d.cat('/top.txt')).toBe('T');
    expect(VirtualDisk.normalise('/a', '/top.txt')).toBe('/top.txt');
  });

  it('tells a missing directory from a file, lists a file by its name, refuses a missing path', () => {
    const d = disk();
    expect(d.cd('nope')).toBe('cd: no such directory');
    expect(d.cd('top.txt')).toBe('cd: not a directory');
    expect(d.ls('a/f.txt')).toBe('f.txt');
    expect(d.ls('nope')).toBe('ls: no such file or directory');
  });

  it('asks which file when cat has none', () => {
    expect(disk().cat(undefined)).toBe('cat: which file?');
    expect(disk().cat('')).toBe('cat: which file?');
  });
});
