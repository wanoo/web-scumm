// The lines of a list the engine draws from (look lists, hints, fallback answers): a plain string or `{ id, text }`.
import type { Id, ListLine } from './types';

/** The text of a list line. */
export const listText = (l: ListLine): string => (typeof l === 'string' ? l : l.text);
/** The stable id of a list line, if it has one. */
export const listId = (l: ListLine): Id | undefined => (typeof l === 'string' ? undefined : l.id);
/** A look (one line or a list) as a list. */
export const asLines = (x: string | ListLine[] | undefined): ListLine[] =>
  x === undefined ? [] : typeof x === 'string' ? [x] : x;
/** Its segment in a translation path: `.<id>` with an id, `[<index>]` without (the convention of `linePathSeg`). */
export const listPathSeg = (index: number, l: ListLine): string =>
  typeof l !== 'string' && l.id ? `.${l.id}` : `[${index}]`;
