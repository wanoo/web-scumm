// The persistent proof cache: a solver run is a pure function of the engine's code, the game (its content, layouts and
// custom commands, functions included as their source, and the game folder's sources for what those import) and the
// options. Its result is kept in .cache/proofs/<key>.json
// and given back as is when nothing of that changed: the build, `verify:game`, `prove:game`, `lint`, `weight` and the
// e2e ask the same questions. `PROOF_CACHE=0` (or `--no-cache` on `npm run solve`) turns it off; tests never use it.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameDef, Layout } from '../src/engine/core/types';
import { canonicalJson } from '../src/engine/core/canonical';
import { solve, type SolveOptions, type SolveResult } from '../src/engine/tools/solve';
import { GAME_DIR, ROOT, WORK } from './game';

/** Where the results go (`PROOF_CACHE_DIR` to put them elsewhere). */
export const cacheDir = () =>
  process.env.PROOF_CACHE_DIR?.trim() ? resolve(process.env.PROOF_CACHE_DIR.trim()) : resolve(WORK, '.cache', 'proofs');
/** Files kept: the oldest go first. */
const KEEP = 300;

/**
 * The canonical text of a question (core/canonical.ts, 4.1.12): functions as their source, a non-finite number by
 * its name (`maxStates: Infinity`), undefined dropped, the rest as `canonicalJson` writes it. Equal inputs give equal
 * text, in any key order.
 */
export function stableJson(v: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (x: unknown): unknown => {
    if (typeof x === 'function') return `fn:${x.toString()}`;
    if (typeof x === 'number' && !Number.isFinite(x)) return `num:${x}`;
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) throw new Error('stableJson: a cycle');
    seen.add(x);
    const out = Array.isArray(x)
      ? x.map(walk)
      : Object.fromEntries(
          Object.entries(x)
            .filter(([, y]) => y !== undefined)
            .map(([k, y]) => [k, walk(y)]),
        );
    seen.delete(x);
    return out;
  };
  return canonicalJson(walk(v));
}

let engine: string | null = null;
/** A fingerprint of the engine's sources (src/engine): any change to the engine or the solver invalidates every entry. */
export function engineHash(): string {
  if (engine) return engine;
  const h = createHash('sha256');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|json)$/.test(e)) files.push(p);
    }
  };
  walk(resolve(ROOT, 'src', 'engine'));
  for (const f of files) h.update(f.slice(ROOT.length)).update('\0').update(readFileSync(f)).update('\0');
  return (engine = h.digest('hex'));
}

let gameSrc: string | null = null;
/**
 * A fingerprint of the game folder's sources (.ts, .json, .mjs; not its art, audio or private files): a custom
 * command's function is keyed by its source text, which does not show the constants it imports from elsewhere.
 */
export function gameSourceHash(dir = GAME_DIR): string {
  if (gameSrc) return gameSrc;
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) {
        if (!['art', 'audio', 'private', 'node_modules', 'playtests'].includes(e)) walk(p);
      } else if (/\.(ts|json|mjs)$/.test(e))
        h.update(p.slice(dir.length)).update('\0').update(readFileSync(p)).update('\0');
    }
  };
  if (existsSync(dir)) walk(dir);
  return (gameSrc = h.digest('hex'));
}

export const cacheOn = () => process.env.PROOF_CACHE !== '0' && !process.argv.includes('--no-cache');

/** The options as the solver reads them: an option left out and the same option at its default are one question. */
// With workers, the result depends on the batch, never on how many workers expanded it (solve-pool.ts): the key keeps
// the batch and drops the count and the module path.
const normal = (o: SolveOptions): SolveOptions => {
  const { workers, gameModule, batch, ...rest } = o;
  void gameModule;
  return {
    maxStates: 20000,
    mode: 'witness',
    start: 'new',
    por: false,
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    ...(workers !== undefined ? { batch: batch ?? 64 } : {}),
  };
};

/** The key of one run. */
export function proofKey(game: GameDef, layouts: Record<string, Layout>, opts: SolveOptions): string {
  return createHash('sha256')
    .update(engineHash())
    .update('\0')
    .update(gameSourceHash())
    .update('\0')
    .update(stableJson({ game, layouts, opts: normal(opts) }))
    .digest('hex');
}

export type Cached = SolveResult & { cached?: string };

/** `solve`, through the cache: a hit is the earlier result with `cached` set to its key (the printed outputs say so). */
export async function cachedSolve(
  game: GameDef,
  layouts: Record<string, Layout>,
  opts: SolveOptions = {},
): Promise<Cached> {
  // A search stopped by the clock is not a verdict to keep (the next one may get further).
  if (!cacheOn() || opts.timeLimitMs) return solve(game, layouts, opts);
  const key = proofKey(game, layouts, opts);
  const dir = cacheDir();
  const file = join(dir, `${key}.json`);
  if (existsSync(file)) {
    try {
      return { ...(JSON.parse(readFileSync(file, 'utf8')) as SolveResult), cached: key.slice(0, 12) };
    } catch {
      /* a torn file: solve again */
    }
  }
  const r = await solve(game, layouts, opts);
  // An engine error is not a verdict worth keeping (a flaky host, a bug fixed outside src/engine).
  if (r.status !== 'error') {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(r));
    renameSync(tmp, file);
    prune(dir);
  }
  return r;
}

function prune(dir: string) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP)) {
    try {
      unlinkSync(join(dir, f));
    } catch {
      /* raced */
    }
  }
}
