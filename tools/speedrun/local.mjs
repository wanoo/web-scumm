// What the local speedrun tools share (4.1.14 "Time Attack", D23): a run's events as the player's page posts them to a
// tool on the same machine (`?speedrunTool=<port>`), reduced to a fixed list of fields so no secret, token, save or
// personal datum can pass, and a tiny HTTP server bound to 127.0.0.1 that accepts them. Neither runs on the Bridge nor
// in the PWA: they are Node processes the player starts beside OBS or LiveSplit.
import { createServer } from 'node:http';

/** The kinds of events a page may post. */
export const KINDS = ['start', 'split', 'missed', 'finish', 'tick', 'pause', 'resume', 'reset'];
const ID = /^[\w.%+-]{1,64}$/;
const text = (x, n = 80) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f<>]/g, '').slice(0, n) : undefined);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1e10 ? Math.round(x) : undefined);

/**
 * An event reduced to what an overlay or a splitter needs: its kind, the category's name, a split's id and name, the
 * times in milliseconds (in-game and real), the split list. Anything else is dropped; a malformed event is null.
 */
export function cleanEvent(e) {
  if (!e || typeof e !== 'object' || !KINDS.includes(e.kind)) return null;
  const out = { kind: e.kind };
  const category = text(e.category);
  if (category) out.category = category;
  const timing = ['rta', 'igt', 'active-igt'].includes(e.timing) ? e.timing : undefined;
  if (timing) out.timing = timing;
  if (e.split && typeof e.split === 'object' && ID.test(e.split.id ?? '')) {
    out.split = { id: e.split.id };
    const name = text(e.split.name);
    if (name) out.split.name = name;
  }
  for (const k of ['igtMs', 'rtaMs', 'deltaMs']) {
    const v =
      k === 'deltaMs' ? (typeof e[k] === 'number' && Number.isFinite(e[k]) ? Math.round(e[k]) : undefined) : num(e[k]);
    if (v !== undefined) out[k] = v;
  }
  if (Array.isArray(e.splits))
    out.splits = e.splits
      .filter((s) => s && ID.test(s.id ?? ''))
      .slice(0, 200)
      .map((s) => ({ id: s.id, ...(text(s.name) ? { name: text(s.name) } : {}) }));
  return out;
}

/** Reads a small JSON body (16 KB at most). */
async function body(req) {
  let n = 0;
  const chunks = [];
  for await (const c of req) {
    n += c.length;
    if (n > 16384) throw new Error('too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/**
 * A local server: `POST /event` (CORS open: the page is on another origin, nothing here is secret) hands each clean
 * event to `onEvent`; any other request goes to `route` (or 404). Bound to 127.0.0.1 only.
 */
export function localServer({ port = 0, onEvent, route }) {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'POST' && path === '/event') {
      try {
        const e = cleanEvent(await body(req));
        if (!e) return res.writeHead(400).end('not an event');
        await onEvent(e);
        return res.writeHead(204).end();
      } catch {
        return res.writeHead(400).end('not an event');
      }
    }
    if (route && (await route(req, res, path))) return;
    res.writeHead(404).end();
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

/** `--name=value` from argv. */
export const arg = (argv, k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

/** Milliseconds as `m:ss.mmm` (`h:mm:ss.mmm` past an hour). */
export function clock(ms) {
  if (ms === undefined || ms === null) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const f = String(Math.floor(ms % 1000)).padStart(3, '0');
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${f}`
    : `${m}:${String(s).padStart(2, '0')}.${f}`;
}
