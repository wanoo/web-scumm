// A search's checkpoint on disk (4.1.13, src/engine/tools/solve/search/checkpoint.ts): `npm run solve -- --prove
// --checkpoint=<file> [--checkpoint-every=<seconds>] [--resume]` and `npm run prove:matrix -- --checkpoint-dir=<dir>`.
// Written to a temporary file, flushed (fsync), then renamed: a search killed while writing leaves the previous
// snapshot whole.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import type { SolveOptions } from '../src/engine/tools/solve';

export function fileCheckpoint(
  file: string,
  o: { resume?: boolean; everyMs?: number },
): NonNullable<SolveOptions['checkpoint']> {
  return {
    save(text) {
      // Durable before it counts: written to a temporary file, flushed to the disk, then renamed over the old one.
      const tmp = `${file}.${process.pid}.tmp`;
      const fd = openSync(tmp, 'w');
      try {
        writeSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, file);
    },
    resume: o.resume && existsSync(file) ? readFileSync(file, 'utf8') : null,
    ...(o.everyMs !== undefined ? { everyMs: o.everyMs } : {}),
  };
}

/** A finished search leaves no snapshot behind (the next run starts from the beginning). */
export function dropCheckpoint(file: string) {
  if (existsSync(file)) unlinkSync(file);
}
