// Development only (4.1.9): the worker's TypeScript source through tsx. The package runs src/mime-worker.mjs, bundled.
import { tsImport } from 'tsx/esm/api';

await tsImport('./mime-worker.ts', import.meta.url);
