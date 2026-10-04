import { relative } from 'node:path';

/** True when a file below dist/ exposes private source material or an unsealed ending configuration. */
export function isPrivateDistFile(dist: string, file: string): boolean {
  const parts = relative(dist, file).split(/[\\/]/);
  return parts.includes('private') || parts.some((part) => /(?:reveal|ending)\.config/.test(part));
}
