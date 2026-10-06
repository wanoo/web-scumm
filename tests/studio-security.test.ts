import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { allowedStudioHosts, authorizeStudioRequest } from '../tools/studio/security';
import { hostOf, parseProvider, privateHost } from '../tools/studio/assistant';
import { ProviderError, providerFetch, readCapped } from '../tools/studio/assistant-loop';

const oldLan = process.env.WEB_SCUMM_LAN;
const oldToken = process.env.WEB_SCUMM_STUDIO_TOKEN;
afterEach(() => {
  if (oldLan === undefined) delete process.env.WEB_SCUMM_LAN;
  else process.env.WEB_SCUMM_LAN = oldLan;
  if (oldToken === undefined) delete process.env.WEB_SCUMM_STUDIO_TOKEN;
  else process.env.WEB_SCUMM_STUDIO_TOKEN = oldToken;
});

describe('LAN Studio capability', () => {
  it('requires a token and same-origin writes', async () => {
    process.env.WEB_SCUMM_LAN = '1';
    process.env.WEB_SCUMM_STUDIO_TOKEN = 'secret-token';
    const server = createServer((req, res) => {
      if (authorizeStudioRequest(req, res)) {
        res.statusCode = 200;
        res.end('ok');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(base)).status).toBe(401);
      const login = await fetch(`${base}/?token=secret-token`);
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')!;
      expect(cookie).toContain('HttpOnly');
      expect((await fetch(base, { method: 'POST', headers: { cookie, origin: base } })).status).toBe(200);
      expect((await fetch(base, { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status).toBe(
        403,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('the names the Studio answers to', () => {
  it('refuses a Host that is not this machine, even with a matching Origin (DNS rebinding); LAN hosts are listed', async () => {
    delete process.env.WEB_SCUMM_LAN;
    const server = createServer((req, res) => {
      if (authorizeStudioRequest(req, res)) {
        res.statusCode = 200;
        res.end('ok');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    // `fetch` never lets a page set `Host`; a raw request does, as a rebinding browser would.
    const post = (host: string, origin = `http://${host}`) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          { host: '127.0.0.1', port, method: 'POST', path: '/', headers: { host, origin } },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
    try {
      expect(await post(`127.0.0.1:${port}`)).toBe(200);
      expect(await post('localhost:5173')).toBe(200);
      expect(await post('[::1]:5173')).toBe(200);
      // A page on evil.example whose name now points at 127.0.0.1: Host and Origin both say evil.example.
      expect(await post('evil.example:5173')).toBe(403);
      expect(await post('192.168.1.20:5173')).toBe(403);
      process.env.WEB_SCUMM_STUDIO_HOSTS = '192.168.1.20';
      expect(await post('192.168.1.20:5173')).toBe(200);
    } finally {
      delete process.env.WEB_SCUMM_STUDIO_HOSTS;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect([...allowedStudioHosts({ WEB_SCUMM_STUDIO_HOSTS: '10.0.0.2, 10.0.0.3' })]).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
      '10.0.0.2',
      '10.0.0.3',
    ]);
  });
});

describe('custom provider addresses', () => {
  const custom = (baseUrl: string) => parseProvider({ kind: 'openai', baseUrl, model: 'm' }, true);

  it('normalises IPv6 brackets and IPv4-mapped addresses', () => {
    expect(hostOf('[::1]')).toBe('::1');
    expect(hostOf('[::ffff:7f00:1]')).toBe('::ffff:7f00:1');
    expect(hostOf('[::ffff:127.0.0.1]')).toBe('127.0.0.1');
  });

  it('refuses loopback, unspecified, private, link-local and local-name hosts, in both IP families', () => {
    for (const h of [
      'localhost',
      'studio.localhost',
      'printer.local',
      'db.internal',
      '127.0.0.1',
      '127.9.9.9',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.1.1',
      '100.64.0.1',
      '[::1]',
      '[::]',
      '[fc00::1]',
      '[fd12::1]',
      '[fe80::1]',
      '[::ffff:127.0.0.1]',
      '[::ffff:7f00:1]',
    ]) {
      expect(privateHost(h), h).toBe(true);
      expect(() => custom(`https://${h}/v1`), h).toThrow(/local or private/);
    }
    for (const h of ['api.example.com', '8.8.8.8', '172.32.0.1', '[2001:db8::1]'])
      expect(privateHost(h), h).toBe(false);
    expect(custom('https://api.example.com/v1').baseUrl).toBe('https://api.example.com/v1');
    expect(() => custom('http://api.example.com/v1')).toThrow(/HTTPS/);
  });

  it('keeps Ollama on this machine only, with or without brackets', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]'])
      expect(parseProvider({ kind: 'ollama', baseUrl: `http://${h}:11434`, model: 'llama3.1' }, false).kind).toBe(
        'ollama',
      );
    expect(() =>
      parseProvider({ kind: 'ollama', baseUrl: 'http://192.168.1.10:11434', model: 'llama3.1' }, false),
    ).toThrow(/custom provider URLs are disabled/);
  });
});

describe('provider calls', () => {
  const url = 'https://api.example.com/v1/chat/completions';

  it('never follows a redirect', async () => {
    const f = (async () =>
      new Response('', { status: 302, headers: { location: 'http://10.0.0.1/' } })) as unknown as typeof fetch;
    await expect(providerFetch(f, url, { method: 'POST' })).rejects.toThrow(/redirect/);
    const opaque = (async () =>
      ({ status: 0, type: 'opaqueredirect', ok: false }) as unknown as Response) as unknown as typeof fetch;
    await expect(providerFetch(opaque, url, {})).rejects.toBeInstanceOf(ProviderError);
  });

  it("gives up after its deadline, and passes the caller's own abort through", async () => {
    const hang = ((_: string, init: RequestInit) =>
      new Promise<Response>((_, rej) =>
        init.signal!.addEventListener('abort', () => rej(init.signal!.reason)),
      )) as unknown as typeof fetch;
    await expect(providerFetch(hang, url, {}, { timeoutMs: 30 })).rejects.toThrow(/did not answer within/);
    const ctl = new AbortController();
    const p = providerFetch(hang, url, {}, { timeoutMs: 10000, signal: ctl.signal });
    ctl.abort(new Error('user left'));
    await expect(p).rejects.toThrow('user left');
  });

  it('reads an answer up to the cap, and refuses a bigger one', async () => {
    const body = (n: number) => new Response(new Uint8Array(n).fill(97));
    expect(await readCapped(body(10), 16)).toBe('a'.repeat(10));
    await expect(readCapped(body(32), 16)).rejects.toThrow(/exceeds/);
  });
});
