// A game carries no server code (4.1.9, D19, plan §5): nothing of the engine, the Studio or a game imports the
// connectors or the Bridge, and a build in dist/ (when one is there: `npm run build`, CI's build step) holds none of
// the strings only server code carries (tools/server-code.ts; tools/dist.ts fails a build that does).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_MARKERS, serverMarkers } from '../tools/server-code';

const files = (d: string, re: RegExp): string[] =>
  existsSync(d)
    ? readdirSync(d).flatMap((e) => {
        const p = join(d, e);
        return statSync(p).isDirectory() ? (e === 'node_modules' ? [] : files(p, re)) : re.test(e) ? [p] : [];
      })
    : [];

describe('a game carries no server code', () => {
  it('no source of the engine, the Studio or a game imports connectors/, bridge/, ssh2 or imapflow', () => {
    const offenders = [...files('src', /\.tsx?$/), ...files('games', /\.ts$/)].flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/(?:from|import\(?)\s*'([^']+)'/g)]
        .map((m) => m[1]!)
        .filter((s) => /(^|\/)(connectors|bridge)\/|^(ssh2|imapflow)$/.test(s))
        .map((s) => `${f} → ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it('knows the markers it looks for', () => {
    expect(serverMarkers('import x from "ssh2"; // connectors/src/sdk.ts')).toEqual(['connectors/', 'ssh2']);
    expect(serverMarkers('function play(){return 1}')).toEqual([]);
    expect(SERVER_MARKERS).toEqual(expect.arrayContaining(['connectors/', 'ssh2', 'imapflow']));
  });

  it.skipIf(!existsSync('dist/index.html'))('the build in dist/ holds none of them', () => {
    const hits = files('dist', /\.(m?js|html)$/).flatMap((f) =>
      serverMarkers(readFileSync(f, 'utf8')).map((m) => `${f}: ${m}`),
    );
    expect(hits).toEqual([]);
  });
});
