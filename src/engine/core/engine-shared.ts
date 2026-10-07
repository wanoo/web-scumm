// What the engine's modules share (4.1.0 "Clarity"): the context of a running command, the journal's entry, the
// source of a response, and small helpers. engine.ts re-exports the public ones.
import type { CondAtom } from './cond';
import { NEAR } from './define';
import { must } from './must';
import type { Cmd, Id, Point, RoomDef } from './types';

/** Where the response to an action comes from: useful to the solver (only written rules move things forward). */
export type Source = 'rule' | 'look' | 'talk' | 'hint' | 'kind' | 'refuse' | 'fallback' | 'guide';

/** One line of the engine's journal (`Engine.trace`, kept when `traceOn`). */
export interface TraceEntry {
  t: number;
  kind: 'action' | 'event' | 'script' | 'actor' | 'player';
  text: string;
  room: Id;
}

/** A short name for a command, for the journal. */
export function describeCmd(c: Cmd): string {
  if (typeof c === 'string') return `"${c.length > 24 ? c.slice(0, 24) + '…' : c}"`;
  const k = must(Object.keys(c)[0], 'command key'); // a command object is one key
  const v = (c as Record<string, unknown>)[k];
  return `${k}${typeof v === 'string' ? ` ${v}` : Array.isArray(v) && v.every((x) => typeof x === 'string') ? ` ${v.join(' ')}` : typeof v === 'number' ? ` ${v}` : ''}`;
}

export interface Ctx {
  room: RoomDef;
  fast: boolean;
}

export const HERO = 'hero';

/**
 * A session holds at most this many entries: the next input starts a new one from the current state
 * (`Engine.SESSION_MAX`). Since 4.1.14 (ADR 0016) it is also the size of a run's journal chunk
 * (`core/journal-chunks.ts`): a long run is many chunks chained by their hashes, never one unbounded session.
 */
export const SESSION_MAX = 500;

export const near = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= NEAR;

/** A condition atom as `kind:id` (`Engine.reads`). */
export const atomKey = (a: CondAtom) => `${a.kind}:${a.id}`;
