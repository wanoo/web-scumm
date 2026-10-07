// A game's sources as the IR and the fingerprint see them, read from disk (4.1.12, ADR 0013): its TypeScript files for
// the provenance of ids, and its trusted extension files (the code beside the content: custom commands, minigames,
// plugins) for the fingerprint's `trustedExtensions`. Node's own SHA-256 (`node:crypto`) gives the same hex as the
// player's WebCrypto (`hashSources`, core/fingerprint.ts), over the same canonical text. `sealBuild`
// (tools/vite/plugins.ts) and `npm run ir` both call `trustedExtensionsHash`.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { canonicalJson } from '../src/engine/core/canonical';
import { compileGame } from '../src/engine/core/define';
import { compileIR, type GameIR } from '../src/engine/core/ir';
import { ROOT, WORK, type GameModule } from './game';

/** Folders of a game that hold no code it runs (assets, data, tests, private files). */
const NOT_CODE = new Set([
  'art',
  'audio',
  'layout',
  'locales',
  'playtests',
  'private',
  'tests',
  'reality',
  'node_modules',
]);
/** The content files (data written with `define*`, AGENTS.md): logic, not trusted code. */
const CONTENT = new Set(['game.ts', 'cast.ts', 'items.ts', 'rules.ts']);

const walk = (dir: string, keep: (rel: string, name: string) => boolean): string[] => {
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if (!NOT_CODE.has(e)) go(p);
      } else if (keep(relative(dir, p).split('\\').join('/'), e)) out.push(p);
    }
  };
  if (existsSync(dir)) go(dir);
  return out;
};

/** The game's TypeScript sources, keyed by their path from the working directory (what provenance reports). */
export function gameSources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of walk(dir, (_r, name) => name.endsWith('.ts')))
    out[relative(WORK, p).split('\\').join('/')] = readFileSync(p, 'utf8');
  return out;
}

/**
 * The trusted extension files of a game, keyed by their path inside the game folder: every `.ts`, `.js` or `.mjs`
 * outside `rooms/` and the asset, data and test folders, but the four content files and what never ships (`e2e.mjs`,
 * `*.example.ts`). For the sample game: `index.ts`, where its custom command lives.
 */
export function extensionFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of walk(
    dir,
    (rel, name) =>
      /\.(ts|js|mjs)$/.test(name) &&
      !rel.startsWith('rooms/') &&
      !CONTENT.has(rel) &&
      rel !== 'e2e.mjs' &&
      !name.endsWith('.example.ts') &&
      !name.endsWith('.d.ts'),
  ))
    out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
  return out;
}

/** SHA-256 (hex) of the canonical text of a set of files: the same value `hashSources` computes with WebCrypto. */
export function sha256Files(files: Record<string, string>): string {
  return createHash('sha256').update(canonicalJson(files)).digest('hex');
}

/** The fingerprint's `trustedExtensions` of the game in `dir`. */
export function trustedExtensionsHash(dir: string): string {
  return sha256Files(extensionFiles(dir));
}

/** The engine's version (its package.json): the IR records it, the fingerprint's `engine` hashes it. */
export function engineVersion(): string {
  try {
    return String(JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

/** The IR of a loaded game module, with its provenance and its extensions' hash. */
export function gameIR(mod: GameModule, dir: string): GameIR {
  return compileIR(compileGame(mod.game), {
    extensions: {
      trusted: trustedExtensionsHash(dir),
      commands: mod.commands,
      minigames: Object.keys(mod.minigames ?? {}),
    },
    engine: engineVersion(),
    sources: gameSources(dir),
  });
}
