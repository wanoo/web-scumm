// The proof worker's entry (solve-pool.ts): the worker itself is TypeScript (solve-worker.ts), loaded through tsx in
// this thread (a worker does not inherit the loader of the thread that started it).
import { tsImport } from 'tsx/esm/api';

await tsImport('./solve-worker.ts', import.meta.url);
