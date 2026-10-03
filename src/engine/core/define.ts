import type { Cmd, GameDef, Layout, RoomDef } from './types';

/** Declares a room. Does nothing but type it: autocomplete guides the writing. */
export function defineRoom(room: RoomDef): RoomDef {
  return room;
}

/** Declares the full game. */
export function defineGame(game: GameDef): GameDef {
  return game;
}

/**
 * Gives a stable key to every once / nth / cycle / random block that doesn't have one.
 * The key depends on the block's position in the room: it survives saves as long as the content isn't reordered.
 */
export function assignKeys(game: GameDef): GameDef {
  const walk = (cmds: Cmd[] | undefined, prefix: string) => {
    if (!cmds) return;
    cmds.forEach((c, i) => {
      if (typeof c === 'string') return;
      const here = `${prefix}.${i}`;
      if ('once' in c) { c.key ??= here; walk(c.once, here); }
      else if ('nth' in c) { c.key ??= here; c.nth.forEach((b, j) => walk(b, `${here}.${j}`)); }
      else if ('cycle' in c) { c.key ??= here; c.cycle.forEach((b, j) => walk(b, `${here}.${j}`)); }
      else if ('random' in c) { c.key ??= here; c.random.forEach((b, j) => walk(b, `${here}.${j}`)); }
      else if ('if' in c) { walk(c.then, here + 't'); walk(c.else, here + 'e'); }
      else if ('parallel' in c) c.parallel.forEach((b, j) => walk(b, `${here}.p${j}`));
      else if ('cutscene' in c) walk(c.cutscene, here + 'c');
      else if ('choice' in c) c.choice.forEach((o, j) => walk(o.do, `${here}.o${j}`));
      else if ('minigame' in c) walk(c.then, here + 'm');
      else if ('phone' in c) walk(c.do, here + 'ph');
      // same suffix for the old name: save keys don't change
      else if ('ending' in c || 'reveal' in c) walk(c.after, here + 'rv');
    });
  };
  for (const r of game.rooms) {
    walk(r.onEnter, `${r.id}:enter`);
    r.on?.forEach((rule, i) => walk(rule.do, `${r.id}:on${i}`));
    for (const [actor, topics] of Object.entries(r.talk ?? {})) topics.forEach((t, i) => walk(t.do, `${r.id}:talk.${actor}.${i}`));
    r.scripts?.forEach((sc) => walk(sc.do, `${r.id}:script.${sc.id}`));
    r.events?.forEach((ev, i) => walk(ev.do, `${r.id}:event${i}`));
  }
  game.rules.on?.forEach((rule, i) => walk(rule.do, `game:on${i}`));
  game.scripts?.forEach((sc) => walk(sc.do, `game:script.${sc.id}`));
  game.events?.forEach((ev, i) => walk(ev.do, `game:event${i}`));
  walk(game.start.intro, 'game:intro');
  return game;
}

/** Empty layout, when the room hasn't been placed in the editor yet. */
export const EMPTY_LAYOUT: Layout = { entries: { default: [320, 360] } };

/** Default floor bottom (logical y), when the layout doesn't give `floor`. */
export const FLOOR = 395;

/** Distance (logical units) beyond which a saved approach point is considered stale and recomputed. */
export const NEAR = 150;
