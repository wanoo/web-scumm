import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { isPrivateDistFile } from '../scripts/spoiler-path';

describe('spoiler output paths', () => {
  const dist = join('/private', 'tmp', 'web-scumm', 'dist');

  it('does not treat a private parent directory as leaked output', () => {
    expect(isPrivateDistFile(dist, join(dist, 'assets', 'game.js'))).toBe(false);
  });

  it('rejects private folders and ending configuration below dist', () => {
    expect(isPrivateDistFile(dist, join(dist, 'private', 'answer.json'))).toBe(true);
    expect(isPrivateDistFile(dist, join(dist, 'data', 'ending.config.js'))).toBe(true);
    expect(isPrivateDistFile(dist, join(dist, 'data', 'reveal.config.json'))).toBe(true);
  });
});
