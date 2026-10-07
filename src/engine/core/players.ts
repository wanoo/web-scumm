// Several playable characters: who is where, switching, swapping, handing an item over.
// Part of the Engine (4.1.0 "Clarity"): its methods of the same name forward here, in the same order of effects.

import type { GameState, Id } from './types';

import type { Engine } from './engine';

/** The other playable characters' starting records (`players.start`). */
export function otherPlayers(eng: Engine): NonNullable<GameState['players']> {
  const out: NonNullable<GameState['players']> = {};
  for (const id of eng.game.players?.ids ?? []) {
    if (id === eng.game.hero) continue;
    const st = eng.game.players?.start?.[id];
    out[id] = { room: st?.room ?? eng.game.start.room, inventory: [...(st?.inventory ?? [])], hero: {} };
  }
  return out;
}

/** Starting room of every moving character (`CharacterDef.room`). */
export function homes(eng: Engine): Record<Id, Id> {
  const out: Record<Id, Id> = {};
  for (const [id, c] of Object.entries(eng.game.characters)) if (c.room) out[id] = c.room;
  return out;
}

// ------------------------------------------------------------------ several playable characters
/** The player takes control of another character: their room, position and inventory come up. */
export async function switchTo(eng: Engine, id: Id): Promise<void> {
  if (!eng.isPlayer(id) || id === eng.heroId() || eng.busy) return;
  eng.begin({ switch: id });
  try {
    await eng.run(async () => {
      eng.log('player', `switch to ${id}`);
      await eng.swap(id);
      await eng.enter(eng.state.room, undefined, false);
      eng.startScripts(true);
    });
  } finally {
    eng.end();
  }
}

/** Stores the active player's flat fields, loads the other's (no display). */
/** @internal Read by the modules of core/ (4.1.0). */
export async function swap(eng: Engine, id: Id) {
  const s = eng.state;
  eng.writes?.add('*');
  eng.reads?.add(`players:${id}`);
  const shared = !!eng.game.players?.sharedInventory;
  s.players ??= {};
  s.players[s.active ?? eng.game.hero] = {
    room: s.room,
    inventory: shared ? [] : s.inventory,
    hero: s.hero,
    used: shared ? undefined : s.used,
  };
  const p = s.players[id] ?? { room: eng.game.start.room, inventory: [], hero: {} };
  delete s.players[id];
  s.active = id;
  s.room = p.room;
  s.hero = p.hero;
  if (!shared) {
    s.inventory = p.inventory;
    s.used = p.used;
  }
  s.camera = { x: 0, follow: true };
  eng.journal.emit({ kind: 'playerSwitched', player: id });
  eng.onChange();
}

/** Hands an item to another player's inventory (shared inventory: nothing to do). */
/** @internal Read by the modules of core/ (4.1.0). */
export function transfer(eng: Engine, item: Id, to: Id) {
  const s = eng.state;
  eng.writes?.add('*');
  if (eng.game.players?.sharedInventory || to === eng.heroId() || !s.inventory.includes(item)) return;
  const p = ((s.players ??= {})[to] ??= { room: eng.game.start.room, inventory: [], hero: {} });
  s.inventory = s.inventory.filter((x) => x !== item);
  eng.journal.emit({ kind: 'itemLost', item, player: eng.heroId() });
  if (!p.inventory.includes(item)) p.inventory.push(item);
  eng.journal.emit({ kind: 'itemAcquired', item, player: to });
  if (s.used?.includes(item)) {
    s.used = s.used.filter((x) => x !== item);
    (p.used ??= []).push(item);
  }
  eng.ui.inventory(s.inventory, s.used);
  eng.onChange();
}
