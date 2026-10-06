import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const COOKIE = 'web_scumm_studio';
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const cookie = (req: IncomingMessage) =>
  Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((x) => x.trim().split('=').map(decodeURIComponent))
      .filter((x) => x.length === 2),
  );

/** The host part of a `Host` header, without its port (`[::1]:5173` → `[::1]`, `localhost:5173` → `localhost`). */
const hostname = (host: string) => host.replace(/:\d+$/, '').toLowerCase();

/**
 * The names the Studio answers to (4.1.2): this machine's, and in LAN mode the addresses `dev:lan` serves
 * (`WEB_SCUMM_STUDIO_HOSTS`). A page on another site that rebinds its own name to this port sends that name as
 * `Host` (and as `Origin`, so the same-origin check alone would let it through): refused.
 */
export function allowedStudioHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const own = ['localhost', '127.0.0.1', '[::1]'];
  const lan = (env.WEB_SCUMM_STUDIO_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...own, ...lan]);
}

/** Same-origin + optional LAN token guard shared by every file-writing development route. */
export function authorizeStudioRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const host = req.headers.host;
  if (!host || /[\s/@\\]/.test(host)) {
    res.statusCode = 400;
    res.end('invalid Host');
    return false;
  }
  if (!allowedStudioHosts().has(hostname(host))) {
    res.statusCode = 403;
    res.end('the Studio answers its own names only (localhost, 127.0.0.1, [::1], or the address dev:lan serves)');
    return false;
  }
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      /* rejected below */
    }
    if (originHost !== host) {
      res.statusCode = 403;
      res.end('cross-origin Studio request refused');
      return false;
    }
  } else if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')) {
    res.statusCode = 403;
    res.end('Studio writes require a same-origin Origin header');
    return false;
  }

  if (process.env.WEB_SCUMM_LAN !== '1') return true;
  const expected = process.env.WEB_SCUMM_STUDIO_TOKEN;
  if (!expected) {
    res.statusCode = 503;
    res.end('LAN Studio token is not configured');
    return false;
  }
  const url = new URL(req.url ?? '/', `http://${host}`);
  const supplied = req.headers['x-web-scumm-token'];
  const candidate =
    (typeof supplied === 'string' ? supplied : undefined) ?? url.searchParams.get('token') ?? cookie(req)[COOKIE];
  if (!candidate || !equal(candidate, expected)) {
    res.statusCode = 401;
    res.end('Studio token required');
    return false;
  }
  if (url.searchParams.get('token')) {
    res.setHeader('set-cookie', `${COOKIE}=${encodeURIComponent(expected)}; HttpOnly; SameSite=Strict; Path=/`);
  }
  return true;
}
