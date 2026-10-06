// The player's transport to a Reality Bridge (4.1.1, D17): Server-Sent Events read with fetch (so the capability
// travels in an Authorization header, never in a URL), and the same signals by a plain fetch by cursor when a stream
// is not possible. Acknowledgements are POSTs. A `WorldSignalPort`: the engine never sees the network.
//
// Three cursors (4.1.8, the P0 of the plan): `received` is the last sequence the Bridge sent, `delivered` the last one
// handed to the reader, `durable` the last one the reader acknowledged (applied and saved). Every request to the
// Bridge, a poll or a reconnection, asks from `durable`: a signal handed over and not acknowledged (a transient
// refusal, a save that failed, a crash before the ack) is delivered again, never skipped. 4.1.7 asked from the
// delivered cursor, so after signal 1 was handed over the connection asked `after=1` whether or not it was applied.
import type { WorldSignalPort } from '../core/ports';

export interface HttpPortOptions {
  /** The Bridge's base URL (`https://bridge.example/`). */
  url: string;
  /** The capability the pairing gave (read and acknowledge only). */
  capability: string;
  fetch?: typeof fetch;
  /** Milliseconds before reconnecting after the stream ends or fails (doubled up to a minute). */
  retryMs?: number;
  /** `poll`: a fetch by cursor every `retryMs` instead of a stream (tests, a proxy that buffers streams). */
  mode?: 'sse' | 'poll';
  onStatus?: (s: 'connecting' | 'open' | 'retrying' | 'closed') => void;
  /** The three cursors after each change (diagnostics, tests). */
  onCursors?: (c: PortCursors) => void;
  /** The largest SSE event accepted (bytes of text); beyond, the stream is dropped and reopened. Default 64 KiB. */
  maxFrameBytes?: number;
  /** The most text the SSE parser holds while waiting for an event's end. Default 1 MiB. */
  maxBufferBytes?: number;
}

export interface PortCursors {
  received: number;
  delivered: number;
  durable: number;
}

const MAX_WAIT_MS = 60_000;
const DEFAULT_FRAME_BYTES = 64 * 1024;
const DEFAULT_BUFFER_BYTES = 1024 * 1024;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), ok()), { once: true });
  });

/**
 * Parses an SSE stream into events with their `id` and `data`. Lines end with LF, CRLF or CR (the specification's
 * three); one space after `data:` is removed, as it says, no more. An event over `maxFrameBytes`, or a wait over
 * `maxBufferBytes` without an event's end, ends the parse with an error: the port reopens the stream from `durable`.
 */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  o: { maxFrameBytes?: number; maxBufferBytes?: number } = {},
): AsyncGenerator<{ id?: string; data: string }> {
  const maxFrame = o.maxFrameBytes ?? DEFAULT_FRAME_BYTES;
  const maxBuffer = o.maxBufferBytes ?? DEFAULT_BUFFER_BYTES;
  const reader = body.getReader();
  const text = new TextDecoder();
  let buf = '';
  /** The complete events in `buf`, each ended by a blank line. */
  function* events(): Generator<{ id?: string; data: string }> {
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      if (block.length > maxFrame) throw new Error(`Bridge: an event of ${block.length} bytes is over the limit`);
      let id: string | undefined;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('data:')) data.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
      }
      if (data.length) yield { ...(id !== undefined ? { id } : {}), data: data.join('\n') };
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        // The stream's end: a CR held back is a line end after all, and what it closes is delivered.
        buf = buf.replace(/\r/g, '\n');
        yield* events();
        return;
      }
      // CRLF and CR become LF; a CR that ends the chunk waits for the next one (it may be the first half of a CRLF).
      let t = (buf + text.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      const carry = t.endsWith('\r') ? '\r' : '';
      t = (carry ? t.slice(0, -1) : t).replace(/\r/g, '\n');
      buf = t + carry;
      if (buf.length > maxBuffer)
        throw new Error(`Bridge: event stream held ${buf.length} bytes without an event's end`);
      yield* events();
    }
  } finally {
    reader.releaseLock();
  }
}

export function httpPort(o: HttpPortOptions): WorldSignalPort {
  const f = o.fetch ?? fetch;
  const base = o.url.endsWith('/') ? o.url : `${o.url}/`;
  const auth = { Authorization: `Bearer ${o.capability}` };
  let closed = false;
  const cursors: PortCursors = { received: 0, delivered: 0, durable: 0 };
  const moved = () => o.onCursors?.({ ...cursors });
  const handed = (sequence: number) => {
    cursors.received = Math.max(cursors.received, sequence);
    cursors.delivered = Math.max(cursors.delivered, sequence);
    moved();
  };
  return {
    async *connect({ after, signal }) {
      cursors.durable = Math.max(cursors.durable, after);
      cursors.received = Math.max(cursors.received, after);
      cursors.delivered = Math.max(cursors.delivered, after);
      moved();
      let wait = o.retryMs ?? 1000;
      while (!closed && !signal?.aborted) {
        o.onStatus?.('connecting');
        // What the reader settled before this request: a poll that hands signals over and settles none backs off.
        const settledBefore = cursors.durable;
        let handedOver = 0;
        try {
          if (o.mode === 'poll') {
            const r = await f(`${base}v1/signals?after=${cursors.durable}`, { headers: auth, signal });
            if (!r.ok) throw new Error(`Bridge: ${r.status}`);
            // `sequences` (a 4.1.2 Bridge) says where each signal stands; a 4.1.1 Bridge sends them contiguous.
            const { signals, sequences } = (await r.json()) as { signals: string[]; sequences?: number[] };
            o.onStatus?.('open');
            for (let i = 0; i < signals.length; i++) {
              handed(sequences?.[i] ?? cursors.received + 1);
              handedOver++;
              yield signals[i]!;
            }
          } else {
            const r = await f(`${base}v1/events?after=${cursors.durable}`, {
              headers: { ...auth, Accept: 'text/event-stream', 'Last-Event-ID': String(cursors.durable) },
              signal,
            });
            if (!r.ok || !r.body) throw new Error(`Bridge: ${r.status}`);
            o.onStatus?.('open');
            wait = o.retryMs ?? 1000;
            for await (const e of sseEvents(r.body, o)) {
              handed(Number(e.id) || cursors.received + 1);
              handedOver++;
              yield e.data;
            }
          }
        } catch (e) {
          if (signal?.aborted || closed) break;
          void e;
        }
        if (closed || signal?.aborted) break;
        o.onStatus?.('retrying');
        await sleep(wait, signal);
        // Nothing settled out of what was handed over: the same signals come back; wait longer each time, up to a minute.
        const stuck = handedOver > 0 && cursors.durable === settledBefore;
        wait = o.mode === 'poll' && !stuck ? (o.retryMs ?? 1000) : Math.min(wait * 2, MAX_WAIT_MS);
      }
      o.onStatus?.('closed');
    },
    async acknowledge({ through }) {
      const r = await f(`${base}v1/ack`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ through }),
      });
      if (!r.ok) throw new Error(`Bridge: acknowledgement refused (${r.status})`);
      if (through > cursors.durable) {
        cursors.durable = through;
        moved();
      }
    },
    async close() {
      closed = true;
    },
  };
}
