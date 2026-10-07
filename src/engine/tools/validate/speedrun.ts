// The validator's checks of a speedrun manifest (4.1.14 "Time Attack", `GameDef.speedrun`): ids a run can carry,
// triggers whose kinds exist and whose ids name something of the game, rules that hold together (a `recorded` or
// `live` category needs `reality`, a category needs one input at least), splits whose parents exist without a cycle.
import { SEMANTIC_KINDS } from '../../core/journal';
import type { GameDef, SemanticTrigger } from '../../core/types';

const CATEGORY_ID = /^[\w.%+-]{1,64}$/;
const COMPONENTS = new Set(['logic', 'trustedExtensions', 'presentation', 'engine']);

export function speedrunChecks(
  game: GameDef,
  o: { err: (where: string, msg: string) => void; warn: (where: string, msg: string) => void; flags: Set<string> },
): void {
  const m = game.speedrun;
  if (!m) return;
  const { err, warn } = o;
  if (!Number.isInteger(m.rulesVersion) || m.rulesVersion < 1)
    err('speedrun.rulesVersion', 'rulesVersion is a whole number from 1');
  const rooms = new Set(game.rooms.map((r) => r.id));
  const players = new Set([game.hero, ...(game.players?.ids ?? [])]);
  const kinds = new Set<string>(SEMANTIC_KINDS);
  const trigger = (t: SemanticTrigger | undefined, where: string) => {
    if (!t || typeof t !== 'object') return err(where, 'a trigger is { event, … }');
    if (!kinds.has(t.event)) return err(where, `unknown semantic event: "${t.event}"`);
    if (t.room !== undefined && !rooms.has(t.room)) err(where, `unknown room: "${t.room}"`);
    if (t.item !== undefined && !game.items[t.item]) err(where, `unknown item: "${t.item}"`);
    if (t.objective !== undefined && !game.objectives?.[t.objective]) err(where, `unknown objective: "${t.objective}"`);
    if (t.player !== undefined && !players.has(t.player)) err(where, `"${t.player}" is not a playable character`);
    if (t.flag !== undefined && !o.flags.has(t.flag) && !(t.flag in (game.start.flags ?? {})))
      warn(where, `flag "${t.flag}" is never set: this trigger cannot fire`);
    if (t.ending !== undefined && t.ending !== 'end' && t.ending !== 'sealed')
      warn(where, `ending "${t.ending}": the engine reaches "end" or "sealed"`);
  };
  const ids = new Set<string>();
  m.categories.forEach((c, i) => {
    const w = `speedrun.categories[${i}]`;
    if (!CATEGORY_ID.test(c.id)) err(w, `category id "${c.id}": letters, digits and . % + - _ (64 at most)`);
    if (ids.has(c.id)) err(w, `duplicate category id: "${c.id}"`);
    ids.add(c.id);
    if (!c.name) err(w, 'a category has a name');
    if (!['rta', 'igt', 'active-igt'].includes(c.timing)) err(w, `timing "${c.timing}": rta, igt or active-igt`);
    if (!['invalidates', 'allowed', 'segment'].includes(c.reload))
      err(w, `reload "${c.reload}": invalidates, allowed or segment`);
    if (!['forbidden', 'recorded', 'live'].includes(c.realityPolicy))
      err(w, `realityPolicy "${c.realityPolicy}": forbidden, recorded or live`);
    if (c.realityPolicy !== 'forbidden' && !game.reality)
      err(w, `realityPolicy "${c.realityPolicy}" needs the game's \`reality\` signals`);
    if (c.seed !== undefined && !['fixed', 'random', 'mystery', 'daily'].includes(c.seed))
      err(w, `seed "${c.seed}": fixed, random, mystery or daily`);
    // Mystery and Daily name a Remix world (4.1.15, D26): the game declares a manifest, and Daily its Bridge key.
    if ((c.seed === 'mystery' || c.seed === 'daily') && !game.remix)
      err(w, `seed "${c.seed}" needs a \`remix\` manifest`);
    if (c.seed === 'daily' && !game.remix?.daily) err(w, 'seed "daily" needs `remix.daily` (the Bridge key)');
    trigger(c.start, `${w}.start`);
    trigger(c.finish, `${w}.finish`);
    if (JSON.stringify(c.start) === JSON.stringify(c.finish)) err(w, 'the start and the finish are the same trigger');
    if (!c.fingerprint?.length) err(w, 'a category names the fingerprint components a run must match');
    for (const f of c.fingerprint ?? []) if (!COMPONENTS.has(f)) err(w, `unknown fingerprint component: "${f}"`);
    if (c.fingerprint?.length && !c.fingerprint.includes('logic'))
      warn(w, 'the category does not require `logic`: a run of a modified game would be ranked here');
    const inp = c.inputs;
    if (!inp || !(inp.mouse || inp.touch || inp.keyboard || inp.gamepad))
      err(w, 'a category allows one input at least');
    else if (inp.macros !== 'forbidden' && inp.macros !== 'allowed') err(w, 'inputs.macros: forbidden or allowed');
    if (c.allowSaves === false && c.reload !== 'invalidates')
      warn(w, `saves are forbidden but reload is "${c.reload}": a load needs a save`);
  });
  const splits = new Map(m.splits.map((s) => [s.id, s]));
  if (splits.size !== m.splits.length) err('speedrun.splits', 'duplicate split ids');
  m.splits.forEach((s, i) => {
    const w = `speedrun.splits[${i}]`;
    if (!CATEGORY_ID.test(s.id)) err(w, `split id "${s.id}": letters, digits and . % + - _ (64 at most)`);
    if (!s.name) err(w, 'a split has a name');
    trigger(s.at, `${w}.at`);
    if (s.parent !== undefined) {
      if (!splits.has(s.parent)) err(w, `unknown parent split: "${s.parent}"`);
      const seen = new Set([s.id]);
      for (let p: string | undefined = s.parent; p !== undefined; p = splits.get(p)?.parent) {
        if (seen.has(p)) {
          err(w, `split "${s.id}" is its own ancestor`);
          break;
        }
        seen.add(p);
      }
    }
  });
}
