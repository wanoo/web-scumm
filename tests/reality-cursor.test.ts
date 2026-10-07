// The transport's cursor and the acknowledgement (4.1.8, the plan's P0): reproduced on 4.1.7 in polling by the
// maintainer. First request `after=0`; signal 1 delivered to the player but not acknowledged (a transient refusal, a
// save that failed, a crash before the ack); next request `after=1`. The port moved its own cursor at delivery, so
// the connection never asks for signal 1 again: the Bridge still holds it, the game never applies it until a full
// reconnection. The contract (`client.ts`: delivered at least once, applied at most once) needs the port to resume
// from what was *acknowledged*, not from what was *handed over*. These tests were the reproduction (red on 4.1.7,
// `it.fails`); the fix of 4.1.8 (three cursors: received, delivered, durable) makes them plain tests.
import { describe, expect, it } from 'vitest';
import { httpPort, sseEvents } from '@engine/reality/http-port';

/** A Bridge of `n` signals, `s1`…`sn`, as the two routes the port reads, and the `after` of every request it saw. */
function fakeBridge(n: number, o: { streamStaysOpen?: boolean } = {}) {
  const asked: { route: string; after: number }[] = [];
  const acked: number[] = [];
  const all = Array.from({ length: n }, (_, i) => ({ sequence: i + 1, jws: `s${i + 1}` }));
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/v1/ack')) {
      acked.push((JSON.parse(String(init?.body)) as { through: number }).through);
      return new Response(null, { status: 204 });
    }
    const after = Number(url.searchParams.get('after') ?? 0);
    const pending = all.filter((s) => s.sequence > after);
    if (url.pathname.endsWith('/v1/signals')) {
      asked.push({ route: 'signals', after });
      return Response.json({ signals: pending.map((s) => s.jws), sequences: pending.map((s) => s.sequence) });
    }
    if (url.pathname.endsWith('/v1/events')) {
      asked.push({ route: 'events', after });
      // The stream carries the pending signals as the server writes them, then ends (a proxy's timeout, a network
      // cut) or, as the real Bridge does, stays open with heartbeats until the reader ends it (`streamStaysOpen`).
      const frames = pending.map((s) => `id: ${s.sequence}\nevent: signal\ndata: ${s.jws}\n\n`);
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const x of frames) c.enqueue(new TextEncoder().encode(x));
          if (!o.streamStaysOpen) c.close();
          else init?.signal?.addEventListener('abort', () => c.close(), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { asked, acked, fetch };
}

/** Reads the port, acknowledging `ack(n)` after the n-th signal when it is not null, until the port's next request. */
async function readThen(
  bridge: ReturnType<typeof fakeBridge>,
  mode: 'poll' | 'sse',
  ack: (i: number) => number | null,
) {
  const port = httpPort({ url: 'http://bridge.test/', capability: 'cap', fetch: bridge.fetch, mode, retryMs: 5 });
  const ctrl = new AbortController();
  const got: string[] = [];
  const requestsBefore = bridge.asked.length;
  const reading = (async () => {
    for await (const jws of port.connect({ gameId: 'signals', playerId: 'p', after: 0, signal: ctrl.signal })) {
      // Never `break` here: leaving the loop closes the generator, and the port would make no next request.
      got.push(jws);
      const through = ack(got.length);
      if (through !== null) await port.acknowledge({ playerId: 'p', through });
    }
  })();
  // The first request, then the signals handed over, then the next request (a poll, a reconnection).
  for (let i = 0; i < 200 && bridge.asked.length < requestsBefore + 2; i++) await new Promise((r) => setTimeout(r, 5));
  ctrl.abort();
  await port.close();
  await reading;
  // The harness itself: the next request did arrive (a slow runner would otherwise hand back request 1 as "next").
  expect(bridge.asked.length).toBeGreaterThanOrEqual(requestsBefore + 2);
  return { got, next: bridge.asked[requestsBefore + 1]! };
}

describe('the port resumes from the acknowledged cursor, not from the delivered one (P0, fixed in 4.1.8)', () => {
  it('polling: a signal handed over and not acknowledged is asked for again (reproduced on 4.1.7: after=1)', async () => {
    const b = fakeBridge(1);
    const { got, next } = await readThen(b, 'poll', () => null);
    // Handed over, not acknowledged, handed over again by the next poll: at least once.
    expect(got.slice(0, 2)).toEqual(['s1', 's1']);
    expect(b.acked).toEqual([]);
    expect(next.route).toBe('signals');
    // 4.1.7 asked `after=1`: signal 1 was never delivered again on this connection.
    expect(next.after).toBe(0);
  });

  it('SSE: after the stream ends, the reconnection asks from the acknowledged cursor (reproduced: after=1)', async () => {
    const b = fakeBridge(1);
    const { got, next } = await readThen(b, 'sse', () => null);
    expect(got.slice(0, 2)).toEqual(['s1', 's1']);
    expect(next.route).toBe('events');
    expect(next.after).toBe(0);
  });

  it('polling: an acknowledged signal is not asked for again', async () => {
    const b = fakeBridge(1);
    const { got, next } = await readThen(b, 'poll', (i) => i);
    expect(got).toEqual(['s1']);
    expect(b.acked).toEqual([1]);
    expect(next).toEqual({ route: 'signals', after: 1 });
  });

  it('SSE: an acknowledged signal is not asked for again after a reconnection', async () => {
    const b = fakeBridge(1);
    const { got, next } = await readThen(b, 'sse', (i) => i);
    expect(got).toEqual(['s1']);
    expect(b.acked).toEqual([1]);
    expect(next).toEqual({ route: 'events', after: 1 });
  });

  it('polling: two signals, the first acknowledged and the second not: the next request starts at 1', async () => {
    const b = fakeBridge(2);
    const { got, next } = await readThen(b, 'poll', (i) => (i === 1 ? 1 : null));
    expect(got.slice(0, 3)).toEqual(['s1', 's2', 's2']);
    expect(b.acked).toEqual([1]);
    // 4.1.7 asked `after=2`: signal 2, handed over and not acknowledged, was lost to this connection.
    expect(next.after).toBe(1);
  });

  it('polling: a signal refused for a while backs off, then is applied when the reader acknowledges', async () => {
    const b = fakeBridge(1);
    const port = httpPort({ url: 'http://bridge.test/', capability: 'cap', fetch: b.fetch, mode: 'poll', retryMs: 5 });
    const ctrl = new AbortController();
    const seen: string[] = [];
    let pollsAtAck = -1;
    const reading = (async () => {
      for await (const jws of port.connect({ gameId: 'signals', playerId: 'p', after: 0, signal: ctrl.signal })) {
        seen.push(jws);
        if (seen.length === 3) {
          pollsAtAck = b.asked.length;
          await port.acknowledge({ playerId: 'p', through: 1 });
        }
      }
    })();
    for (let i = 0; i < 400 && b.acked.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 60));
    ctrl.abort();
    await port.close();
    await reading;
    expect(seen.slice(0, 3)).toEqual(['s1', 's1', 's1']);
    expect(b.acked).toEqual([1]);
    // Every poll after the acknowledgement asks from 1 and gets nothing; the waits before it grew (5, 10, 20 ms…).
    expect(b.asked.slice(pollsAtAck).every((a) => a.after === 1)).toBe(true);
    expect(b.asked.slice(0, pollsAtAck).every((a) => a.after === 0)).toBe(true);
  });

  it('SSE: lines may end with CRLF or CR, one space after `data:` goes, an event over its limit ends the stream', async () => {
    const stream = (text: string) => new Response(text).body as ReadableStream<Uint8Array>;
    const all = async (body: ReadableStream<Uint8Array>, o?: { maxFrameBytes?: number; maxBufferBytes?: number }) => {
      const out: { id?: string; data: string }[] = [];
      for await (const e of sseEvents(body, o)) out.push(e);
      return out;
    };
    expect(await all(stream('id: 1\r\ndata: a\r\n\r\nid: 2\rdata:  b\r\r'))).toEqual([
      { id: '1', data: 'a' },
      { id: '2', data: ' b' },
    ]);
    // A CR that ends a chunk is the first half of a CRLF in the next one: not two line ends.
    const chunks = ['id: 3\r', '\ndata: c\r\n\r\n'];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    });
    expect(await all(body)).toEqual([{ id: '3', data: 'c' }]);
    await expect(all(stream(`data: ${'x'.repeat(100)}\n\n`), { maxFrameBytes: 50 })).rejects.toThrow(/over the limit/);
    await expect(all(stream('x'.repeat(100)), { maxBufferBytes: 50 })).rejects.toThrow(/without an event's end/);
  });

  it('the three cursors are reported: received and delivered move at delivery, durable at the acknowledgement', async () => {
    const b = fakeBridge(2);
    const seen: { received: number; delivered: number; durable: number }[] = [];
    const port = httpPort({
      url: 'http://bridge.test/',
      capability: 'cap',
      fetch: b.fetch,
      mode: 'poll',
      retryMs: 5,
      onCursors: (c) => seen.push(c),
    });
    const ctrl = new AbortController();
    const reading = (async () => {
      for await (const jws of port.connect({ gameId: 'signals', playerId: 'p', after: 0, signal: ctrl.signal })) {
        if (jws === 's2') {
          await port.acknowledge({ playerId: 'p', through: 2 });
          ctrl.abort();
        }
      }
    })();
    await reading;
    await port.close();
    expect(seen).toContainEqual({ received: 1, delivered: 1, durable: 0 });
    expect(seen).toContainEqual({ received: 2, delivered: 2, durable: 0 });
    expect(seen.at(-1)).toEqual({ received: 2, delivered: 2, durable: 2 });
  });

  it('SSE on a stream the Bridge keeps open: a signal not settled makes the port end the stream and ask again', async () => {
    const b = fakeBridge(1, { streamStaysOpen: true });
    const port = httpPort({ url: 'http://bridge.test/', capability: 'cap', fetch: b.fetch, mode: 'sse', retryMs: 5 });
    const ctrl = new AbortController();
    const got: string[] = [];
    const reading = (async () => {
      for await (const jws of port.connect({ gameId: 'signals', playerId: 'p', after: 0, signal: ctrl.signal })) {
        got.push(jws);
        // The third time it comes, the game applies and saves it: acknowledged, the stream stays open for good.
        if (got.length === 3) await port.acknowledge({ playerId: 'p', through: 1 });
      }
    })();
    for (let i = 0; i < 400 && b.acked.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const requestsAtAck = b.asked.length;
    await new Promise((r) => setTimeout(r, 60));
    ctrl.abort();
    await port.close();
    await reading;
    // Three streams opened, every one from the durable cursor 0; none after the acknowledgement.
    expect(got.slice(0, 3)).toEqual(['s1', 's1', 's1']);
    expect(b.asked.slice(0, requestsAtAck).map((a) => [a.route, a.after])).toEqual([
      ['events', 0],
      ['events', 0],
      ['events', 0],
    ]);
    expect(b.asked.length).toBe(requestsAtAck);
    expect(b.acked).toEqual([1]);
  });

  it('SSE, two signals not settled, the first acknowledged from outside the loop: the second is asked for again', async () => {
    const b = fakeBridge(2, { streamStaysOpen: true });
    const port = httpPort({ url: 'http://bridge.test/', capability: 'cap', fetch: b.fetch, mode: 'sse', retryMs: 5 });
    const ctrl = new AbortController();
    const got: string[] = [];
    const reading = (async () => {
      for await (const jws of port.connect({ gameId: 'signals', playerId: 'p', after: 0, signal: ctrl.signal })) {
        got.push(jws);
        // The reader settles nothing here; the first acknowledgement lands later, from outside the loop.
        if (got.length === 2) setTimeout(() => void port.acknowledge({ playerId: 'p', through: 1 }), 1);
      }
    })();
    for (let i = 0; i < 400 && !b.asked.some((a) => a.after === 1); i++) await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 400 && got.filter((x) => x === 's2').length < 2; i++)
      await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    await port.close();
    await reading;
    expect(got.slice(0, 2)).toEqual(['s1', 's2']);
    // Signal 1 settled, signal 2 still handed over and not acknowledged: the stream was ended and reopened from 1.
    expect(b.asked.some((a) => a.route === 'events' && a.after === 1)).toBe(true);
    expect(got.filter((x) => x === 's2').length).toBeGreaterThanOrEqual(2);
    expect(got.filter((x) => x === 's1').length).toBe(1);
  });

  it('close() alone ends a connection that is sleeping or streaming', async () => {
    const b = fakeBridge(0, { streamStaysOpen: true });
    const port = httpPort({
      url: 'http://bridge.test/',
      capability: 'cap',
      fetch: b.fetch,
      mode: 'sse',
      retryMs: 60_000,
    });
    const statuses: string[] = [];
    const port2 = httpPort({
      url: 'http://bridge.test/',
      capability: 'cap',
      fetch: b.fetch,
      mode: 'poll',
      retryMs: 60_000,
      onStatus: (x) => statuses.push(x),
    });
    const reading = (async () => {
      for await (const _ of port.connect({ gameId: 'signals', playerId: 'p', after: 0 })) void _;
    })();
    const polling = (async () => {
      for await (const _ of port2.connect({ gameId: 'signals', playerId: 'p', after: 0 })) void _;
    })();
    await new Promise((r) => setTimeout(r, 20));
    await port.close();
    await port2.close();
    await Promise.race([
      Promise.all([reading, polling]),
      new Promise((_, no) => setTimeout(() => no(new Error('still connected after close()')), 1000)),
    ]);
    expect(statuses.at(-1)).toBe('closed');
  });
});
