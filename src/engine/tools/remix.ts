// What the Remix tools compute (4.1.15, ADR 0018, D25): the instances of a mode (a catalogue's every one, a
// generator's sample of seeds), a variant built from an assignment, the coverage of a set of variants (per dimension,
// per pair of dimensions, values never chosen, dominant anchors), and the readable description `npm run remix --
// --preview` and the Studio print. Pure: `tools/remix.ts`, `tools/verify-variants.ts`, the Studio and the tests call it.
import { canonicalJson } from '../core/canonical';
import { type CompiledManifest, catalogue, compileVariant, type WorldVariant } from '../core/remix/compile';
import { compileGameManifest, textIn } from '../core/remix/apply';
import { REMIX_ALGORITHM, REMIX_ALGORITHM_VERSION } from '../core/remix/manifest';
import { encodeSeedCode } from '../core/remix/seed-code';
import { sha256HexSync } from '../core/remix/sha256';
import { condFlags } from '../core/cond';
import type { Cmd, Cond, GameDef } from '../core/types';

/** A variant made from a catalogue's assignment (no seed: its `seed` names the catalogue entry). */
export function variantOf(
  c: CompiledManifest,
  mode: string,
  index: number,
  logical: Record<string, unknown>,
): WorldVariant {
  const assignments = Object.fromEntries(
    c.order.map((id) => [id, id in logical ? logical[id] : c.dims.get(id)!.story]),
  );
  const body = {
    seed: `catalogue:${mode}:${index}`,
    algorithm: REMIX_ALGORITHM,
    algorithmVersion: REMIX_ALGORITHM_VERSION,
    manifestHash: c.hash,
    mode,
    assignments,
  };
  return { ...body, hash: sha256HexSync(canonicalJson(body)) };
}

/** The n-th seed of the published sample (deterministic: the same sample on every machine). */
export const sampleSeed = (i: number): string => encodeSeedCode((i * 2654435761 + 12345) % 2 ** 35);

/**
 * The instances a mode is verified on: a catalogue's every logical world, a generator's `sample` seeds (D25: a
 * generator is never said to be proved beyond its sample).
 */
export function instancesOf(
  game: GameDef,
  modeId: string,
  sample = 50,
): { variants: WorldVariant[]; exhaustive: boolean } {
  const c = compileGameManifest(game);
  const mode = c.modes.get(modeId);
  if (!mode) throw new Error(`unknown mode "${modeId}"`);
  if (mode.strategy === 'catalogue')
    return { variants: catalogue(c, modeId).map((a, i) => variantOf(c, modeId, i, a)), exhaustive: true };
  return {
    variants: Array.from({ length: sample }, (_, i) =>
      compileVariant(c, game.remix!, sampleSeed(i), REMIX_ALGORITHM_VERSION, modeId),
    ),
    exhaustive: false,
  };
}

/** Coverage of a set of variants: how often each value was chosen, per dimension and per pair; the gaps; the bias. */
export interface Coverage {
  count: number;
  perDimension: Record<string, Record<string, number>>;
  /** `a|b` → `valueA|valueB` → count, over the logical dimensions that vary. */
  perPair: Record<string, Record<string, number>>;
  neverChosen: { dimension: string; value: string }[];
  /** A value chosen more than twice as often as a uniform draw would (a dominant anchor, a lopsided order). */
  dominant: { dimension: string; value: string; share: number }[];
}

const label = (v: unknown) => (Array.isArray(v) ? v.join('>') : String(v));

export function coverage(
  c: CompiledManifest,
  modeId: string,
  variants: readonly WorldVariant[],
  o: { logicalOnly?: boolean } = {},
): Coverage {
  const mode = c.modes.get(modeId);
  const varying = (mode?.dimensions ?? []).filter(
    (id) => c.dims.has(id) && (!o.logicalOnly || c.dims.get(id)!.dim.logical),
  );
  const perDimension: Coverage['perDimension'] = {};
  const perPair: Coverage['perPair'] = {};
  for (const id of varying) perDimension[id] = Object.fromEntries(c.dims.get(id)!.domain.map((v) => [label(v), 0]));
  for (const v of variants) {
    for (const id of varying) {
      const k = label(v.assignments[id]);
      perDimension[id]![k] = (perDimension[id]![k] ?? 0) + 1;
    }
    for (let i = 0; i < varying.length; i++)
      for (let j = i + 1; j < varying.length; j++) {
        const a = varying[i]!;
        const b = varying[j]!;
        const t = (perPair[`${a}|${b}`] ??= {});
        const k = `${label(v.assignments[a])}|${label(v.assignments[b])}`;
        t[k] = (t[k] ?? 0) + 1;
      }
  }
  const neverChosen: Coverage['neverChosen'] = [];
  const dominant: Coverage['dominant'] = [];
  for (const id of varying) {
    const counts = perDimension[id]!;
    const n = Object.keys(counts).length;
    for (const [value, k] of Object.entries(counts)) {
      if (!k) neverChosen.push({ dimension: id, value });
      const share = variants.length ? k / variants.length : 0;
      if (n > 1 && variants.length >= 4 * n && share > 2 / n) dominant.push({ dimension: id, value, share });
    }
  }
  return { count: variants.length, perDimension, perPair, neverChosen, dominant };
}

/** What `count` seeds of a mode draw (the `sampleSeed` sequence): the distribution a player meets. */
export function seedDraws(game: GameDef, modeId: string, count: number): WorldVariant[] {
  const c = compileGameManifest(game);
  return Array.from({ length: count }, (_, i) =>
    compileVariant(c, game.remix!, sampleSeed(10_000 + i), REMIX_ALGORITHM_VERSION, modeId),
  );
}

/** A variant as lines a person reads: each dimension, its value (an anchor, a room, a hint and its answer, an order). */
export function describeVariant(game: GameDef, v: WorldVariant, lang?: string): string[] {
  const c = compileGameManifest(game);
  const lines = [
    `seed ${v.seed} · mode ${v.mode} · ${v.algorithm} v${v.algorithmVersion} · world ${v.hash.slice(0, 12)}`,
  ];
  for (const id of c.order) {
    const d = c.dims.get(id)!.dim;
    const value = v.assignments[id];
    const story = canonicalJson(value) === canonicalJson(c.dims.get(id)!.story) ? ' (story)' : '';
    let text = label(value);
    if (d.kind === 'coupled') {
      const p = d.pairs[value as number]!;
      text = `"${textIn(p.hint, lang ?? game.lang)}" ↔ ${p.answer}`;
    } else if (d.kind === 'presentation') text = `#${value} ${JSON.stringify(d.values[value as number]).slice(0, 60)}`;
    lines.push(`  ${id} [${d.kind}]: ${text}${story}`);
  }
  return lines;
}

/**
 * What every world must also reach, beyond the ending and the objectives: the flags a coupled answer sets (the `then`
 * of an `if` that reads a coupled dimension's reserved flag) and the flags a code wheel's `then` sets. So an optional
 * puzzle of Remix is proved solvable in each world, the answer its hint names included.
 */
export function remixGoals(game: GameDef): Cond[] {
  const coupled = new Set(
    (game.remix?.dimensions ?? []).filter((d) => d.kind === 'coupled').map((d) => `remix.${d.id}`),
  );
  const out = new Set<string>();
  const sets = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const c of list as Cmd[]) {
      const set = c && typeof c === 'object' && 'set' in c ? (c as { set: unknown }).set : undefined;
      if (typeof set === 'string' && !set.startsWith('!')) out.add(set);
    }
  };
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if ('if' in o && 'then' in o && [...condFlags(o.if as Cond)].some((f) => coupled.has(f))) sets(o.then);
      if (o.minigame === 'code-wheel') sets(o.then);
      Object.values(o).forEach(walk);
    }
  };
  walk(game.rooms);
  walk(game.rules);
  return [...out].sort();
}
