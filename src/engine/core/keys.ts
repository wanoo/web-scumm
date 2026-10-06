// The keys of a GameState, built and read in one place (4.1.4): what `seen` remembers (a topic, a listener, a choice,
// a signal, each by its stable id, or by its place for content from before the ids), and the room-scoped keys of
// `props` and `actors` (`<room>.<id>`). Ten sites used to spell these by hand and parse them with `indexOf('.')`.
import type { Id } from './types';

/** The keys of `GameState.seen`. */
export const seenKey = {
  /** A talk topic: `topic.<id>`, or `<room>.<actor>.<i>` for content without ids (schema 2). */
  topic: (t: { id?: Id }, room: Id, actor: Id, i: number): string =>
    t.id ? seenKey.topicOf(t.id) : `${room}.${actor}.${i}`,
  topicOf: (id: Id): string => `topic.${id}`,
  /** A `once` listener: `event.<id>`, or `event.<scope>.<i>` (scope: the room's id or `game`) without an id. */
  event: (ev: { id?: Id }, scope: string, i: number): string =>
    ev.id ? seenKey.eventOf(ev.id) : `event.${scope}.${i}`,
  eventOf: (id: Id): string => `event.${id}`,
  /** A `once` option of a choice: `choice.<id>`, or `choice.<room>.<text>` without an id. */
  choice: (o: { id?: Id; text: string }, room: Id): string =>
    o.id ? seenKey.choiceOf(o.id) : `choice.${room}.${o.text}`,
  choiceOf: (id: Id): string => `choice.${id}`,
  /** A signal from the world outside whose effect applies once per game (4.1.1). */
  reality: (signal: Id): string => `reality.${signal}`,
};

/** The key of a prop's state or an actor's record: `<room>.<id>`. */
export const roomKey = (room: Id, id: Id): string => `${room}.${id}`;

/** A room key split back, or null when it has no room part (a key starting with a dot has an empty room: none has). */
export function splitRoomKey(key: string): [room: Id, id: Id] | null {
  const i = key.indexOf('.');
  return i > 0 ? [key.slice(0, i), key.slice(i + 1)] : null;
}
