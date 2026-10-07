// What the connectors that listen over HTTP share (4.1.9): a body read under a limit, a per-address budget, a JSON
// answer, a listen that says its port. node:http only.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The body, refused (413) as soon as it passes `limit` bytes: never buffered beyond. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'too-large');
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new HttpError(413, 'too-large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Requests per address and minute; the map forgets idle addresses once it grows. */
export class PerAddress {
  private m = new Map<string, number[]>();
  constructor(
    private perMinute: number,
    private now: () => number = Date.now,
  ) {}
  take(address: string): boolean {
    const t = this.now();
    if (this.m.size > 10_000) for (const [k, v] of this.m) if (!v.some((x) => x > t - 60_000)) this.m.delete(k);
    const xs = (this.m.get(address) ?? []).filter((x) => x > t - 60_000);
    if (xs.length >= this.perMinute) {
      this.m.set(address, xs);
      return false;
    }
    xs.push(t);
    this.m.set(address, xs);
    return true;
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

/** Listens and resolves with the port actually bound (`port: 0` in the tests). */
export function listen(server: Server | import('node:net').Server, port: number, host: string): Promise<number> {
  return new Promise((ok, ko) => {
    server.once('error', ko);
    server.listen(port, host, () => {
      server.off('error', ko);
      ok((server.address() as AddressInfo).port);
    });
  });
}

/**
 * Stops a server: no new connection, the requests in flight (`pending`) answered, then every connection still open
 * (idle keep-alives) closed.
 */
export async function closeServer(server: Server | undefined, pending: Iterable<Promise<unknown>> = []): Promise<void> {
  if (!server) return;
  const closed = new Promise<void>((ok) => server.close(() => ok()));
  await Promise.allSettled([...pending]);
  server.closeAllConnections?.();
  await closed;
}
