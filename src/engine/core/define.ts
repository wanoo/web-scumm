import type { Cmd, GameDef, Layout, RoomDef, Rule, VerbId } from './types';

/** Declares a room. Does nothing but type it: autocomplete guides the writing. */
export function defineRoom(room: RoomDef): RoomDef {
  return room;
}

/** Declares the full game. */
export function defineGame(game: GameDef): GameDef {
  return game;
}

const EXIT_VERBS = ['use', 'open', 'walk', 'go', 'enter', 'push', 'pull'];

/**
 * Turns every declared exit (`RoomDef.exits`) into what the engine plays: a hotspot of kind `exit`, and rules appended
 * to `on`: "VERB exit → goto" when its condition holds, then the `locked` line. Written rules come first, so a written
 * reaction on an exit wins, and their paths and keys stay as written. Idempotent; the game is changed in place (the
 * Engine, the validator, the Studio and the pages all call it).
 */
export function normalizeExits(game: GameDef): GameDef {
  const verbs = game.verbs.map((v) => v.id);
  const defaults = EXIT_VERBS.filter((v) => verbs.includes(v));
  for (const r of game.rooms) {
    if (!r.exits) continue;
    const rules: Rule[] = [];
    for (const [id, ex] of Object.entries(r.exits)) {
      // Idempotent through the data itself (a clone of a normalised game is normalised too): generated things are marked.
      if (r.on?.some((x) => x.exit === id)) continue;
      r.hotspots = { ...(r.hotspots ?? {}), [id]: r.hotspots?.[id] ?? { name: ex.name, kind: ['exit', ...(ex.kind ?? [])], visible: ex.visible, exit: true } };
      const verb: VerbId[] = ex.verbs ?? (defaults.length ? defaults : verbs.filter((v) => !['look', 'talk', 'give', 'take'].includes(v)));
      rules.push({ verb, a: id, if: ex.if, do: [...(ex.sfx ? [{ sfx: ex.sfx }] : []), { goto: ex.to, at: ex.entry }], exit: id });
      if (ex.locked) rules.push({ verb, a: id, do: [ex.locked], exit: id });
    }
    r.on = [...(r.on ?? []), ...rules];
  }
  return game;
}

/**
 * Gives a stable key to every once / nth / cycle / random block that doesn't have one.
 * The key depends on the block's position in the room: it survives saves as long as the content isn't reordered.
 * Also turns declared exits into hotspots and rules (`normalizeExits`).
 */
export function assignKeys(game: GameDef): GameDef {
  normalizeExits(game);
  const walk = (cmds: Cmd[] | undefined, prefix: string) => {
    if (!cmds) return;
    cmds.forEach((c, i) => {
      if (typeof c === 'string') return;
      const here = `${prefix}.${i}`;
      if ('anim' in c && c.at) { for (const [i, b] of Object.entries(c.at)) walk(b, `${here}.at${i}`); return; }
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
    for (const [pid, p] of Object.entries(r.props ?? {})) for (const [an, a] of Object.entries(p.anims ?? {})) for (const [i, b] of Object.entries(a.at ?? {})) walk(b, `${r.id}:prop.${pid}.${an}.${i}`);
    // Rules generated from exits come last: the written rules keep their keys.
    const nw = r.on?.findIndex((x) => x.exit) ?? -1;
    r.on?.forEach((rule, i) => walk(rule.do, nw < 0 || i < nw ? `${r.id}:on${i}` : `${r.id}:exit${i - nw}`));
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
