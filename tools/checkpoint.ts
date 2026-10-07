// A search's checkpoint on disk (4.1.13, src/engine/tools/solve/search/checkpoint.ts): `npm run solve -- --prove
// --checkpoint=<file> [--checkpoint-every=<seconds>] [--resume]` and `npm run prove:matrix -- --checkpoint-dir=<dir>`.
// Written to a temporary file, then renamed: a search killed while writing leaves the previous snapshot whole.
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { SolveOptions } from '../src/engine/tools/solve';

export function fileCheckpoint(
  file: string,
  o: { resume?: boolean; everyMs?: number },
): NonNullable<SolveOptions['checkpoint']> {
  return {
    save(text) {
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, text);
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
