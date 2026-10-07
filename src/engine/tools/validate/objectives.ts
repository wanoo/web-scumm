// The validator's checks of objectives (4.1.12, ADR 0014): an id the journal and the translations can carry, a
// title, a `done` whose references exist (the validator's own condition check) and that can hold at all, a parent that
// exists and makes no cycle. "Can hold" is read statically and generously: a flag set by some command, an item gained
// or held at the start, a prop's state set or initial, a place unlocked, a room that exists… `any` needs one branch,
// `all` every one, `not` and `!flag` always can. The solver's `--goal=100%` is the proof; this is the early word.
import { cmdLists, eachCmd } from '../../core/cmds';
import type { Cmd, Cond, GameDef, Id } from '../../core/types';

const OBJECTIVE_ID = /^[\w.-]{1,64}$/;

/** What the content can make true, collected from every command (custom commands' declared effects included). */
function reachable(game: GameDef, commands: Record<string, { effects?: unknown[] }> = {}) {
  const flags = new Set(Object.keys(game.start.flags ?? {}));
  const items = new Set(game.start.inventory ?? []);
  for (const p of Object.values(game.players?.start ?? {})) for (const i of p.inventory ?? []) items.add(i);
  const props = new Set<string>();
  const places = new Set(game.start.unlocked ?? []);
  const where = new Set<string>();
  const players = new Set([game.hero, ...(game.players?.ids ?? [])]);
  // What the content can take back (a flag unset, an item lost or handed away), and the custom commands used without
  // declared effects (what they do to the state is invisible here).
  const unset = new Set<string>();
  const lost = new Set<string>();
  const undeclared = new Set<string>();
  for (const r of game.rooms)
    for (const [pid, p] of Object.entries(r.props ?? {}))
      if (p.states) props.add(`${r.id}.${pid}:${p.initial ?? Object.keys(p.states)[0]}`);
  for (const [id, c] of Object.entries(game.characters)) if (c.room) where.add(`${id}:${c.room}`);
  const see = (list: Cmd[] | undefined, room?: Id) =>
    eachCmd(list, (c) => {
      if (typeof c === 'string') return;
      if ('set' in c) flags.add(Array.isArray(c.set) ? c.set[0] : c.set);
      else if ('inc' in c) flags.add(c.inc);
      else if ('gain' in c) items.add(c.gain);
      else if ('prop' in c && Array.isArray(c.prop))
        props.add(`${c.prop[0].includes('.') ? c.prop[0] : `${room}.${c.prop[0]}`}:${c.prop[1]}`);
      else if ('unlock' in c) places.add(c.unlock);
      else if ('moveActor' in c) where.add(`${c.moveActor[0]}:${c.moveActor[1]}`);
      else if ('unset' in c) unset.add(c.unset);
      else if ('lose' in c) lost.add(c.lose);
      else if ('transfer' in c) lost.add(c.transfer[0]);
      else if ('custom' in c) {
        const effects = commands[c.custom]?.effects as Cmd[] | undefined;
        if (!effects && !(commands[c.custom] as { pure?: boolean } | undefined)?.pure) undeclared.add(c.custom);
        see(effects, room);
      }
    });
  for (const l of cmdLists(game)) see(l.list, l.room?.id);
  for (const s of game.reality?.signals ?? []) see(s.fallback?.do);
  return { flags, items, props, places, where, players, unset, lost, undeclared };
}

/** What in a condition the content can make false again once true (a flag unset, an item lost), or null. */
function takenBack(c: Cond, can: ReturnType<typeof reachable>): string | null {
  if (typeof c === 'string') return !c.startsWith('!') && can.unset.has(c) ? `flag "${c}" can be unset` : null;
  if ('flag' in c) return can.unset.has(c.flag) ? `flag "${c.flag}" can be unset` : null;
  if ('has' in c) return can.lost.has(c.has) ? `item "${c.has}" can be lost` : null;
  if ('all' in c) return c.all.map((x) => takenBack(x, can)).find(Boolean) ?? null;
  if ('any' in c) {
    const all = c.any.map((x) => takenBack(x, can));
    return all.every(Boolean) ? (all[0] ?? null) : null;
  }
  return null;
}

/** Why a condition can never hold, or null when it can. */
function never(c: Cond, can: ReturnType<typeof reachable>, rooms: Set<Id>): string | null {
  if (typeof c === 'string') {
    if (c.startsWith('!')) return null;
    return can.flags.has(c) ? null : `flag "${c}" is never set`;
  }
  if ('not' in c) return null;
  if ('all' in c) {
    for (const x of c.all) {
      const why = never(x, can, rooms);
      if (why) return why;
    }
    return null;
  }
  if ('any' in c) {
    const whys = c.any.map((x) => never(x, can, rooms));
    return whys.every((w) => w) ? whys.join(', and ') || 'an empty `any`' : null;
  }
  if ('flag' in c) return can.flags.has(c.flag) ? null : `flag "${c.flag}" is never set`;
  if ('has' in c) return can.items.has(c.has) ? null : `item "${c.has}" is never gained`;
  if ('visited' in c || 'room' in c) {
    const r = 'visited' in c ? c.visited : c.room;
    return rooms.has(r) ? null : `room "${r}" does not exist`;
  }
  if ('prop' in c)
    return can.props.has(`${c.prop[0]}:${c.prop[1]}`) ? null : `prop "${c.prop[0]}" is never "${c.prop[1]}"`;
  if ('unlocked' in c) return can.places.has(c.unlocked) ? null : `place "${c.unlocked}" is never unlocked`;
  if ('actorIn' in c)
    return can.where.has(`${c.actorIn[0]}:${c.actorIn[1]}`) ? null : `"${c.actorIn[0]}" never comes to ${c.actorIn[1]}`;
  if ('player' in c) return can.players.has(c.player) ? null : `"${c.player}" is not a playable character`;
  return null; // `seen`: a topic, a choice or a listener the content offers
}

/**
 * Checks `game.objectives`. `cond` is the validator's condition check (unknown items, rooms, props, places…), which
 * also counts the flags `done` reads as read.
 */
export function objectiveChecks(
  game: GameDef,
  o: {
    cond: (c: Cond | undefined, where: string) => void;
    err: (where: string, msg: string) => void;
    warn: (where: string, msg: string) => void;
    commands?: Record<string, { effects?: unknown[] }>;
  },
): void {
  const all = game.objectives;
  if (!all) return;
  const can = reachable(game, o.commands);
  const rooms = new Set(game.rooms.map((r) => r.id));
  for (const [id, x] of Object.entries(all)) {
    const w = `objectives.${id}`;
    if (!OBJECTIVE_ID.test(id)) o.err(w, `id "${id}": letters, digits and . _ - only, at most 64`);
    if (typeof x.title !== 'string' || !x.title.trim()) o.err(w, 'a title is required (what the quest journal shows)');
    if (x.done === undefined) {
      o.err(w, 'a `done` condition is required');
      continue;
    }
    o.cond(x.done, `${w}.done`);
    const why = never(x.done, can, rooms);
    if (why)
      o.err(
        `${w}.done`,
        `can never hold: ${why}${
          can.undeclared.size && /flag|item|prop|place/.test(why)
            ? ` (unless a custom command does it: ${[...can.undeclared].map((n) => `"${n}"`).join(', ')} declares no \`effects\`, declare the command's effects)`
            : ''
        }`,
      );
    // 100 % (`--goal=100%`) is every objective holding at once: a `done` the content can take back may make it
    // unreachable even though each was completed once.
    const back = takenBack(x.done, can);
    if (!x.optional && back)
      o.warn(
        `${w}.done`,
        `${back}: the journal keeps it completed, but --goal=100% needs every objective to hold at once (write a flag set once)`,
      );
    if (x.parent !== undefined && !all[x.parent]) o.err(w, `unknown parent objective "${x.parent}"`);
  }
  // A cycle of parents: reported once, on the first objective of it met in order.
  const reported = new Set<Id>();
  for (const id of Object.keys(all)) {
    const path: Id[] = [];
    for (let p: Id | undefined = id; p && all[p]; p = all[p]!.parent) {
      if (path.includes(p)) {
        const cycle = path.slice(path.indexOf(p));
        if (!cycle.some((c) => reported.has(c))) o.err(`objectives.${p}`, `parent cycle: ${[...cycle, p].join(' → ')}`);
        for (const c of cycle) reported.add(c);
        break;
      }
      path.push(p);
    }
  }
}
