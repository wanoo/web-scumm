// The Studio's Remix tab, its model (4.1.15, ADR 0018, programme §11.9): everything the view shows, computed from the
// game's IR (`ir.world.remix`, `ir.rooms[].anchors`) with the engine's own compiler, so the Studio never draws a world
// the player would not. Preview a seed; lock some dimensions and reroll the others; compare two worlds; the coverage
// and bias of a mode over many seeds; the anchors of each room and what uses them; the order of a puzzle-order
// dimension as a graph; a frozen world to export (JSON and a link the player opens). Pure (no DOM).
import { canonicalJson } from '@engine/core/canonical';
import type { GameIR } from '@engine/core/ir';
import {
  type CompiledManifest,
  compileManifest,
  compileVariant,
  RemixManifestError,
  violations,
  type WorldVariant,
} from '@engine/core/remix/compile';
import { REMIX_ALGORITHM, REMIX_ALGORITHM_VERSION, type VariationManifest } from '@engine/core/remix/manifest';
import { encodeSeedCode, normalizeSeed } from '@engine/core/remix/seed-code';
import { sha256HexSync } from '@engine/core/remix/sha256';

/** One dimension as the tab lists it: its kind, whether it reaches the solver, its domain, its story value. */
export interface DimensionRow {
  id: string;
  kind: string;
  logical: boolean;
  domain: string[];
  story: string;
  modes: string[];
}

/** A dimension's value as text: an anchor key, a room, a route, a pair's answer, an order `a > b`, a line's number. */
function valueLabel(c: CompiledManifest, id: string, v: unknown): string {
  const d = c.dims.get(id)?.dim;
  if (d?.kind === 'coupled') return `${v} (${d.pairs[v as number]?.answer})`;
  if (Array.isArray(v)) return v.join(' > ');
  return String(v);
}

export class RemixModel {
  readonly manifest: VariationManifest | undefined;
  readonly compiled: CompiledManifest | undefined;
  /** Why the manifest cannot make a world (build errors), empty when it can. */
  readonly problems: readonly string[];

  constructor(readonly ir: GameIR) {
    this.manifest = ir.world.remix;
    let compiled: CompiledManifest | undefined;
    let problems: string[] = [];
    if (this.manifest)
      try {
        compiled = compileManifest(this.manifest, ir);
      } catch (e) {
        problems = e instanceof RemixManifestError ? [...e.problems] : [(e as Error).message];
      }
    this.compiled = compiled;
    this.problems = problems;
  }

  get modes(): string[] {
    return (this.manifest?.modes ?? []).map((m) => m.id);
  }

  dimensions(): DimensionRow[] {
    const c = this.compiled;
    if (!c) return [];
    return c.order.map((id) => {
      const { dim, domain, story } = c.dims.get(id)!;
      return {
        id,
        kind: dim.kind,
        logical: dim.logical,
        domain: domain.map((v) => valueLabel(c, id, v)),
        story: valueLabel(c, id, story),
        modes: (this.manifest?.modes ?? []).filter((m) => m.dimensions.includes(id)).map((m) => m.id),
      };
    });
  }

  /** The world of a seed in a mode (an explicit error for a malformed seed). */
  preview(seed: string, mode = 'remix'): WorldVariant {
    return compileVariant(this.compiled!, this.manifest!, seed, REMIX_ALGORITHM_VERSION, mode);
  }

  /**
   * Locks some dimensions at a world's values and rerolls the others: the first of `tries` seeds after `from` whose
   * world agrees with the locks (the engine's generator, never a hand-made assignment).
   */
  reroll(locked: Readonly<Record<string, unknown>>, mode = 'remix', from = 0, tries = 2000): WorldVariant | undefined {
    for (let i = 1; i <= tries; i++) {
      const v = this.preview(encodeSeedCode((from + i * 2654435761) % 2 ** 35), mode);
      if (Object.entries(locked).every(([k, x]) => canonicalJson(v.assignments[k]) === canonicalJson(x))) return v;
    }
    return undefined;
  }

  /** Two worlds side by side: each dimension with both values, and whether they differ. */
  compare(a: WorldVariant, b: WorldVariant): { id: string; a: string; b: string; differs: boolean }[] {
    const c = this.compiled!;
    return c.order.map((id) => ({
      id,
      a: valueLabel(c, id, a.assignments[id]),
      b: valueLabel(c, id, b.assignments[id]),
      differs: canonicalJson(a.assignments[id]) !== canonicalJson(b.assignments[id]),
    }));
  }

  /** How often each value comes out of `count` seeds: the never-chosen ones and the dominant ones. */
  coverage(
    mode = 'remix',
    count = 500,
  ): { id: string; counts: Record<string, number>; never: string[]; dominant: string[] }[] {
    const c = this.compiled!;
    const m = this.manifest!.modes.find((x) => x.id === mode);
    const ids = (m?.dimensions ?? []).filter((id) => c.dims.has(id));
    const counts = Object.fromEntries(
      ids.map((id) => [id, Object.fromEntries(c.dims.get(id)!.domain.map((v) => [valueLabel(c, id, v), 0]))]),
    );
    for (let i = 0; i < count; i++) {
      const v = this.preview(encodeSeedCode((i * 2654435761 + 7) % 2 ** 35), mode);
      for (const id of ids) counts[id]![valueLabel(c, id, v.assignments[id])]! += 1;
    }
    return ids.map((id) => {
      const k = counts[id]!;
      const n = Object.keys(k).length;
      return {
        id,
        counts: k,
        never: Object.entries(k)
          .filter(([, x]) => !x)
          .map(([v]) => v),
        dominant: Object.entries(k)
          .filter(([, x]) => n > 1 && x / count > 2 / n)
          .map(([v]) => v),
      };
    });
  }

  /** The anchors of every room, with the item-placement dimensions that use each one. */
  anchors(): { room: string; anchor: string; at: string; phase?: string; usedBy: string[] }[] {
    const uses = (key: string) =>
      (this.manifest?.dimensions ?? [])
        .filter((d) => d.kind === 'item-placement' && d.anchors.some((a) => `${a.room}.${a.anchor}` === key))
        .map((d) => d.id);
    return this.ir.rooms.flatMap((r) =>
      Object.entries(r.anchors ?? {}).map(([anchor, a]) => ({
        room: r.id,
        anchor,
        at: a.at,
        phase: a.phase,
        usedBy: uses(`${r.id}.${anchor}`),
      })),
    );
  }

  /** A puzzle-order dimension in a world: its groups in order, and the edges the author declared. */
  order(id: string, v: WorldVariant): { groups: string[]; edges: [string, string][] } | undefined {
    const d = this.compiled?.dims.get(id)?.dim;
    if (d?.kind !== 'puzzle-order') return undefined;
    return { groups: v.assignments[id] as string[], edges: d.graph.map(([a, b]) => [a, b] as [string, string]) };
  }

  /** A world's constraints, checked again (the Studio says it when a hand-locked world breaks one). */
  broken(v: WorldVariant): string[] {
    return this.compiled ? violations(this.compiled, v.assignments) : [];
  }
}

/** A world frozen for a bug report or a playtest: the file's name and its JSON. */
export function exportWorld(gameId: string, v: WorldVariant): { name: string; json: string } {
  return {
    name: `${gameId}-world-${v.seed.replace(/[^\w-]/g, '_')}-${v.hash.slice(0, 8)}.json`,
    json: `${JSON.stringify(v, null, 1)}\n`,
  };
}

/** Whether a stored file is a world of this manifest (format and hash), before the Studio offers to play it. */
export function isWorld(x: unknown, manifestHash: string): x is WorldVariant {
  if (!x || typeof x !== 'object') return false;
  const v = x as WorldVariant;
  if (v.algorithm !== REMIX_ALGORITHM || typeof v.hash !== 'string') return false;
  const { hash, ...body } = v;
  return sha256HexSync(canonicalJson(body)) === hash && v.manifestHash === manifestHash;
}

/** A typed seed normalised, or the reason it is refused. */
export function readSeed(text: string): { seed: string } | { error: string } {
  try {
    return { seed: normalizeSeed(text) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
