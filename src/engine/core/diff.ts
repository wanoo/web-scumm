// The logical state: what a replay must reproduce, without positions, camera and timestamps. A digest of it after every
// input tells where a replay diverges; a diff of it around a custom command tells whether `run` touched the state.
import type { GameState } from './types';

const sorted = <T>(o: Record<string, T> | undefined): [string, T][] => Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b));

/** The state without positions, camera and timestamps. */
export function logicalState(s: GameState) {
  return {
    room: s.room, inventory: [...s.inventory].sort(), flags: sorted(s.flags), props: sorted(s.props),
    visible: sorted(Object.fromEntries(Object.entries(s.actors).filter(([, a]) => a.visible !== undefined).map(([k, a]) => [k, a.visible!]))),
    unlocked: [...s.unlocked].sort(), visited: sorted(s.visited), counters: sorted(s.counters), seen: Object.keys(s.seen).sort(),
    used: [...(s.used ?? [])].sort(), where: sorted(s.where), scripts: sorted(s.scripts).map(([k, st]) => [k, st.step ?? st.pc, !!st.done, !!st.off] as const),
    active: s.active ?? '', players: sorted(s.players).map(([k, p]) => [k, p.room, [...p.inventory].sort(), [...(p.used ?? [])].sort()] as const), done: !!s.done,
  };
}

/** The logical state as flat `key = value` lines (`flags.door_open = true`). */
export function flatState(s: GameState): Record<string, string> {
  const L = logicalState(s);
  const out: Record<string, string> = { room: L.room, inventory: L.inventory.join(','), unlocked: L.unlocked.join(','), seen: L.seen.join(','), used: L.used.join(','), active: L.active, done: String(L.done) };
  for (const [k, v] of L.flags) out[`flags.${k}`] = JSON.stringify(v);
  for (const [k, v] of L.props) out[`props.${k}`] = v;
  for (const [k, v] of L.visible) out[`visible.${k}`] = String(v);
  for (const [k, v] of L.visited) out[`visited.${k}`] = String(v);
  for (const [k, v] of L.counters) out[`counters.${k}`] = String(v);
  for (const [k, v] of L.where) out[`where.${k}`] = v;
  for (const [k, pc, done, off] of L.scripts) out[`scripts.${k}`] = `${pc}${done ? ' done' : ''}${off ? ' off' : ''}`;
  for (const [k, room, inv, used] of L.players) out[`players.${k}`] = `${room} [${inv.join(',')}]${used.length ? ` used ${used.join(',')}` : ''}`;
  return out;
}

/** The keys whose value differs between two states (`flags.x`, `inventory`, `room`…). */
export function stateDiff(a: GameState, b: GameState): string[] {
  const A = flatState(a), B = flatState(b);
  return [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => A[k] !== B[k]).sort();
}

/** A short digest of the logical state (FNV-1a over its JSON). */
export function stateDigest(s: GameState): string {
  const str = JSON.stringify(logicalState(s));
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
