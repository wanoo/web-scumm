// Rooms tab, the model (4.1.8, programme §4.7: the Studio's biggest owners split into model / IO / view): what the
// tab says about a room's content without touching the DOM or the backend. Readable conditions and commands, the
// labels of the three entity kinds, an entity's name and definition, the speaker of a line, a rule's head and the
// value at a content path. Pure functions over RoomDef and GameInfo: the sheets (rooms-sheet.ts, rooms-lines.ts)
// and the list (rooms.ts) read them, the tests call them directly.
import type { Cmd, Cond, Id, RoomDef, Rule } from '@engine/core/types';
import type { EntityKind, GameInfo } from './api';
import { must } from '../engine/core/must';

/** The selected entity of the tab (the editor in the view follows it), or none. */
export type Sel = { kind: EntityKind; id: Id } | null;

export const KIND_LABEL: Record<EntityKind, string> = { prop: 'Prop', actor: 'Actor', hotspot: 'Hotspot' };
export const SECTION: Record<EntityKind, 'props' | 'actors' | 'hotspots'> = {
  prop: 'props',
  actor: 'actors',
  hotspot: 'hotspots',
};
/** Above this many characters a line's counter turns red: a speech bubble stays readable. */
export const MAX_TEXT = 140;

// ---------------------------------------------------------------------------
// Readable conditions and commands
// ---------------------------------------------------------------------------

export function condText(c: Cond | undefined): string {
  if (c === undefined) return '';
  if (typeof c === 'string') return c.startsWith('!') ? `not ${c.slice(1)}` : c;
  if ('has' in c) return `has ${c.has}`;
  if ('not' in c) return `not (${condText(c.not)})`;
  if ('all' in c) return c.all.map(condText).join(' and ');
  if ('any' in c) return c.any.map(condText).join(' or ');
  if ('visited' in c) return `visited ${c.visited}`;
  if ('room' in c) return `in ${c.room}`;
  if ('prop' in c) return `${c.prop[0]} is ${c.prop[1]}`;
  if ('unlocked' in c) return `${c.unlocked} unlocked`;
  if ('seen' in c) return `heard ${c.seen}`;
  if ('flag' in c) {
    const op =
      c.eq !== undefined
        ? `= ${JSON.stringify(c.eq)}`
        : c.gte !== undefined
          ? `≥ ${c.gte}`
          : c.lt !== undefined
            ? `< ${c.lt}`
            : 'set';
    return `${c.flag} ${op}`;
  }
  return JSON.stringify(c);
}

/** A command that has no editable text, in one short line (`give key (to grandma)`), cut at 70 characters. */
export function chipText(c: Exclude<Cmd, string>): string {
  const [k, v] = Object.entries(c)[0] ?? ['?', ''];
  const val = (x: unknown): string =>
    Array.isArray(x) ? x.map(val).join(' → ') : typeof x === 'object' && x ? JSON.stringify(x) : String(x);
  const rest = Object.entries(c)
    .slice(1)
    .filter(([kk]) => !['then', 'else', 'do', 'after'].includes(kk))
    .map(([kk, x]) => `${kk} ${val(x)}`);
  const s = `${k} ${v === true ? '' : val(v)}${rest.length ? ` (${rest.join(', ')})` : ''}`.trim();
  return s.length > 70 ? s.slice(0, 68) + '…' : s;
}

export const asList = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** The head of a reaction: its verbs (labelled), its targets (`Use key → door`). */
export function ruleHead(info: GameInfo, r: Rule): string {
  const verbs = asList(r.verb)
    .map((v) => info.verbs.find((x) => x.id === v)?.label ?? v)
    .join(' / ');
  const a = asList(r.a).join(' / ');
  const b = r.b ? ` → ${asList(r.b).join(' / ')}` : '';
  return `${verbs} ${a}${b}`;
}

/** Who says a line: the character's name and colour (`hero` is the game's hero), the raw id if unknown. */
export function speaker(info: GameInfo, who: string): { label: string; color?: string } {
  const id = who === 'hero' ? info.hero : who;
  const c = info.characters[id];
  return { label: c?.name ?? who, color: c?.color };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** The definition of an entity of the room, if it is declared. */
export function entityDef(def: RoomDef | undefined, s: NonNullable<Sel>) {
  return def?.[SECTION[s.kind]]?.[s.id];
}

/** The name shown for an entity: an actor falls back to its character's name, a prop or hotspot to ''. */
export function entityName(d: RoomDef, characters: GameInfo['characters'], kind: EntityKind, id: Id): string {
  if (kind === 'actor') {
    const a = must(d.actors?.[id], 'listed actor');
    return a.name ?? characters[a.char]?.name ?? a.char;
  }
  return (
    (kind === 'prop' ? must(d.props?.[id], 'listed prop').name : must(d.hotspots?.[id], 'listed hotspot').name) ?? ''
  );
}

/** Whether the player can click it: a hotspot always, a prop with a name, an actor not marked otherwise. */
export function isInteractive(d: RoomDef, kind: EntityKind, id: Id): boolean {
  return (
    kind === 'hotspot' ||
    (kind === 'prop'
      ? !!must(d.props?.[id], 'listed prop').name
      : must(d.actors?.[id], 'listed actor').interactive !== false)
  );
}

/** The value at a content path of a room (`on[2].do[1]`), or undefined. */
export function valueAt(def: RoomDef | undefined, path: string): unknown {
  let v: unknown = def;
  for (const seg of path.split(/\.|\[|\]/).filter(Boolean))
    v = v && typeof v === 'object' ? (v as Record<string, unknown>)[seg] : undefined;
  return v;
}
