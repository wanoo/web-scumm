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

/** A condition explained: its text, whether it holds, and its parts (the Studio's Play tab). */
export interface Explained {
  text: string;
  ok: boolean;
  parts?: Explained[];
}

export function explainCond(c: Cond | undefined, s: GameState, room: Id = s.room): Explained {
  if (c === undefined) return { text: 'always', ok: true };
  const ok = check(c, s, room);
  if (typeof c === 'string')
    return {
      text: c.startsWith('!')
        ? `flag ${c.slice(1)} is false`
        : `flag ${c} is true (${JSON.stringify(s.flags[c] ?? false)})`,
      ok,
    };
  if ('has' in c) return { text: `has ${c.has}`, ok };
  if ('flag' in c)
    return {
      text: `flag ${c.flag} ${'eq' in c ? `= ${JSON.stringify(c.eq)}` : c.gte !== undefined ? `≥ ${c.gte}` : c.lt !== undefined ? `< ${c.lt}` : 'is true'} (${JSON.stringify(s.flags[c.flag] ?? null)})`,
      ok,
    };
  if ('not' in c) return { text: 'not', ok, parts: [explainCond(c.not, s, room)] };
  if ('all' in c) return { text: 'all of', ok, parts: c.all.map((x) => explainCond(x, s, room)) };
  if ('any' in c) return { text: 'any of', ok, parts: c.any.map((x) => explainCond(x, s, room)) };
  if ('visited' in c) return { text: `visited ${c.visited}`, ok };
  if ('room' in c) return { text: `in room ${c.room} (now ${s.room})`, ok };
  if ('prop' in c) {
    const key = c.prop[0].includes('.') ? c.prop[0] : `${room}.${c.prop[0]}`;
    return { text: `prop ${c.prop[0]} is ${c.prop[1]} (now ${s.props[key] ?? '?'})`, ok };
  }
  if ('unlocked' in c) return { text: `unlocked ${c.unlocked}`, ok };
  if ('seen' in c) return { text: `seen ${c.seen}`, ok };
  if ('actorIn' in c) return { text: `${c.actorIn[0]} in ${c.actorIn[1]} (now ${s.where?.[c.actorIn[0]] ?? '?'})`, ok };
  if ('player' in c) return { text: `player is ${c.player} (now ${s.active ?? '?'})`, ok };
  return { text: JSON.stringify(c), ok };
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

/** One thing a condition reads: a flag, an item in the bag, a prop state, a room… `neg`: read under a `not` or `!`. */
export interface CondAtom {
  kind: 'flag' | 'has' | 'prop' | 'visited' | 'room' | 'unlocked' | 'seen' | 'actorIn' | 'player';
  id: string;
  neg?: boolean;
  detail?: string;
}

/** Every atom a condition reads (the puzzle graph). `room`: the room of unprefixed props. */
export function condAtoms(c: Cond | undefined, room?: Id, out: CondAtom[] = [], neg = false): CondAtom[] {
  if (c === undefined) return out;
  const add = (a: CondAtom) => {
    out.push(neg ? { ...a, neg: true } : a);
  };
  if (typeof c === 'string') {
    const n = c.startsWith('!') !== neg;
    out.push({ kind: 'flag', id: c.replace(/^!/, ''), ...(n ? { neg: true } : {}) });
  } else if ('has' in c) add({ kind: 'has', id: c.has });
  else if ('flag' in c)
    add({
      kind: 'flag',
      id: c.flag,
      detail:
        'eq' in c
          ? `= ${JSON.stringify(c.eq)}`
          : c.gte !== undefined
            ? `≥ ${c.gte}`
            : c.lt !== undefined
              ? `< ${c.lt}`
              : undefined,
    });
  else if ('not' in c) condAtoms(c.not, room, out, !neg);
  else if ('all' in c) c.all.forEach((x) => condAtoms(x, room, out, neg));
  else if ('any' in c) c.any.forEach((x) => condAtoms(x, room, out, neg));
  else if ('visited' in c) add({ kind: 'visited', id: c.visited });
  else if ('room' in c) add({ kind: 'room', id: c.room });
  else if ('prop' in c)
    add({ kind: 'prop', id: c.prop[0].includes('.') || !room ? c.prop[0] : `${room}.${c.prop[0]}`, detail: c.prop[1] });
  else if ('unlocked' in c) add({ kind: 'unlocked', id: c.unlocked });
  else if ('seen' in c) add({ kind: 'seen', id: c.seen });
  else if ('actorIn' in c) add({ kind: 'actorIn', id: `${c.actorIn[0]}@${c.actorIn[1]}` });
  else if ('player' in c) add({ kind: 'player', id: c.player });
  return out;
}
