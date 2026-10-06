// The verb a double tap uses (4.0): the one a player means without choosing it. A single tap still walks; a double tap
// acts. With an item picked from the bag, it is the item on the target: given to a character, used on anything else.
// Without one: the verb the content names (`defaultVerb` on a prop, a hotspot, an actor or an exit), else an exit's
// first verb (go through the door), a character's `talk`, and `look` for everything else. Never a verb the game lacks.
import { EXIT_VERBS } from './define';
import type { GameDef, Id, RoomDef, VerbId } from './types';

export function defaultVerb(game: GameDef, room: RoomDef, target: Id, item?: Id | null): VerbId | null {
  const has = (v: VerbId) => game.verbs.some((x) => x.id === v);
  const first = (vs: readonly VerbId[]) => vs.find(has) ?? null;
  const isCharacter =
    !!room.actors?.[target] || (!!game.characters[target] && !room.props?.[target] && !room.hotspots?.[target]);
  if (item) return isCharacter ? first(['give', 'use']) : first(['use']);
  const named =
    room.props?.[target]?.defaultVerb ??
    room.hotspots?.[target]?.defaultVerb ??
    room.actors?.[target]?.defaultVerb ??
    room.exits?.[target]?.defaultVerb;
  if (named && has(named)) return named;
  const exit = room.exits?.[target];
  if (exit) return first(exit.verbs ?? EXIT_VERBS);
  if ((room.hotspots?.[target] as { exit?: boolean } | undefined)?.exit) return first(EXIT_VERBS);
  if (isCharacter) return first(['talk', 'look']);
  return first(['look']);
}
