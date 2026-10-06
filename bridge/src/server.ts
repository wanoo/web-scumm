// The Bridge over HTTP (4.1.1, docs/en/REALITY-OPS.md): the routes onto `Bridge`, Server-Sent Events, CORS for the
// game's origins, a body limit, and the demonstration webhook (an HMAC-signed request turned into a finite signal by
// its connector's own Biscuit). node:http only.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { Bridge, BridgeError } from './bridge';

/** A webhook: its shared secret, the connector token it proposes with, and the events it turns into signals. */
export interface WebhookConfig {
  secret: string;
  token: string;
  source: string;
  /** The `event` field of a request → a signal of the manifest. Anything else is refused. */
  map: Record<string, string>;
}

export interface ServeOptions {
  /** Origins allowed to call the player's routes (the game's site); none: same origin only. */
  origins?: string[];
  webhooks?: Record<string, WebhookConfig>;
  /** Seconds between SSE heartbeats. */
  heartbeat?: number;
  /**
   * Requests one address may make per minute on the routes that need no token (a code, the keys, the manifest), and
   * authentications it may fail per minute on the others before every request of its is refused for a while.
   */
  perMinutePerIp?: number;
  /** Behind a reverse proxy: the client's address is the first entry of `X-Forwarded-For`. */
  trustProxy?: boolean;
}

/** Token buckets per address (4.1.2): one for the routes anyone may call, one for failed authentications. */
class Buckets {
  private b = new Map<string, { tokens: number; at: number }>();
  constructor(private perMinute: number) {}
  private bucket(ip: string, now: number): { tokens: number; at: number } {
    let x = this.b.get(ip);
    if (!x) {
      x = { tokens: this.perMinute, at: now };
      this.b.set(ip, x);
      // The map stays small: addresses idle for two minutes are forgotten once it grows.
      if (this.b.size > 10_000) for (const [k, v] of this.b) if (now - v.at > 120_000) this.b.delete(k);
    }
    x.tokens = Math.min(this.perMinute, x.tokens + ((now - x.at) / 60_000) * this.perMinute);
    x.at = now;
    return x;
  }
  /** Takes a token for this address; false when it has none left this minute. */
  take(ip: string, now = Date.now()): boolean {
    const x = this.bucket(ip, now);
    if (x.tokens < 1) return false;
    x.tokens -= 1;
    return true;
  }
  empty(ip: string, now = Date.now()): boolean {
    return this.bucket(ip, now).tokens < 1;
  }
}

/** The routes anyone may call without a token: a code, its state, the keys, the manifest. */
const ANONYMOUS = (method: string | undefined, path: string) =>
  (method === 'POST' && path === '/v1/pairings') ||
  (method === 'GET' && /^\/v1\/pairings\/[A-Z0-9]{8}$/.test(path)) ||
  (method === 'GET' && (path === '/v1/keys' || path === '/v1/manifest'));

const bearer = (req: IncomingMessage) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];

async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new BridgeError(413, 'size', `a request body is at most ${limit} bytes`);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}
const json = (b: Buffer): unknown => {
  try {
    return b.length ? JSON.parse(b.toString('utf8')) : {};
  } catch {
    throw new BridgeError(400, 'shape', 'not JSON');
  }
};

/** HMAC-SHA256 of the raw body, as `sha256=<hex>` in `X-Web-Scumm-Signature`, compared in constant time. */
export function webhookSignature(secret: string, raw: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}
function checkSignature(secret: string, raw: Buffer, header: string | string[] | undefined): void {
  const want = Buffer.from(webhookSignature(secret, raw));
  const got = Buffer.from(typeof header === 'string' ? header : '');
  if (got.length !== want.length || !timingSafeEqual(got, want))
    throw new BridgeError(401, 'signature', 'bad webhook signature');
}

export function bridgeServer(bridge: Bridge, o: ServeOptions = {}): Server {
  const origins = new Set(o.origins ?? []);
  const anonymous = new Buckets(o.perMinutePerIp ?? 60);
  const failures = new Buckets(o.perMinutePerIp ?? 60);
  const addressOf = (req: IncomingMessage) => {
    const fwd = o.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || req.socket.remoteAddress || 'unknown';
  };
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    }
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, data === undefined ? {} : { 'Content-Type': 'application/json' });
      res.end(data === undefined ? undefined : JSON.stringify(data));
    };
    const ip = addressOf(req);
    try {
      if (req.method === 'OPTIONS') return send(204);
      const url = new URL(req.url ?? '/', 'http://bridge');
      const path = url.pathname;
      const after = Number(url.searchParams.get('after') ?? 0) || 0;
      let m: RegExpExecArray | null;
      // An address over its minute on the routes anyone may call, or out of failed authentications: refused for a
      // while, before any token is parsed or any store read (docs/dev/THREAT-MODEL.md, flooding).
      if (failures.empty(ip) || (ANONYMOUS(req.method, path) && !anonymous.take(ip))) {
        res.setHeader('Retry-After', '60');
        throw new BridgeError(429, 'rate', 'too many requests from this address: try again in a minute');
      }
      if (req.method === 'GET' && path === '/v1/keys') return send(200, { keys: bridge.keys() });
      if (req.method === 'GET' && path === '/v1/manifest')
        return send(200, { manifest: bridge.config.manifest, hash: bridge.config.manifestHash });
      if (req.method === 'POST' && path === '/v1/pairings') {
        const b = json(await body(req, bridge.limits.bodyBytes)) as { gameId?: unknown };
        return send(201, bridge.startPairing(String(b.gameId ?? '')));
      }
      if ((m = /^\/v1\/pairings\/([A-Z0-9]{8})$/.exec(path)) && req.method === 'GET')
        return send(200, bridge.claimPairing(m[1]!));
      if ((m = /^\/v1\/pairings\/([A-Z0-9]{8})\/confirm$/.exec(path)) && req.method === 'POST')
        return send(200, await bridge.confirmPairing(bearer(req) ?? '', m[1]!));
      if (req.method === 'POST' && path === '/v1/signals') {
        const r = await bridge.propose(bearer(req) ?? '', json(await body(req, bridge.limits.bodyBytes)));
        return send(r.duplicate ? 200 : 202, r);
      }
      if (req.method === 'GET' && path === '/v1/signals') {
        // `sequences` (4.1.2) says each signal's sequence, so a reader's cursor follows the Bridge, never a count.
        const xs = await bridge.signals(bearer(req), after);
        return send(200, { signals: xs.map((x) => x.jws), sequences: xs.map((x) => x.sequence) });
      }
      if (req.method === 'POST' && path === '/v1/unlink') {
        bridge.unlink(bearer(req));
        return send(204);
      }
      if (req.method === 'POST' && path === '/v1/ack') {
        bridge.ack(bearer(req), (json(await body(req, bridge.limits.bodyBytes)) as { through?: unknown }).through);
        return send(204);
      }
      if (req.method === 'GET' && path === '/v1/events') {
        // Server-Sent Events: what is already there after the cursor, then each new signal; `id` is the sequence.
        // The stream is registered first, then the backlog read: a signal accepted while the backlog goes out is
        // held and sent after it, so nothing falls between the two (a repeat is recognised by the player).
        const cap = bearer(req);
        const from = Math.max(after, Number(req.headers['last-event-id'] ?? 0) || 0);
        let sending = true;
        const held: [number, string][] = [];
        const event = (seq: number, jws: string) => {
          if (sending) return void held.push([seq, jws]);
          res.write(`id: ${seq}\nevent: signal\ndata: ${jws}\n\n`);
          // A reader that stopped reading: the Bridge keeps nothing for it beyond the buffer; it reconnects from its cursor.
          if (res.writableLength > bridge.limits.streamBufferBytes) res.end();
        };
        const off = bridge.subscribe(cap, event, () => res.end());
        let backlog: { sequence: number; jws: string }[];
        try {
          backlog = await bridge.signals(cap, from);
        } catch (e) {
          off();
          throw e;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        sending = false;
        for (const x of backlog) event(x.sequence, x.jws);
        for (const [seq, jws] of held.splice(0)) if (seq > from) event(seq, jws);
        const beat = setInterval(
          () => (bridge.streamAlive(cap) ? res.write(': keep-alive\n\n') : res.end()),
          (o.heartbeat ?? 15) * 1000,
        );
        req.on('close', () => {
          clearInterval(beat);
          off();
        });
        return;
      }
      if (req.method === 'POST' && path === '/v1/admin/revoke') {
        const b = json(await body(req, bridge.limits.bodyBytes)) as { playerId?: string; tokenId?: string };
        bridge.revoke(bearer(req), b);
        return send(204);
      }
      if ((m = /^\/v1\/admin\/players\/(p-[a-f0-9]{16})$/.exec(path))) {
        if (req.method === 'GET') return send(200, bridge.exportPlayer(bearer(req), m[1]!));
        if (req.method === 'DELETE') {
          bridge.forgetPlayer(bearer(req), m[1]!);
          return send(204);
        }
      }
      if ((m = /^\/v1\/hooks\/([\w-]{1,64})$/.exec(path)) && req.method === 'POST') {
        const hook = o.webhooks?.[m[1]!];
        if (!hook) throw new BridgeError(404, 'hook', 'no such webhook');
        const raw = await body(req, bridge.limits.bodyBytes);
        checkSignature(hook.secret, raw, req.headers['x-web-scumm-signature']);
        const b = json(raw) as { playerId?: unknown; event?: unknown; id?: unknown };
        const signal = typeof b.event === 'string' ? hook.map[b.event] : undefined;
        if (!signal) throw new BridgeError(422, 'event', 'this webhook does not know that event');
        if (typeof b.id !== 'string' || !b.id)
          throw new BridgeError(400, 'shape', '`id` names the delivery (deduplication)');
        const r = await bridge.propose(hook.token, {
          playerId: b.playerId,
          signal,
          source: hook.source,
          dedupeKey: `${m[1]}:${b.id}`,
        });
        return send(r.duplicate ? 200 : 202, r);
      }
      send(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof BridgeError) {
        if (e.status === 401 || e.status === 403) failures.take(ip);
        return send(e.status, { error: e.code, message: e.message });
      }
      console.error(JSON.stringify({ event: 'error', message: e instanceof Error ? e.message : 'unknown' }));
      send(500, { error: 'internal' });
    }
  });
}
