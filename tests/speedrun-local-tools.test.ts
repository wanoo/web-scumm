// The local speedrun tools (4.1.14 "Time Attack", D23): the OBS overlay serves a page and Server-Sent Events from the
// events the player's page posts, with nothing but a category, split ids and names and times (a token or a save posted
// alongside is dropped); the LiveSplit autosplitter turns them into LiveSplit's commands over a local WebSocket (a fake
// LiveSplit here: the real one is a human pass), and exports a run as a LiveSplit splits file.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error: plain ES modules of the local tools (no types)
import { cleanEvent } from '../tools/speedrun/local.mjs';
// @ts-expect-error: plain ES modules of the local tools (no types)
import { startOverlay } from '../tools/speedrun/overlay.mjs';
// @ts-expect-error: plain ES modules of the local tools (no types)
import { commandsFor, lssFromRun, startAutosplit } from '../tools/speedrun/livesplit.mjs';

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});
const port = (s: Server) => (s.address() as AddressInfo).port;

describe('the events a page may post', () => {
  it('keeps a category, split ids and names, times; drops everything else', () => {
    const e = cleanEvent({
      kind: 'split',
      category: 'Any%',
      timing: 'igt',
      split: { id: 'key', name: 'Key', secret: 'x' },
      igtMs: 1234.4,
      token: 'bearer abc',
      save: { inventory: ['key'] },
      playerId: 'p-1',
    });
    expect(e).toEqual({
      kind: 'split',
      category: 'Any%',
      timing: 'igt',
      split: { id: 'key', name: 'Key' },
      igtMs: 1234,
    });
    expect(cleanEvent({ kind: 'drop-tables' })).toBeNull();
    expect(cleanEvent(null)).toBeNull();
    expect(cleanEvent({ kind: 'start', category: '<script>x</script>' }).category).toBe('scriptx/script');
  });
});

describe('the OBS overlay', () => {
  it('serves its page (full, compact, transparent) and streams the posted events', async () => {
    const { server } = await startOverlay(0);
    closers.push(() => server.close());
    const base = `http://127.0.0.1:${port(server)}`;
    const page = await (await fetch(`${base}/?mode=compact`)).text();
    expect(page).toContain("new EventSource('/events')");
    expect(page).toMatch(/compact/);
    const ctrl = new AbortController();
    closers.push(() => ctrl.abort());
    const sse = await fetch(`${base}/events`, { signal: ctrl.signal });
    expect(sse.headers.get('content-type')).toBe('text/event-stream');
    const reader = sse.body!.getReader();
    const post = await fetch(`${base}/event`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'start', category: 'Any%', splits: [{ id: 'key', name: 'Key' }], token: 'secret' }),
    });
    expect(post.status).toBe(204);
    expect((await fetch(`${base}/event`, { method: 'POST', body: '{"kind":"nope"}' })).status).toBe(400);
    let text = '';
    while (!/data: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    const data = JSON.parse(text.split('data: ')[1]!.split('\n')[0]!);
    expect(data).toEqual({ kind: 'start', category: 'Any%', splits: [{ id: 'key', name: 'Key' }] });
    expect(text).not.toContain('secret');
  });
});

/** A fake LiveSplit: a WebSocket server that records the text frames it receives (RFC 6455, by hand). */
function fakeLiveSplit(): Promise<{ server: Server; received: string[] }> {
  const received: string[] = [];
  const server = createServer();
  server.on('upgrade', (req, socket: Socket) => {
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buf = Buffer.alloc(0);
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 6) {
        const op = buf[0]! & 0x0f;
        let len = buf[1]! & 0x7f;
        let off = 2;
        if (len === 126) {
          len = buf.readUInt16BE(2);
          off = 4;
        }
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4);
        const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mask[i % 4]!));
        buf = buf.subarray(off + 4 + len);
        if (op === 1) received.push(payload.toString('utf8'));
        if (op === 8) socket.end();
      }
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, received })));
}

describe('the LiveSplit autosplitter', () => {
  it('drives LiveSplit from the page’s events: start, in-game time, split, skip, pause, reset', async () => {
    const ls = await fakeLiveSplit();
    closers.push(() => ls.server.close());
    const a = await startAutosplit({ port: 0, livesplit: `ws://127.0.0.1:${port(ls.server)}/livesplit` });
    closers.push(() => a.close());
    expect(await a.ready).not.toBeNull();
    const base = `http://127.0.0.1:${port(a.server)}`;
    for (const e of [
      { kind: 'start', category: 'Any%' },
      { kind: 'split', split: { id: 'key' }, igtMs: 65_432 },
      { kind: 'missed', split: { id: 'found' } },
      { kind: 'pause' },
      { kind: 'reset' },
    ])
      expect((await fetch(`${base}/event`, { method: 'POST', body: JSON.stringify(e) })).status).toBe(204);
    for (let i = 0; i < 100 && ls.received.length < 9; i++) await new Promise((r) => setTimeout(r, 10));
    expect(ls.received).toEqual([
      'reset',
      'initgametime',
      'starttimer',
      'pausegametime',
      'setgametime 1:05.432',
      'split',
      'skipsplit',
      'pausegametime',
      'reset',
    ]);
    expect(commandsFor({ kind: 'tick', igtMs: 1000 })).toEqual(['setgametime 0:01.000']);
  });

  it('exports a run as a LiveSplit splits file, its in-game times as the personal best', () => {
    const env = JSON.parse(readFileSync('tests/fixtures/speedrun/reference-any.wsrun', 'utf8'));
    const lss = lssFromRun(env, ['Ladder', 'Cellar', 'Lights', 'Board', 'Festival']);
    expect(lss).toContain('<CategoryName>any%</CategoryName>');
    expect(lss.match(/<Segment>/g)).toHaveLength(5);
    expect(lss).toMatch(/<Name>Festival<\/Name>.*<GameTime>00:0\d:\d\d\.\d{7}<\/GameTime>/);
  });
});
