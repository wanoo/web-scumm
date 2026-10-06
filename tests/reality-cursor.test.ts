// The transport's cursor and the acknowledgement (4.1.8, the plan's P0): reproduced on 4.1.7 in polling by the
// maintainer. First request `after=0`; signal 1 delivered to the player but not acknowledged (a transient refusal, a
// save that failed, a crash before the ack); next request `after=1`. The port moved its own cursor at delivery, so
// the connection never asks for signal 1 again: the Bridge still holds it, the game never applies it until a full
// reconnection. The contract (`client.ts`: delivered at least once, applied at most once) needs the port to resume
// from what was *acknowledged*, not from what was *handed over*. These tests are the reproduction; the three marked
// `it.fails` are red on 4.1.7 and become plain `it` with the fix (three cursors: received, delivered, durable).
import { describe, expect, it } from 'vitest';
import { httpPort } from '@engine/reality/http-port';

/** A Bridge of `n` signals, `s1`…`sn`, as the two routes the port reads, and the `after` of every request it saw. */
function fakeBridge(n: number, o: { streamClosesAfter?: number } = {}) {
  const asked: { route: string; after: number }[] = [];
  const acked: number[] = [];
  const all = Array.from({ length: n }, (_, i) => ({ sequence: i + 1, jws: `s${i + 1}` }));
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/v1/ack')) {
      acked.push((JSON.parse(String(init?.body)) as { through: number }).through);
      return new Response('{}', { status: 200 });
    }
    const after = Number(url.searchParams.get('after') ?? 0);
    const pending = all.filter((s) => s.sequence > after);
    if (url.pathname.endsWith('/v1/signals')) {
      asked.push({ route: 'signals', after });
      return Response.json({ signals: pending.map((s) => s.jws), sequences: pending.map((s) => s.sequence) });
    }
    if (url.pathname.endsWith('/v1/events')) {
      asked.push({ route: 'events', after });
      // The stream carries the pending signals, then ends (a proxy's timeout, a network cut): the port reconnects.
      const sent = pending.slice(0, o.streamClosesAfter ?? pending.length);
      const body = sent.map((s) => `id: ${s.sequence}\ndata: ${s.jws}\n\n`).join('');
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
  return { got, next: bridge.asked.at(-1)! };
}

describe('the port resumes from the acknowledged cursor, not from the delivered one (P0, 4.1.8)', () => {
  it.fails('polling: a signal handed over and not acknowledged is asked for again (reproduced on 4.1.7: after=1)', async () => {
    const b = fakeBridge(1);
    const { got, next } = await readThen(b, 'poll', () => null);
    expect(got).toEqual(['s1']);
    expect(b.acked).toEqual([]);
    expect(next.route).toBe('signals');
    // 4.1.7 asks `after=1`: signal 1 is never delivered again on this connection.
    expect(next.after).toBe(0);
  });

  it.fails('SSE: after the stream ends, the reconnection asks from the acknowledged cursor (reproduced: after=1)', async () => {
    const b = fakeBridge(1);
    const { got, next } = await readThen(b, 'sse', () => null);
    expect(got).toEqual(['s1']);
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

  it.fails('polling: two signals, the first acknowledged and the second not: the next request starts at 1', async () => {
    const b = fakeBridge(2);
    const { got, next } = await readThen(b, 'poll', (i) => (i === 1 ? 1 : null));
    expect(got).toEqual(['s1', 's2']);
    expect(b.acked).toEqual([1]);
    // 4.1.7 asks `after=2`: signal 2, handed over and not acknowledged, is lost to this connection.
    expect(next.after).toBe(1);
  });
});
