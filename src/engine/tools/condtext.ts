// A condition as short text (the Studio, the dialogue tree, the tools).
import type { Cond } from '../core/types';

export function condText(c: Cond | undefined): string {
  if (c === undefined) return 'always';
  if (typeof c === 'string') return c.startsWith('!') ? `not ${c.slice(1)}` : c;
  if ('not' in c) return `not (${condText(c.not)})`;
  if ('all' in c) return c.all.map(condText).join(' and ');
  if ('any' in c) return c.any.map(condText).join(' or ');
  if ('has' in c) return `has ${c.has}`;
  if ('flag' in c) return `${c.flag}${'eq' in c ? ` = ${JSON.stringify(c.eq)}` : c.gte !== undefined ? ` ≥ ${c.gte}` : c.lt !== undefined ? ` < ${c.lt}` : ''}`;
  if ('visited' in c) return `visited ${c.visited}`;
  if ('room' in c) return `in ${c.room}`;
  if ('prop' in c) return `${c.prop[0]} is ${c.prop[1]}`;
  if ('unlocked' in c) return `unlocked ${c.unlocked}`;
  if ('seen' in c) return `seen ${c.seen}`;
  if ('actorIn' in c) return `${c.actorIn[0]} in ${c.actorIn[1]}`;
  if ('player' in c) return `player is ${c.player}`;
  return JSON.stringify(c);
}
