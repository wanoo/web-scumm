// Routes (4.1.14 "Time Attack"): a sequence of inputs with the splits it reaches, exported and imported as `.wsroute`
// (JSON). A human route comes from a run; a **logical route** comes from the solver's witness (`SolveResult.steps`) and
// is never a record: it has no time a player made, only the logical time a replay gives it. Two routes compare by
// their actions (where they first differ), their final states and their splits.
import type { SessionEntry } from '../../core/types';
import { canonicalJson } from '../../core/canonical';
import type { RecordedSplit } from './splits';

/** A route file. `kind: 'logical'` comes from the solver and is never shown as a record. @public */
export interface SpeedrunRoute {
  format: 'web-scumm-route';
  schema: 1;
  gameId: string;
  categoryId?: string;
  name: string;
  kind: 'human' | 'logical';
  notes?: string;
  /** The inputs, as session entries (a new game first). */
  steps: SessionEntry[];
  /** The splits a replay of it reached (the logical times only: a route has no RTA). */
  splits?: RecordedSplit[];
  /** Its total logical time and steps when replayed (microticks, decimal). */
  logicalTime?: string;
  logicalSteps?: string;
}

const FIELDS = ['act', 'travel', 'switch', 'map', 'step', 'script', 'enter', 'start', 'external'];

/** Only what a replay needs of an entry: the input and its answers (no digest, no time, no `ran`). */
function inputOf(e: SessionEntry): SessionEntry {
  const out: Record<string, unknown> = {};
  for (const k of [...FIELDS, 'picks', 'maps', 'rnd', 'skipAt', 'aborted'])
    if ((e as Record<string, unknown>)[k] !== undefined) out[k] = (e as Record<string, unknown>)[k];
  return out as SessionEntry;
}

/** A route from a run's entries (a human route). */
export function routeFromRun(o: {
  gameId: string;
  categoryId?: string;
  name: string;
  steps: readonly SessionEntry[];
  splits?: RecordedSplit[];
  notes?: string;
}): SpeedrunRoute {
  return {
    format: 'web-scumm-route',
    schema: 1,
    gameId: o.gameId,
    ...(o.categoryId ? { categoryId: o.categoryId } : {}),
    name: o.name,
    kind: 'human',
    ...(o.notes ? { notes: o.notes } : {}),
    steps: o.steps.map(inputOf),
    ...(o.splits ? { splits: o.splits } : {}),
  };
}

/** The solver's witness as a logical route: never a record (`kind: 'logical'`). */
export function routeFromWitness(gameId: string, steps: readonly SessionEntry[], name = 'Solver route'): SpeedrunRoute {
  return { format: 'web-scumm-route', schema: 1, gameId, name, kind: 'logical', steps: steps.map(inputOf) };
}

/** A route as the text of its file (canonical JSON: the same route is the same bytes). */
export function exportRoute(r: SpeedrunRoute): string {
  return canonicalJson(r);
}

/** Reads a route file and checks its shape; a route that claims more than it is (a logical route's record) is refused. */
export function parseRoute(text: string): SpeedrunRoute {
  const j = JSON.parse(text) as Partial<SpeedrunRoute>;
  if (j.format !== 'web-scumm-route' || j.schema !== 1) throw new Error('not a web-scumm route (format, schema 1)');
  if (typeof j.gameId !== 'string' || typeof j.name !== 'string') throw new Error('a route names its game and itself');
  if (j.kind !== 'human' && j.kind !== 'logical') throw new Error('a route is human or logical');
  if (!Array.isArray(j.steps) || !j.steps.every((s) => s && typeof s === 'object' && FIELDS.some((f) => f in s)))
    throw new Error('a route lists its steps as session entries');
  return {
    format: 'web-scumm-route',
    schema: 1,
    gameId: j.gameId,
    ...(typeof j.categoryId === 'string' ? { categoryId: j.categoryId } : {}),
    name: j.name,
    kind: j.kind,
    ...(typeof j.notes === 'string' ? { notes: j.notes } : {}),
    steps: j.steps.map(inputOf),
    ...(Array.isArray(j.splits) ? { splits: j.splits } : {}),
    ...(typeof j.logicalTime === 'string' ? { logicalTime: j.logicalTime } : {}),
    ...(typeof j.logicalSteps === 'string' ? { logicalSteps: j.logicalSteps } : {}),
  };
}

/** What separates two routes: the first step where they differ, their lengths, and the splits' deltas (b − a). */
export interface RouteComparison {
  firstDifference: number | null;
  steps: [number, number];
  logicalTime: [string | null, string | null];
  splits: { id: string; a: string | null; b: string | null; delta: string | null }[];
}

export function compareRoutes(a: SpeedrunRoute, b: SpeedrunRoute): RouteComparison {
  const n = Math.max(a.steps.length, b.steps.length);
  let first: number | null = null;
  for (let i = 0; i < n; i++) {
    const x = a.steps[i];
    const y = b.steps[i];
    if (!x || !y || canonicalJson(inputOf(x)) !== canonicalJson(inputOf(y))) {
      first = i;
      break;
    }
  }
  const ids = [...new Set([...(a.splits ?? []), ...(b.splits ?? [])].map((s) => s.id))];
  return {
    firstDifference: first,
    steps: [a.steps.length, b.steps.length],
    logicalTime: [a.logicalTime ?? null, b.logicalTime ?? null],
    splits: ids.map((id) => {
      const x = a.splits?.find((s) => s.id === id)?.logicalTime ?? null;
      const y = b.splits?.find((s) => s.id === id)?.logicalTime ?? null;
      return { id, a: x, b: y, delta: x !== null && y !== null ? (BigInt(y) - BigInt(x)).toString() : null };
    }),
  };
}
