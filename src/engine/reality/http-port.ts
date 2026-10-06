// The player's transport to a Reality Bridge (4.1.1, D17): Server-Sent Events read with fetch (so the capability
// travels in an Authorization header, never in a URL), reconnecting from the last sequence; and the same signals by a
// plain fetch by cursor when a stream is not possible. Acknowledgements are POSTs. A `WorldSignalPort`: the engine
// never sees the network.
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
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), ok()), { once: true });
  });

/** Parses an SSE stream into events with their `id` and `data`. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ id?: string; data: string }> {
  const reader = body.getReader();
  const text = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += text.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let id: string | undefined;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { ...(id !== undefined ? { id } : {}), data: data.join('\n') };
    }
  }
}

export function httpPort(o: HttpPortOptions): WorldSignalPort {
  const f = o.fetch ?? fetch;
  const base = o.url.endsWith('/') ? o.url : `${o.url}/`;
  const auth = { Authorization: `Bearer ${o.capability}` };
  let closed = false;
  return {
    async *connect({ after, signal }) {
      let cursor = after;
      let wait = o.retryMs ?? 1000;
      while (!closed && !signal?.aborted) {
        o.onStatus?.('connecting');
        try {
          if (o.mode === 'poll') {
            const r = await f(`${base}v1/signals?after=${cursor}`, { headers: auth, signal });
            if (!r.ok) throw new Error(`Bridge: ${r.status}`);
            const { signals } = (await r.json()) as { signals: string[] };
            o.onStatus?.('open');
            for (const jws of signals) {
              cursor++;
              yield jws;
            }
          } else {
            const r = await f(`${base}v1/events?after=${cursor}`, {
              headers: { ...auth, Accept: 'text/event-stream' },
              signal,
            });
            if (!r.ok || !r.body) throw new Error(`Bridge: ${r.status}`);
            o.onStatus?.('open');
            wait = o.retryMs ?? 1000;
            for await (const e of sseEvents(r.body)) {
              if (e.id) cursor = Math.max(cursor, Number(e.id) || cursor);
              yield e.data;
            }
          }
        } catch (e) {
          if (signal?.aborted || closed) break;
          void e;
        }
        o.onStatus?.('retrying');
        await sleep(wait, signal);
        if (o.mode !== 'poll') wait = Math.min(wait * 2, 60_000);
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
    },
    async close() {
      closed = true;
    },
  };
}
