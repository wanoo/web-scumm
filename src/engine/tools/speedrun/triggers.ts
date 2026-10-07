// Semantic triggers (4.1.14 "Time Attack"): a category's start and finish, a split's moment. A trigger matches the first
// event of its kind whose named fields are equal; the fields it does not name match anything. Read from the semantic
// journal (core/journal.ts), never from the screen.
import type { SemanticInput } from '../../core/journal';
import type { SemanticTrigger, Value } from '../../core/types';

const FIELDS = ['room', 'item', 'flag', 'objective', 'ending', 'player', 'session'] as const;

/** Whether an event (with or without its `seq`) is what the trigger waits for. */
export function matches(t: SemanticTrigger, e: SemanticInput): boolean {
  if (e.kind !== t.event) return false;
  const rec = e as unknown as Record<string, unknown>;
  for (const f of FIELDS) if (t[f] !== undefined && rec[f] !== t[f]) return false;
  if (t.value !== undefined && !sameValue(rec.value as Value | null, t.value)) return false;
  return true;
}

const sameValue = (a: Value | null | undefined, b: Value) => a === b;

/** A trigger in a few words (the Studio, the overlay, a verdict's reason). */
export function describeTrigger(t: SemanticTrigger): string {
  const parts = FIELDS.filter((f) => t[f] !== undefined).map((f) => `${f}=${t[f]}`);
  if (t.value !== undefined) parts.push(`value=${JSON.stringify(t.value)}`);
  return parts.length ? `${t.event} (${parts.join(', ')})` : t.event;
}
