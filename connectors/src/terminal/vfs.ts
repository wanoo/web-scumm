// The virtual disk of a terminal session (4.1.9, docs/dev/threat-models/ssh.md): an in-memory tree built from the
// game's `reality.connectors.ssh.files`, one per session. A path is resolved inside this tree only: `..` above `/`
// stays at `/`, nothing names a file of the host, and nothing can be written.

export class VirtualDisk {
  private files = new Map<string, string>();
  private dirs = new Set<string>(['/']);
  cwd = '/';

  constructor(files: Record<string, string> = {}) {
    for (const [path, text] of Object.entries(files)) {
      const p = VirtualDisk.normalise('/', path);
      if (p === '/') continue;
      this.files.set(p, text);
      const parts = p.split('/').filter(Boolean);
      for (let i = 1; i < parts.length; i++) this.dirs.add(`/${parts.slice(0, i).join('/')}`);
    }
  }

  /** A path against a directory, inside the tree: `.` and empty parts dropped, `..` never above the root. */
  static normalise(cwd: string, path: string): string {
    const out: string[] = path.startsWith('/') ? [] : cwd.split('/').filter(Boolean);
    for (const part of path.split('/').slice(0, 64)) {
      if (!part || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part.slice(0, 64));
    }
    return `/${out.join('/')}`;
  }

  pwd(): string {
    return this.cwd;
  }

  cd(path = '/'): string | null {
    const p = VirtualDisk.normalise(this.cwd, path);
    if (!this.dirs.has(p)) return `cd: ${this.files.has(p) ? 'not a directory' : 'no such directory'}`;
    this.cwd = p;
    return null;
  }

  ls(path = '.'): string {
    const p = VirtualDisk.normalise(this.cwd, path);
    if (this.files.has(p)) return p.split('/').pop()!;
    if (!this.dirs.has(p)) return 'ls: no such file or directory';
    const prefix = p === '/' ? '/' : `${p}/`;
    const names = new Set<string>();
    for (const d of this.dirs)
      if (d !== p && d.startsWith(prefix) && !d.slice(prefix.length).includes('/'))
        names.add(`${d.slice(prefix.length)}/`);
    for (const f of this.files.keys())
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) names.add(f.slice(prefix.length));
    return [...names].sort().join('  ');
  }

  cat(path: string | undefined): string {
    if (!path) return 'cat: which file?';
    const p = VirtualDisk.normalise(this.cwd, path);
    const text = this.files.get(p);
    if (text !== undefined) return text;
    return this.dirs.has(p) ? 'cat: is a directory' : 'cat: no such file';
  }
}
