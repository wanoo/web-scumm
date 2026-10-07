// The network policy of the Open Badges connector (4.1.9, docs/dev/threat-models/open-badge.md): what a badge makes
// the connector fetch is an SSRF waiting to happen, so every request goes through `SafeFetcher`. `https:` only; the
// host must be in the allowlist; the name is resolved once and the socket connects to that address (a DNS answer
// cannot change between the check and the connection); loopback, private, link-local, CGNAT, documentation,
// multicast and unspecified addresses are refused (IPv4, IPv6, IPv4-mapped IPv6); at most 2 redirects, each checked
// the same way; 64 KB and 10 s per document; JSON nested at most 8 deep. `@context` is never dereferenced.
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

export interface NetPolicy {
  /** Host names allowed, lower case (by default the hosts of the game's issuers). */
  hosts: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  maxDepth?: number;
  /** The resolver (tests give their own); by default the system's, every address. */
  resolve?: (host: string) => Promise<string[]>;
  /** Tests only: `http:` allowed, and these exact addresses exempt from the private-range refusal. */
  testing?: { allowHttp?: boolean; allowAddresses?: string[] };
}

export type Fetched =
  | { ok: true; status: number; url: string; text: string; json: unknown }
  | { ok: false; status?: number; reason: string };

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 96], // the unspecified address, loopback and IPv4-compatible addresses (::a.b.c.d)
  ['2001::', 32], // Teredo: an IPv4 address tunnelled inside

  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** Whether an address may be connected to: a public unicast address only. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return !blocked.check(ip, 'ipv4');
  if (v === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.[1];
    if (mapped) return !blocked.check(mapped, 'ipv4');
    if (/^::ffff:/i.test(ip)) return false;
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

/** How deep a parsed JSON value nests (iterative: a hostile document cannot overflow the stack here). */
export function jsonDepth(v: unknown, limit: number): number {
  let max = 0;
  const stack: [unknown, number][] = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (x === null || typeof x !== 'object') continue;
    max = Math.max(max, d);
    if (max > limit) return max;
    for (const y of Object.values(x as Record<string, unknown>)) stack.push([y, d + 1]);
  }
  return max;
}

export class SafeFetcher {
  constructor(private p: NetPolicy) {}

  private get hosts() {
    return new Set(this.p.hosts.map((h) => h.toLowerCase()));
  }

  /** One GET under the policy, redirects followed (≤ 2), JSON parsed when it is JSON. Never throws. */
  async get(url: string): Promise<Fetched> {
    let current = url;
    for (let hop = 0; hop <= (this.p.maxRedirects ?? 2); hop++) {
      const r = await this.once(current);
      if (!r.ok || !('redirect' in r)) return r;
      current = r.redirect;
    }
    return { ok: false, reason: 'too many redirects' };
  }

  private async once(raw: string): Promise<Fetched | { ok: true; redirect: string }> {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return { ok: false, reason: 'not a URL' };
    }
    const http = u.protocol === 'http:' && this.p.testing?.allowHttp;
    if (u.protocol !== 'https:' && !http) return { ok: false, reason: 'https only' };
    if (u.username || u.password) return { ok: false, reason: 'credentials in a URL' };
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!this.hosts.has(host)) return { ok: false, reason: 'host not allowed' };
    let addresses: string[];
    try {
      addresses = isIP(host)
        ? [host]
        : await (this.p.resolve ?? (async (h) => (await lookup(h, { all: true })).map((a) => a.address)))(host);
    } catch {
      return { ok: false, reason: 'unresolved host' };
    }
    const allowed = new Set(this.p.testing?.allowAddresses ?? []);
    // Resolved once: every address must be public (a name that also answers a private address is refused), and the
    // connection goes to the first, whatever the resolver would answer next.
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a) && !allowed.has(a)))
      return { ok: false, reason: 'address not public' };
    const address = addresses[0]!;
    const family = isIP(address);
    return new Promise((done) => {
      const req = (http ? httpRequest : httpsRequest)(
        u,
        {
          method: 'GET',
          headers: { Accept: 'application/ld+json, application/json, text/plain', 'User-Agent': 'web-scumm-connector' },
          lookup: (_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
            o?.all ? cb(null, [{ address, family }]) : cb(null, address, family),
          servername: isIP(host) ? undefined : host,
          timeout: this.p.timeoutMs ?? 10_000,
        } as never,
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            try {
              return done({ ok: true, redirect: new URL(res.headers.location, u).toString() });
            } catch {
              return done({ ok: false, reason: 'bad redirect' });
            }
          }
          const chunks: Buffer[] = [];
          let n = 0;
          res.on('data', (c: Buffer) => {
            n += c.length;
            if (n > (this.p.maxBytes ?? 64 * 1024)) {
              req.destroy();
              done({ ok: false, status, reason: 'document over 64 KB' });
            } else chunks.push(c);
          });
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (status < 200 || status >= 300) return done({ ok: false, status, reason: `status ${status}` });
            let json: unknown;
            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }
            if (json !== undefined && jsonDepth(json, this.p.maxDepth ?? 8) > (this.p.maxDepth ?? 8))
              return done({ ok: false, status, reason: 'JSON nested too deep' });
            done({ ok: true, status, url: u.toString(), text, json });
          });
          res.on('error', () => done({ ok: false, status, reason: 'read failed' }));
        },
      );
      // The whole exchange, not only a silence on the socket: a document trickled byte by byte is cut too.
      const all = setTimeout(() => {
        req.destroy();
        done({ ok: false, reason: 'timed out' });
      }, this.p.timeoutMs ?? 10_000);
      all.unref();
      req.on('close', () => clearTimeout(all));
      req.on('timeout', () => {
        req.destroy();
        done({ ok: false, reason: 'timed out' });
      });
      req.on('error', () => done({ ok: false, reason: 'connection failed' }));
      req.end();
    });
  }
}
