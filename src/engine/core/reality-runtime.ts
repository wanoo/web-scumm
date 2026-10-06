// Signals from the world outside (4.1.1, Reality Bridge): `receive` applies a verified signal at most once. The
// Bridge delivers at least once, in any order; the engine keeps, in the state it saves, the last sequence delivered
// without a gap (`cursor`) and the ids applied above it (`applied`). A delivery seen before is a no-op; a new one is a
// session entry like a tap, so a replay applies it offline, and its effect is the event of the same name
// (`events: [{ on: '<signal>' }]`), run once per game unless the signal says `once: false`.
// Part of the Engine (4.1.1): its method `receive` forwards here.
import type { Engine } from './engine';
import type { ExternalEntry, RealityState, SessionEntry } from './types';

/** How many ids may wait above the cursor (deliveries out of order): beyond, a delivery is refused, never dropped silently. */
export const MAX_PENDING = 1024;

export type ReceiveResult = 'applied' | 'duplicate' | 'busy' | 'unknown' | 'overflow';

/** Moves the cursor over the sequences now contiguous, and forgets their ids. */
export function compact(st: RealityState): void {
  for (;;) {
    const next = Object.entries(st.applied).find(([, seq]) => seq === st.cursor + 1);
    if (!next) return;
    st.cursor++;
    delete st.applied[next[0]];
  }
}

/** Whether this delivery was applied already (below the cursor, or an id seen above it). */
export const seenBefore = (st: RealityState | undefined, x: Pick<ExternalEntry, 'id' | 'sequence'>): boolean =>
  !!st && (x.sequence <= st.cursor || st.applied[x.id] !== undefined);

export async function receive(eng: Engine, x: ExternalEntry): Promise<ReceiveResult> {
  const def = eng.game.reality?.signals.find((s) => s.id === x.signal);
  if (!def && !x.skipped) return 'unknown';
  if (seenBefore(eng.state.reality, x)) return 'duplicate';
  if (eng.busy) return 'busy';
  const st: RealityState = (eng.state.reality ??= { cursor: 0, applied: {} });
  if (Object.keys(st.applied).length >= MAX_PENDING) return 'overflow';
  const entry: SessionEntry = { external: { ...x } };
  eng.begin(entry);
  try {
    await eng.run(async () => {
      st.applied[x.id] = x.sequence;
      compact(st);
      eng.writes?.add('reality');
      if (x.skipped || !def) return;
      const once = `reality.${x.signal}`;
      if (def.once !== false) {
        eng.reads?.add(`seen:${once}`);
        if (eng.state.seen[once]) return;
        eng.state.seen[once] = 1;
        eng.writes?.add(`seen:${once}`);
      }
      await eng.emit(x.signal, { room: eng.room(), fast: false });
    });
  } finally {
    eng.end();
  }
  return 'applied';
}
