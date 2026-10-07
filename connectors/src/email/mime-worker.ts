// The worker thread that reads a message (4.1.9): a MIME bomb exhausts this thread's small heap or its time budget,
// never the connector's. One message at a time; `parse.ts` replaces the worker when it fails or overruns.
import { parentPort } from 'node:worker_threads';
import { parseMail } from './mime';

parentPort?.on('message', (m: { id: number; bytes: Uint8Array }) => {
  parentPort?.postMessage({ id: m.id, result: parseMail(m.bytes) });
});
parentPort?.postMessage({ ready: true });
