// The validator's checks of save migrations (`GameDef.migrations`): one step per version below `saveVersion`, each
// renaming to something that exists. Moved out of validate.ts in 4.1.12 (that file is capped, ADR 0013's lot split it
// by family before adding the objectives' checks).
import type { GameDef, Id, RoomDef } from '../../core/types';

export function migrationChecks(
  game: GameDef,
  c: {
    items: GameDef['items'];
    rooms: Map<Id, RoomDef>;
    places: Record<Id, unknown>;
    scriptIds: Map<string, string>;
    playerIds: Id[];
    chars: GameDef['characters'];
    err: (where: string, msg: string) => void;
    warn: (where: string, msg: string) => void;
  },
): void {
  const { items, rooms, places, scriptIds, playerIds, chars, err, warn } = c;
  const migFrom = new Set<number>();
  for (const [i, m] of (game.migrations ?? []).entries()) {
    const w = `migrations[${i}]`;
    if (!Number.isInteger(m.from)) err(w, '"from" must be a version number');
    if (migFrom.has(m.from)) err(w, `two migrations from version ${m.from}`);
    migFrom.add(m.from);
    if (m.from >= game.saveVersion) err(w, `from ${m.from} is not below saveVersion ${game.saveVersion}`);
    for (const v of Object.values(m.renameFlag ?? {})) if (!v) err(w, 'empty flag name');
    for (const v of Object.values(m.renameItem ?? {})) if (!items[v]) err(w, `renamed item does not exist: "${v}"`);
    for (const v of Object.values(m.renameRoom ?? {})) if (!rooms.has(v)) err(w, `renamed room does not exist: "${v}"`);
    for (const v of Object.values(m.renamePlace ?? {}))
      if (!places[v]) err(w, `renamed map place does not exist: "${v}"`);
    for (const v of Object.values(m.renameScript ?? {}))
      if (!scriptIds.has(v)) err(w, `renamed script does not exist: "${v}"`);
    for (const v of Object.values(m.renamePlayer ?? {}))
      if (!playerIds.includes(v)) err(w, `renamed player does not exist: "${v}"`);
    for (const v of Object.values(m.renameCharacter ?? {}))
      if (!chars[v]) err(w, `renamed character does not exist: "${v}"`);
    for (const v of Object.values(m.renameProp ?? {})) {
      const [rid = '', pid] = v.split('.'); // never the default: split returns at least one part
      if (pid === undefined || !rooms.get(rid)?.props?.[pid]) err(w, `renamed prop does not exist: "${v}"`);
    }
    for (const v of Object.values(m.renameActor ?? {})) {
      const [rid = '', aid] = v.split('.'); // never the default: split returns at least one part
      if (aid === undefined || !rooms.get(rid)?.actors?.[aid]) err(w, `renamed actor does not exist: "${v}"`);
    }
  }
  if (game.migrations?.length)
    for (let v = Math.min(...migFrom); v < game.saveVersion; v++)
      if (!migFrom.has(v)) warn('migrations', `no migration from version ${v}: those saves start a new game`);
}
