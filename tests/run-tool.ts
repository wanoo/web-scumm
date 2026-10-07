// Runs a repository tool as the command line does, without `npx` (4.1.8): `npx` is a `.cmd` on Windows and Node's
// spawn without a shell cannot run one, so the tests spawn tsx's own entry with this Node instead, the same on every
// system.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { createRequire } from 'node:module';

const tsx = createRequire(import.meta.url).resolve('tsx/cli');

/** `npx tsx <tool> …`, as a child of this Node; stdout and stderr as strings. */
export const runTool = (args: string[], o: Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'> = {}) =>
  spawnSync(process.execPath, [tsx, ...args], { encoding: 'utf8', ...o });
