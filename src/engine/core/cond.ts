import type { Cond, GameState, Id } from './types';

/** Evaluates a condition. `room` is used for `{ prop: [id, state] }` with no room prefix. */
export function check(c: Cond | undefined, s: GameState, room: Id = s.room): boolean {
  if (c === undefined) return true;
  if (typeof c === 'string') return c.startsWith('!') ? !s.flags[c.slice(1)] : !!s.flags[c];
  if ('has' in c) return s.inventory.includes(c.has);
  if ('flag' in c) {
    const v = s.flags[c.flag];
    if ('eq' in c && c.eq !== undefined) return v === c.eq;
    if (c.gte !== undefined) return typeof v === 'number' && v >= c.gte;
    if (c.lt !== undefined) return typeof v !== 'number' || v < c.lt;
    return !!v;
  }
  if ('not' in c) return !check(c.not, s, room);
  if ('all' in c) return c.all.every((x) => check(x, s, room));
  if ('any' in c) return c.any.some((x) => check(x, s, room));
  if ('visited' in c) return (s.visited[c.visited] ?? 0) > 0;
  if ('room' in c) return s.room === c.room;
  if ('prop' in c) {
    const [id, state] = c.prop;
    const key = id.includes('.') ? id : `${room}.${id}`;
    return s.props[key] === state;
  }
  if ('unlocked' in c) return s.unlocked.includes(c.unlocked);
  if ('seen' in c) return !!s.seen[c.seen];
  if ('actorIn' in c) return s.where?.[c.actorIn[0]] === c.actorIn[1];
  if ('player' in c) return s.active === c.player;
  return false;
}

/** List of flags referenced by a condition (for the validator). */
export function condFlags(c: Cond | undefined, out: Set<string> = new Set()): Set<string> {
  if (c === undefined) return out;
  if (typeof c === 'string') out.add(c.replace(/^!/, ''));
  else if ('flag' in c) out.add(c.flag);
  else if ('not' in c) condFlags(c.not, out);
  else if ('all' in c) c.all.forEach((x) => condFlags(x, out));
  else if ('any' in c) c.any.forEach((x) => condFlags(x, out));
  return out;
}
