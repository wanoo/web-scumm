// The MIME reader in its own thread (4.1.9, docs/dev/threat-models/email.md): a small heap (64 MB), a time budget per
// message (2 s), one message at a time. A worker that fails, overruns or runs out of memory is terminated and the
// message refused; the next message gets a fresh worker. The connector's own thread never parses a message.
import { Worker } from 'node:worker_threads';
import type { MimeResult } from './mime';

export interface ParserOptions {
  timeoutMs?: number;
  heapMb?: number;
  /** Tests only: another worker (one that never answers, to test the time budget). */
  workerUrl?: URL;
}

/** In the package the worker is bundled next to the connector (`src/mime-worker.mjs`); from the sources, through tsx. */
const workerUrl = () =>
  import.meta.url.endsWith('.ts')
    ? new URL('./mime-worker.boot.mjs', import.meta.url)
    : new URL('./mime-worker.mjs', import.meta.url);

export class MimeParser {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  /** Workers replaced after a failure (a metric, and what the tests watch). */
  restarts = 0;
  constructor(private o: ParserOptions = {}) {}

  /** A fresh worker, once it says it is ready (its start-up is not counted in a message's budget). */
  private spawn(): Promise<Worker> {
    const heap = this.o.heapMb ?? 64;
    const w = new Worker(this.o.workerUrl ?? workerUrl(), {
      resourceLimits: { maxOldGenerationSizeMb: heap, maxYoungGenerationSizeMb: Math.max(4, heap / 8) },
      stdout: false,
      stderr: true,
    });
    w.unref();
    return new Promise<Worker>((ok, ko) => {
      const timer = setTimeout(() => ko(new Error('the reader did not start')), 30_000);
      w.once('message', () => {
        clearTimeout(timer);
        ok(w);
      });
      w.once('error', (e) => {
        clearTimeout(timer);
        ko(e);
      });
    });
  }

  /** Reads one message; never throws. */
  parse(bytes: Uint8Array): Promise<MimeResult> {
    const run = this.queue.then(() => this.run(bytes));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(bytes: Uint8Array): Promise<MimeResult> {
    let w: Worker;
    try {
      w = await (this.worker ??= this.spawn());
    } catch {
      this.worker = null;
      return { ok: false, reason: 'the reader could not start' };
    }
    const id = ++this.seq;
    return new Promise<MimeResult>((done) => {
      const fail = (reason: string) => {
        cleanup();
        this.restarts++;
        this.worker = null;
        void w.terminate();
        done({ ok: false, reason });
      };
      const onMessage = (m: { id: number; result: MimeResult }) => {
        if (m.id !== id) return;
        cleanup();
        done(m.result);
      };
      const onError = () => fail('the reader failed on this message');
      const onExit = () => fail('the reader stopped on this message');
      const timer = setTimeout(() => fail('the reader ran out of time'), this.o.timeoutMs ?? 2000);
      const cleanup = () => {
        clearTimeout(timer);
        w.off('message', onMessage);
        w.off('error', onError);
        w.off('exit', onExit);
      };
      w.on('message', onMessage);
      w.on('error', onError);
      w.on('exit', onExit);
      w.postMessage({ id, bytes });
    });
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await (await w.catch(() => null))?.terminate();
  }
}
