// web-scumm migrate and a project's tsconfig (4.1.8): `baseUrl: "."` out, every path relative, nothing else moved;
// a hand-written root or a file already without baseUrl is left alone.
import { describe, expect, it } from 'vitest';
import { tsconfigWithoutBaseUrl } from '../tools/migrate-tsconfig';

describe('a project tsconfig for TypeScript 7', () => {
  it('drops baseUrl "." and makes the paths relative', () => {
    const before = {
      compilerOptions: {
        strict: true,
        baseUrl: '.',
        paths: {
          '@engine/*': ['node_modules/web-scumm/src/engine/*'],
          'web-scumm/*': ['node_modules/web-scumm/src/engine/api/*'],
          '@game': ['game/index.ts'],
          '@game/*': ['./game/*', '/abs/game/*'],
        },
      },
      include: ['game'],
    };
    const after = JSON.parse(tsconfigWithoutBaseUrl(JSON.stringify(before))!) as typeof before;
    expect(after.compilerOptions.baseUrl).toBeUndefined();
    expect(after.compilerOptions.paths).toEqual({
      '@engine/*': ['./node_modules/web-scumm/src/engine/*'],
      'web-scumm/*': ['./node_modules/web-scumm/src/engine/api/*'],
      '@game': ['./game/index.ts'],
      '@game/*': ['./game/*', '/abs/game/*'],
    });
    expect(after.compilerOptions.strict).toBe(true);
    expect(after.include).toEqual(['game']);
  });

  it('leaves alone a file without baseUrl, and one whose root is not the file itself', () => {
    expect(tsconfigWithoutBaseUrl(JSON.stringify({ compilerOptions: { paths: { a: ['b'] } } }))).toBeNull();
    expect(
      tsconfigWithoutBaseUrl(JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { a: ['b'] } } })),
    ).toBeNull();
    expect(tsconfigWithoutBaseUrl('{}')).toBeNull();
  });

  it('reads comments and trailing commas as TypeScript does, and refuses what is not a tsconfig at all', () => {
    const jsonc = `{\n  // the project's own\n  "compilerOptions": { "baseUrl": ".", "paths": { "@game": ["game/index.ts"], }, },\n}\n`;
    const after = JSON.parse(tsconfigWithoutBaseUrl(jsonc)!) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    expect(after.compilerOptions.paths).toEqual({ '@game': ['./game/index.ts'] });
    expect(tsconfigWithoutBaseUrl('not json at all')).toBeNull();
  });
});
