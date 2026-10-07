// A MIME worker that says it is ready and then never answers (tests/connectors-email.test.ts: the time budget).
import { parentPort } from 'node:worker_threads';

parentPort?.postMessage({ ready: true });
parentPort?.on('message', () => {});
