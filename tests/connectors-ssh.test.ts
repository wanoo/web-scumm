// The SSH connector (4.1.9, docs/dev/threat-models/ssh.md): `ssh2` with its native parts refused, a password that is
// a pairing code (3 tries), a declared public key, a virtual terminal and disk; exec, sftp and forwarding refused;
// hostile commands (`../`, `$(…)`, NUL bytes, a 1 MB line), resizing. Port 0, closed after. Excluded from the
// `windows` CI job until ported (said in .github/workflows/ci.yml).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ssh2, { type ClientChannel } from 'ssh2';
import { afterAll, describe, expect, it } from 'vitest';
import { SshConnector, wrap } from '../connectors/src/ssh/connector';
import { contextFor, startBridge, type TestBridge } from './fixtures/connectors/harness';

const cleanup: (() => Promise<unknown> | void)[] = [];
afterAll(async () => {
  for (const f of cleanup.reverse()) await f();
});

const host = ssh2.utils.generateKeyPairSync('ed25519');
const player = ssh2.utils.generateKeyPairSync('ed25519');

async function sshServer(t: TestBridge, keys: { key: string; playerId: string }[] = [], lines: string[] = []) {
  const { ctx } = await contextFor(t, 'ssh', { lines });
  const c = new SshConnector({ port: 0, hostKey: host.private, keys });
  await c.start(ctx);
  cleanup.push(() => c.stop());
  return c;
}

/** Connects; resolves with the client, or with the error the server ended it on. */
function login(port: number, o: { password?: string; privateKey?: string }) {
  const c = new ssh2.Client();
  return new Promise<{ client: InstanceType<typeof ssh2.Client> } | { error: Error }>((ok) => {
    c.on('ready', () => ok({ client: c }));
    c.on('error', (error: Error) => ok({ error }));
    c.connect({ host: '127.0.0.1', port, username: 'player', readyTimeout: 10_000, tryKeyboard: false, ...o });
  });
}

function shell(client: InstanceType<typeof ssh2.Client>, cols = 80) {
  return new Promise<{ stream: ClientChannel; text: () => string; until: (re: RegExp) => Promise<void> }>((ok, ko) =>
    client.shell({ cols, rows: 24, term: 'xterm' }, (err, stream) => {
      if (err) return ko(err);
      let buf = '';
      stream.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
      });
      const until = async (re: RegExp) => {
        const t0 = Date.now();
        while (!re.test(buf)) {
          if (Date.now() - t0 > 8000) throw new Error(`timed out on ${re}: ${JSON.stringify(buf.slice(-400))}`);
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      ok({ stream, text: () => buf, until });
    }),
  );
}

describe('ssh2 builds no native code', () => {
  it('maps cpu-features and nan to the refusing stub, and ssh2 has no compiled binding', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { resolved?: string; link?: boolean }>;
    };
    for (const n of ['cpu-features', 'nan'])
      expect(lock.packages[`node_modules/${n}`]).toEqual({ resolved: 'connectors/vendor/refused-native', link: true });
    const nodeFiles = (d: string): string[] =>
      existsSync(d)
        ? readdirSync(d).flatMap((e) => {
            const p = join(d, e);
            return statSync(p).isDirectory() ? nodeFiles(p) : e.endsWith('.node') ? [p] : [];
          })
        : [];
    expect(nodeFiles('node_modules/ssh2')).toEqual([]);
  });
});

describe('the SSH connector', () => {
  let t: TestBridge;
  it('logs in with a pairing code, keeps to its virtual disk and commands, proposes once', async () => {
    t = await startBridge();
    cleanup.push(() => t.close());
    const lines: string[] = [];
    const c = await sshServer(t, [], lines);
    const code = await t.code();
    const r = await login(c.port, { password: code });
    if ('error' in r) throw r.error;
    cleanup.push(() => {
      r.client.end();
    });
    const sh = await shell(r.client);
    await sh.until(/Resume word, for 30 minutes: R\w{4}-\w{4}[\s\S]*shed\$ $/);
    const write = (s: string) => sh.stream.write(s);
    write('cat ../../../../etc/passwd\r');
    await sh.until(/cat: no such file/);
    write('cd /..\rpwd\r');
    await sh.until(/shed\$ \/\r\n/);
    write('cat /notes/lamp.txt\r');
    await sh.until(/The lamp obeys two words: lamp on\./);
    for (const hostile of ['$(reboot)', '`id`', 'lamp on; rm -rf /', 'lamp\x00 on']) write(`${hostile}\r`);
    write(`${'z'.repeat(600)}\r`);
    await sh.until(/Line too long \(512 bytes at most\)/);
    write('lamp on\r');
    await sh.until(/a lamp glows/);
    const { playerId } = (await (await fetch(new URL(`v1/pairings/${code}`, t.url))).json()) as { playerId: string };
    await new Promise((x) => setTimeout(x, 100));
    // `lamp\0 on`: the NUL is dropped and "lamp on" remains: two lines, two facts (the game applies the signal once).
    expect(t.count(playerId)).toBe(2);
    expect(sh.text().match(/Unknown command\. Type help\./g)?.length).toBe(3);
    expect(lines.join('\n')).not.toMatch(new RegExp(`${code}|passwd|reboot`));
    // A 1 MB line passes the 64 KB a second a session may send: the session is closed, the server goes on.
    const closed = new Promise<void>((ok) => sh.stream.on('close', () => ok()));
    write('z'.repeat(1024 * 1024));
    await closed;
    expect((await c.health()).ok).toBe(true);
  }, 30_000);

  it('refuses exec, sftp and forwarding, and wraps output at the terminal width', async () => {
    const c = await sshServer(t);
    const r = await login(c.port, { password: await t.code() });
    if ('error' in r) throw r.error;
    cleanup.push(() => {
      r.client.end();
    });
    const exec = await new Promise<Error | undefined>((ok) => r.client.exec('id', (err) => ok(err)));
    expect(exec).toBeInstanceOf(Error);
    const sftp = await new Promise<Error | undefined>((ok) => r.client.sftp((err) => ok(err)));
    expect(sftp).toBeInstanceOf(Error);
    const fwd = await new Promise<Error | undefined>((ok) =>
      r.client.forwardOut('127.0.0.1', 1, '127.0.0.1', 22, (err) => ok(err)),
    );
    expect(fwd).toBeInstanceOf(Error);
    expect(wrap('abcdefghij', 4)).toBe('abcd\r\nefgh\r\nij');
    const sh = await shell(r.client, 10);
    await sh.until(/shed\$ $/);
    sh.stream.setWindow(24, 12, 0, 0);
    sh.stream.write('cat /notes/door.txt\r');
    await sh.until(/The shed doo\r\nr opens for/);
  }, 30_000);

  it('closes after three wrong passwords, accepts a declared key, refuses an unknown one', async () => {
    const c = await sshServer(t, [{ key: player.public, playerId: 'p-0123456789abcdef' }]);
    const bad = await login(c.port, { password: 'WRONG123' });
    expect('error' in bad).toBe(true);
    const keyed = await login(c.port, { privateKey: player.private });
    if ('error' in keyed) throw keyed.error;
    keyed.client.end();
    const stranger = await login(c.port, { privateKey: ssh2.utils.generateKeyPairSync('ed25519').private });
    expect('error' in stranger).toBe(true);
  }, 30_000);
});
